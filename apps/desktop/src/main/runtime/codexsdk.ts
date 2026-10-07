// Codex runtime adapter — in-process via the @openai/codex-sdk Thread API (replaces the
// `codex exec --json` spawn in codex.ts). Same harness, same auth (the SDK shells the codex
// binary, which accepts a ChatGPT-account login OR an sk- key), but we get typed events,
// per-thread model selection, resumable threads (warm pool), and per-instance MCP config —
// no `~/.codex/config.toml` writing. Auth via providerEnv: key → inject OPENAI_API_KEY;
// subscription (token '') → strip the keys so codex uses its own `codex login` session.
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { LogFn } from '../agentlog';
import type { TurnOpts, RuntimeAdapter, ProposeSkillFn, RecordLessonFn, AddBacklogItemFn, BeatsFn, AgentAttachment, PromptOverride } from './adapter';
import { buildCodingPrompt, chatSystemPrompt, codexSandboxMode, providerEnv } from './adapter';
import { codexEffort } from './thinking';
import { instructionsFor } from '../host/turnkit';
import { beatMarkerSink, stripBeatMarkers } from '../beats';
import { openBusBridge, userDataDir, beatsAdapter } from '../harness/turntools';
import type { ToolHost } from '../harness/toolbus';
import { toolVerb, type TurnKind } from '@neuramesh/shared';
import { ensureCli } from './cli';

// Minimal shapes from @openai/codex-sdk (dynamically imported to keep the main bundle lean).
export type CodexCtor = new (opts?: { codexPathOverride?: string; apiKey?: string; env?: Record<string, string>; config?: Record<string, unknown> }) => CodexClient;
export interface CodexClient { startThread(opts?: ThreadOpts): CodexThread; resumeThread(id: string, opts?: ThreadOpts): CodexThread; }
interface ThreadOpts { model?: string; modelReasoningEffort?: 'low' | 'medium' | 'high'; sandboxMode?: 'read-only' | 'workspace-write' | 'danger-full-access'; workingDirectory?: string; skipGitRepoCheck?: boolean; approvalPolicy?: 'never' | 'on-request' | 'on-failure' | 'untrusted' }
// Codex accepts a plain string OR an array of typed input items — text + local_image (by file path).
type CodexInput = string | Array<{ type: 'text'; text: string } | { type: 'local_image'; path: string }>;
interface CodexThread { id: string | null; run(input: CodexInput, t?: { signal?: AbortSignal }): Promise<{ finalResponse: string; usage: CodexUsage | null }>; runStreamed(input: CodexInput, t?: { signal?: AbortSignal }): Promise<{ events: AsyncIterable<CodexEvent> }> }
// Codex takes images by LOCAL FILE PATH (we already store the attachment bytes on disk) — build a
// structured input when images are present, else the plain string (the cheaper path).
function codexInput(text: string, attachments?: AgentAttachment[]): CodexInput {
  const imgs = (attachments ?? []).filter((a) => a.kind === 'image' && a.path);
  if (!imgs.length) return text;
  return [{ type: 'text', text }, ...imgs.map((a) => ({ type: 'local_image' as const, path: a.path! }))];
}
type CodexUsage = { input_tokens: number; output_tokens: number };
type CodexItem = { type: string; text?: string; command?: string; status?: string; changes?: Array<{ path?: string; kind?: string }>; message?: string; server?: string; tool?: string; arguments?: unknown; query?: string };
type CodexEvent = { type: string; item?: CodexItem; usage?: CodexUsage; error?: { message?: string }; message?: string };

// Build a codex client honoring the resolved auth (key inject vs subscription strip).
async function mkCodex(token: string, opts?: { config?: Record<string, unknown> }, log?: LogFn): Promise<CodexClient> {
  const bin = await ensureCli('codex', log);
  const { Codex } = (await import('@openai/codex-sdk')) as unknown as { Codex: CodexCtor };
  const raw = providerEnv('openai', token);
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) if (typeof v === 'string') env[k] = v;
  // the reasoning summaries are what the live bubble's Thoughts block shows (the repo-connect round's
  // Option A). "detailed" asks for the fuller one. A turn the model answers with no reasoning at all sends
  // none, whatever this says (measured on codex-cli 0.153.4, gpt-5.6-sol: reasoning_output_tokens 0)
  return new Codex({ codexPathOverride: bin, apiKey: token || undefined, env, config: { model_reasoning_summary: 'detailed', ...opts?.config } });
}

/** one tool step as the Thoughts block shows it: what the agent does, in the run card's words (shared
 *  toolVerb, never the tool's name), and what it was asked, on one line */
export function thoughtStep(it: CodexItem): string | null {
  if (it.type === 'mcp_tool_call' && it.tool) {
    const a = it.arguments && typeof it.arguments === 'object' ? Object.values(it.arguments as Record<string, unknown>).find((v) => typeof v === 'string' && v.trim()) : null;
    const words = toolVerb({ kind: 'tool', phase: 'call', summary: it.tool })?.verb ?? it.tool.replace(/_/g, ' ');
    return `› ${words}${typeof a === 'string' ? ` · ${a.replace(/\s+/g, ' ').slice(0, 120)}` : ''}`;
  }
  if (it.type === 'command_execution' && it.command) return `› runs ${String(it.command).replace(/\s+/g, ' ').slice(0, 120)}`;
  if (it.type === 'web_search' && it.query) return `› searches the web · ${it.query.slice(0, 120)}`;
  return null;
}

// Drain a streamed turn: track the assistant message (onDelta), log tool activity for workers,
// capture token usage, and surface the first failure. Mirrors codex.ts's JSONL handler.
export async function drainTurn(events: AsyncIterable<CodexEvent>, log?: LogFn, onDelta?: (t: string, thinking?: string) => void, onMarkerText?: (t: string) => void): Promise<{ text: string; tokens?: number; failure?: string }> {
  let text = '';
  let tokens: number | undefined;
  let failure: string | undefined;
  // the turn's thoughts (the repo-connect round's Option A): codex sends each reasoning summary whole,
  // one section at a time, and each tool call as it starts. They grow beside the reply, never in it.
  const thoughts: string[] = [];
  const think = (line: string): void => { thoughts.push(line); onDelta?.(text, thoughts.join('\n\n')); };
  for await (const e of events) {
    const it = e.item;
    if (e.type === 'item.completed' && it?.type === 'reasoning' && it.text?.trim()) { think(it.text.trim()); continue; }
    if (e.type === 'item.started' && it) { const step = thoughtStep(it); if (step) think(step); }
    if ((e.type === 'item.updated' || e.type === 'item.completed') && it?.type === 'agent_message' && typeof it.text === 'string') {
      text = it.text;
      onDelta?.(text, thoughts.length ? thoughts.join('\n\n') : undefined);
      onMarkerText?.(it.text); // live beats: the model may narrate its NM_BEAT_DONE markers
      if (e.type === 'item.completed' && it.text.trim()) log?.({ kind: 'turn', summary: it.text.slice(0, 280) });
    } else if (it?.type === 'file_change' && e.type === 'item.completed') {
      const paths = (it.changes ?? []).map((c) => `${c.kind ?? 'edit'} ${c.path?.split('/').slice(-2).join('/') ?? ''}`).join(', ');
      log?.({ kind: 'tool', phase: 'result', summary: `→ ${it.status ?? 'done'} (${paths})`.slice(0, 180), level: it.status === 'failed' ? 'warn' : 'info' });
    } else if (it?.type === 'command_execution' && e.type === 'item.started') {
      onMarkerText?.(String(it.command ?? '')); // …or emit them via a shell echo
      log?.({ kind: 'tool', phase: 'call', summary: `bash ${String(it.command ?? '').slice(0, 140)}` });
    } else if (it?.type === 'error' && it.message) {
      failure = it.message;
      log?.({ kind: 'tool', phase: 'result', summary: `error: ${it.message.slice(0, 140)}`, level: 'warn' });
    } else if (e.type === 'turn.completed') {
      tokens = e.usage ? (e.usage.input_tokens ?? 0) + (e.usage.output_tokens ?? 0) : undefined;
    } else if (e.type === 'turn.failed' || e.type === 'error') {
      failure = e.error?.message ?? e.message ?? failure;
      // a failed turn ends here, as the SDK's own run() ends it: read on and the stream throws codex's
      // exit code, which carries no reason. The words before the failure are no reply, as in run()
      if (e.type === 'turn.failed') { text = ''; break; }
    }
  }
  return { text: text.trim(), tokens, failure };
}

// Run a turn honoring the requested model, but fall back to the account/plan default if that exact
// model isn't offered. A ChatGPT subscription DOES accept a model — it just rejects models the plan
// doesn't include (e.g. `gpt-5-codex` on a plan whose default is `gpt-5.5`); an API key accepts any
// model the account has. This keeps per-agent model selection working on subscriptions too.
export async function runResilient(codex: CodexClient, opts: ThreadOpts, input: CodexInput, turnOpts: { signal?: AbortSignal }, log?: LogFn, onDelta?: (t: string, thinking?: string) => void, onMarkerText?: (t: string) => void): Promise<{ text: string; tokens?: number; failure?: string }> {
  const first = await drainTurn((await codex.startThread(opts).runStreamed(input, turnOpts)).events, log, onDelta, onMarkerText);
  if (first.text || !opts.model || !first.failure || !/not supported|unsupported|not available|invalid model|model .*not/i.test(first.failure)) return first;
  log?.({ kind: 'tool', phase: 'result', summary: `model "${opts.model}" unavailable on this account — using its default`, level: 'warn' });
  return drainTurn((await codex.startThread({ ...opts, model: undefined, modelReasoningEffort: undefined }).runStreamed(input, turnOpts)).events, log, onDelta, onMarkerText);
}

// non-agentic turn in a throwaway read-only dir (codex needs a cwd).
async function reason(system: string, user: string, token: string, model: string, onDelta?: (t: string, thinking?: string) => void, attachments?: AgentAttachment[], effort: ReturnType<typeof codexEffort> = {}): Promise<string> {
  const codex = await mkCodex(token);
  const dir = mkdtempSync(join(tmpdir(), 'nm-codexsdk-'));
  try {
    const { text, failure } = await runResilient(codex, { model, ...effort, sandboxMode: codexSandboxMode('read-only'), workingDirectory: dir, skipGitRepoCheck: true }, codexInput(`${system}\n\n${user}`, attachments), {}, undefined, onDelta);
    if (!text && failure) throw new Error(`codex: ${failure.slice(0, 160)}`);
    return text;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * A one-shot turn that carries the nm tool bus (docs/design/repo-connect-2026-10): a deep-work leg that
 * reads the room's repository. Before this a codex leg ran tool-less in an empty temp folder and told the
 * person "the workspace is empty". The bus is the same loopback bridge a worker gets, narrowed by `kind`.
 */
export async function codexToolTurn(agent: Parameters<typeof codexEffort>[0] & { model: string }, prompt: string, token: string, tools: { kind: TurnKind; host: ToolHost }, log?: LogFn): Promise<string> {
  const bus = await openBusBridge(tools, userDataDir(), log);
  const dir = mkdtempSync(join(tmpdir(), 'nm-codexsdk-'));
  try {
    const codex = await mkCodex(token, { config: bus.codexConfig }, log);
    // approvalPolicy 'never': a headless turn has nobody to approve an MCP call (see runQuery)
    const { text, failure } = await runResilient(codex, { model: agent.model, ...codexEffort(agent), sandboxMode: codexSandboxMode('read-only'), approvalPolicy: 'never', workingDirectory: dir, skipGitRepoCheck: true }, prompt, {}, log);
    if (!text && failure) throw new Error(`codex: ${failure.slice(0, 160)}`);
    return text;
  } finally {
    bus.cleanup();
    rmSync(dir, { recursive: true, force: true });
  }
}

export const codexSdkAdapter: RuntimeAdapter = {
  streamTurn(agent, channelSlug, transcript, token, _log, onDelta, attachments) {
    // instructionsFor, not agent.brief: local › baseline › shipped — a CLI seat honoring only
    // the synced brief silently ignored the machine's own overlay edits (2026-08-18 audit A6)
    return reason(chatSystemPrompt(agent.name, channelSlug, instructionsFor(agent)), transcript, token, agent.model, onDelta, attachments, codexEffort(agent)).then((t) => t || '(no reply)');
  },
  complete(system, user, token, model) {
    return reason(system, user, token, model);
  },
  async runQuery(agent, t, dir, token, channelBlock, repoBacked, ac, log, skills, proposeSkill?: ProposeSkillFn, reworkNotes?: string, attachmentsNote?: string, recordLesson?: RecordLessonFn, lessonsNote?: string, promptOverride?: PromptOverride, addBacklogItem?: AddBacklogItemFn, beats?: BeatsFn, _permissionGate?: unknown, _protectedPaths?: string[], opts?: TurnOpts) {
    // ── The tool bus (docs/harness/03) ─────────────────────────────────────────────────────────
    // Codex used to ignore proposeSkill / recordLesson / addBacklogItem entirely — they were not
    // even in this signature — so a Codex-seated worker silently could not record a lesson or park
    // a discovery, and beats depended on the model echoing NM_BEAT_DONE into stdout. The bus gives
    // it the SAME toolset a Claude worker gets, over the loopback MCP bridge.
    const bus = await openBusBridge(
      { kind: opts?.turnKind ?? (promptOverride ? 'design' : 'work'), host: { dir, log, skills, proposeSkill, recordLesson, addBacklogItem, ...(beats ? { beats: beatsAdapter(beats) } : {}), ...(opts?.spawn ? { spawn: opts.spawn } : {}), ...(opts?.park ? { park: opts.park } : {}), ...(opts?.whiteboards ? { whiteboards: opts.whiteboards } : {}), ...(opts?.searchX ? { searchX: opts.searchX } : {}), ...(opts?.draftReplies ? { draftReplies: opts.draftReplies } : {}), ...(opts?.repo ? { repo: opts.repo } : {}), ...(opts?.web ? { web: opts.web } : {}) } },
      userDataDir(),
      log,
    );
    const codex = await mkCodex(token, { config: bus.codexConfig }, log);
    const started = Date.now();
    // Beats now arrive as real tool calls through the bus. The stdout-marker sink stays ONLY as the
    // fallback for a turn whose bridge failed to start (fail-open), never as the primary — a progress
    // system must not depend on the model remembering to print a magic string.
    const onMarkerText = beats && !promptOverride && !bus.count ? beatMarkerSink(beats.advance) : undefined;
    // Containment L1b — codex is the one runtime we do NOT wrap in our own sandbox: it SELF-sandboxes via
    // its native `workspace-write` Seatbelt mode (writes confined to the worktree + tmp; always on, not
    // behind NM_SANDBOX_FS). We deliberately leave its network at the codex default and route egress
    // through the L1a proxy (the HTTP_PROXY in `env` from providerEnv) rather than forcing
    // networkAccessEnabled:false — a hard network-off would break tasks that legitimately install deps.
    // Codex's one residual gap is broad FS READS (its modes offer no read-jail short of `read-only`,
    // which would break the writes a coding task needs); that gap is de-fanged by L0 (no secret env to
    // read) + L1a (a read it can't exfiltrate past the egress allowlist). Double-sandboxing codex under
    // our own sandbox-exec is intentionally avoided — it fights its own Seatbelt profile.
    // On a CLOUD machine none of this applies: codexSandboxMode gives full access there, because the
    // box is the agents' and Codex's Linux sandbox cannot start on gVisor (adapter.ts onCloudMachine).
    try {
      // approvalPolicy: codex ASKS before every MCP tool call by default, and a headless SDK turn
      // has nobody to ask — so each call came back to the model as "user cancelled MCP tool call".
      // Found live 2026-08-26: a codex-seated marketer lost its ENTIRE nm bus this way (load_skill,
      // search_x, draft_replies, the beat tracker) and, unable to read X, honestly wrote its
      // findings into a markdown report instead of handing over the card. Approval was never the
      // boundary here anyway: codex self-sandboxes (workspace-write, see L1b below) and egress
      // rides the L1a proxy, so what it may touch is already decided before the turn starts.
      const { text, tokens, failure } = await runResilient(codex, { model: agent.model, ...codexEffort(agent), sandboxMode: codexSandboxMode('workspace-write'), approvalPolicy: 'never', workingDirectory: dir, skipGitRepoCheck: true }, promptOverride?.prompt ?? buildCodingPrompt(t, channelBlock, repoBacked, skills, reworkNotes, attachmentsNote, lessonsNote, agent.brief, bus.count > 0), ac ? { signal: ac.signal } : {}, log, undefined, onMarkerText);
      const clean = onMarkerText ? stripBeatMarkers(text) : text;
      if (ac?.signal.aborted) { log?.({ kind: 'result', phase: 'success', summary: 'capped · codex', tokens }); return clean || '(capped)'; }
      if (!clean && failure) { log?.({ kind: 'result', phase: 'error', summary: `failed · codex: ${failure.slice(0, 140)}`, level: 'error' }); throw new Error(`codex produced no output: ${failure.slice(0, 160)}`); }
      log?.({ kind: 'result', phase: 'success', summary: `completed ${Math.round((Date.now() - started) / 1000)}s · codex`, tokens });
      return clean || '(no summary)';
    } finally {
      // the turn's tools must stop being callable the moment it ends — the bridge registration is
      // per-turn precisely so a finished turn's secret grants nothing
      bus.cleanup();
    }
  },
};
