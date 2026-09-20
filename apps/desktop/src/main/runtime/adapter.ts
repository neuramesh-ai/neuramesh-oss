// The runtime seam (A2A multi-runtime). Every model call in the AgentHost funnels
// through one RuntimeAdapter so an agent can run on Claude, Codex, or Gemini chosen
// by its `runtime`. The methods carry the EXACT positional signatures of the
// host's existing Claude functions (claudeTurn / directComplete / claudeCode), so
// the Anthropic adapter is a straight binding and the host call sites only gain a
// `runtimeFor(agent.runtime).` prefix — behavior-preserving. Codex/Gemini adapters
// (slice 2) implement the same three methods their own way (CLI coding loop + raw
// SDK turns). The seam stays thin: prompts, worktrees, tools, and the echo
// branches all live in the host; the adapter is only the model invocation.
import type { RepoReader } from '../host/reporead';
import { styled } from '../housestyle';
import { existsSync } from 'node:fs';
import { join, sep } from 'node:path';
import type { LogFn } from '../agentlog';
import type { HostedAgent, ExecTask, SkillRef } from '../agents';
import { shippedContract } from '../contracts';
import { composePrompt, type TurnKind } from '@neuramesh/shared';
import type { WhiteboardToolClosures } from '../harness/toolbus';

export type RuntimeName = 'claude-code' | 'codex' | 'gemini';
export type ProviderName = 'anthropic' | 'openai' | 'gemini';
export type ProposeSkillFn = (input: { name: string; description: string; scope: 'channel' | 'global'; body: string }) => Promise<{ ok: boolean; error?: string }>;
// records a durable lesson (memory.record_lesson) — the worker's write path into
// channel memory when a review correction teaches a norm. Claude-tool only today;
// CLI runtimes get their lessons mined host-side after approval instead.
export type RecordLessonFn = (input: { lesson: string }) => Promise<{ ok: boolean; error?: string }>;
// parks an out-of-scope discovery on the channel backlog (task.create backlog:true —
// docs/15), the one board-write every worker gets. Claude-tool only today, mirroring
// record_lesson; promotion to live work stays human/orchestrator-only regardless.
// parent: create as a SUBTASK of the running task instead of a backlog park (docs/24)
export type AddBacklogItemFn = (input: { title: string; description?: string; parent?: boolean }) => Promise<{ ok: boolean; number?: number; error?: string }>;
// surfaces the worker's own plan as beats (docs/17): declare the ordered set once,
// then advance each as it lands. The Claude adapter drives this from the worker's
// native TodoWrite events (the mapping lives in claudeCode); CLI runtimes ignore it
// in v1. status is a beat_status string ('pending' | 'active' | 'done' | 'blocked').
export type BeatsFn = { declare: (items: string[]) => Promise<void>; advance: (seq: number, status: string) => Promise<void> };

// A chat attachment threaded to an agent. Images carry base64 (fed to Claude as an image block so
// it actually sees them); text files carry decoded text (inlined into the transcript every runtime
// reads). Non-image binaries carry neither — only their name appears in the manifest.
export interface AgentAttachment {
  name: string;
  mime: string;
  kind: 'image' | 'file';
  base64?: string;
  text?: string;
  /** absolute local path to the stored bytes — Codex local_image + the coding-worktree drop */
  path?: string;
}
export type ImageMime = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
// The image types Claude + Gemini accept as inline image blocks. Other image types (svg, heic,
// bmp…) degrade to the manifest instead of sending an invalid media_type (which would 400).
const SUPPORTED_IMAGE_MIME = new Set<string>(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
export function isInlineImage(a: AgentAttachment): boolean {
  return a.kind === 'image' && !!a.base64 && SUPPORTED_IMAGE_MIME.has(a.mime);
}
export type ImageBlock = { type: 'image'; source: { type: 'base64'; media_type: ImageMime; data: string } };
// Base64 image content blocks (Anthropic shape) for the supported-mime images — shared by the raw
// Anthropic SDK path and the Claude Agent SDK streaming-input prompt. Pure + unit-testable.
export function imageBlocks(attachments?: AgentAttachment[]): ImageBlock[] {
  return (attachments ?? [])
    .filter(isInlineImage)
    .map((a) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: a.mime as ImageMime, data: a.base64! } }));
}
export type ClaudeUserContent = string | Array<{ type: 'text'; text: string } | ImageBlock>;

// Build the Anthropic `content` for a chat turn: a plain string when there are no images, or a
// text + image-block array when images are attached.
export function buildClaudeUserContent(transcript: string, attachments?: AgentAttachment[]): ClaudeUserContent {
  const imgs = imageBlocks(attachments);
  if (!imgs.length) return transcript;
  return [{ type: 'text', text: transcript }, ...imgs];
}

// The permission gate (agent policy engine, Phase 1): the AgentHost injects this into the
// coding loop so each tool call is checked against the effective policy. It resolves `ask`
// internally (posts a card + awaits the human), returning only allow/deny to the runtime.
export type PermissionGate = (toolName: string, input: Record<string, unknown>) => Promise<{ decision: 'allow' | 'deny'; reason?: string }>;

// Fan out a subagent (docs/harness/04). The host owns seating, budget slicing, the child run and the
// ownership rules; an adapter only needs to hand the closure to its toolset.
export type SpawnFn = (i: { role: string; prompt: string; label?: string }) => Promise<{ ok: boolean; summary?: string; error?: string }>;

// A trailing options bag, deliberately: `runQuery` reached NINETEEN positional parameters, six of them
// tools that two adapters silently ignored (docs/harness/06 §2). Every new capability from here rides
// this object instead of extending that list, so the signature stops growing and a missing option is a
// visible `opts.x === undefined` rather than an argument counted wrong.
export type ParkFn = (i: { until: string; prNumber?: number; afterMinutes?: number; note: string }) => Promise<{ ok: boolean; error?: string }>;

export interface TurnOpts {
  spawn?: SpawnFn;
  park?: ParkFn;
  /** whiteboards (docs/38): the four tool closures — built once per turn by the daemon */
  whiteboards?: WhiteboardToolClosures;
  /** X reads on a research leg (marketing-os round) — host/searchx.ts closed over the room */
  searchX?: (i: { query: string; max?: number }) => Promise<string>;
  /** the reply card (reply-radar round) — host/tools-replies.ts closed over the thread, so the
   *  worker that FOUND the conversations is the one that hands them over */
  draftReplies?: (i: { report?: string; baseline?: string; replies: unknown[] }) => Promise<string>;
  /** the repository reads (docs/design/github-connector-2026-09) — host/reporead.ts closed over the room */
  repo?: RepoReader;
  /** the REAL turn kind for the tool bus. The CLI adapters used to hardcode
   *  `promptOverride ? 'design' : 'work'`, so a leg bridged as a design turn and
   *  TOOL_KINDS could never grant a leg anything — that literal is now the fallback only. */
  turnKind?: TurnKind;
}

export interface RuntimeAdapter {
  // tool-less streaming reply (chat / thread). onDelta feeds the live bubble. attachments (chat
  // images/files) are threaded so Claude sees images; text-only runtimes read them via the transcript.
  streamTurn(agent: HostedAgent, channelSlug: string, transcript: string, token: string, log?: LogFn, onDelta?: (text: string) => void, attachments?: AgentAttachment[]): Promise<string>;
  // tool-less one-shot completion (plan mixture-of-agents, review verdicts).
  complete(system: string, user: string, token: string, model: string, maxTokens?: number): Promise<string>;
  // agentic coding loop in the task's worktree/scratch dir; returns the summary.
  // lessonsNote = pre-fetched channel lessons (past review corrections) folded into
  // the prompt; recordLesson = the Claude-path write tool (CLIs ignore it).
  // promptOverride swaps the built coding prompt for a caller-authored turn (the
  // designer's mockup turn) while keeping the same tools/worktree mechanics.
  runQuery(agent: HostedAgent, t: ExecTask, dir: string, token: string, channelBlock: string | null | undefined, repoBacked: boolean, ac?: AbortController, log?: LogFn, skills?: SkillRef[], proposeSkill?: ProposeSkillFn, reworkNotes?: string, attachmentsNote?: string, recordLesson?: RecordLessonFn, lessonsNote?: string, promptOverride?: PromptOverride, addBacklogItem?: AddBacklogItemFn, beats?: BeatsFn, permissionGate?: PermissionGate, protectedPaths?: string[], opts?: TurnOpts): Promise<string>;
}

// a caller-authored agentic turn (prompt + optional system prompt) — the CLIs use
// only `prompt`; the Claude path honors `system` too.
export interface PromptOverride {
  prompt: string;
  system?: string;
  /** Enable Anthropic's authenticated remote Claude Design MCP for this turn only. */
  claudeDesign?: boolean;
}

// runtime → inference provider (which BYOK key + env var to use)
export function providerFor(runtime: string): ProviderName {
  return runtime === 'codex' ? 'openai' : runtime === 'gemini' ? 'gemini' : 'anthropic';
}
// the env var(s) NeuraMesh reads as the local BYOK fallback, in priority order.
// Codex is the gotcha: the CLI subprocess wants OPENAI_API_KEY, but NeuraMesh's
// own fallback var is CODEX_API_KEY — accept both (and GOOGLE_API_KEY for Gemini).
export function keyEnvFor(provider: ProviderName): string[] {
  if (provider === 'openai') return ['CODEX_API_KEY', 'OPENAI_API_KEY'];
  if (provider === 'gemini') return ['GEMINI_API_KEY', 'GOOGLE_API_KEY'];
  return ['ANTHROPIC_API_KEY'];
}
// ── Agent process environment (containment L0) ──────────────────────────────────────────────────
// Every runtime CLI (claude · codex · agy) and every shell/bash tool an agent runs is a CHILD
// process. Its environment is built from an ALLOWLIST, not inherited wholesale from the daemon — so
// NeuraMesh's own secrets (NM_* config, DATABASE_URL / PowerSync URLs, GitHub/GH tokens) and every
// cross-provider API key stay out of an agent's reach BY CONSTRUCTION, not by remembering to strip
// each one. The single provider key an agent legitimately needs is injected explicitly (below).
// HOME stays the real one so a subscription CLI can read its own stored login (~/.claude · ~/.codex
// · ~/.gemini / macOS keychain); the filesystem jail that keeps the REST of HOME unreadable is L1.
// Extend for an unusual toolchain with NM_AGENT_ENV_PASSTHROUGH=FOO,BAR.
const AGENT_ENV_ALLOW = new Set<string>([
  // shell + tooling discovery, working dir, user identity
  'PATH', 'HOME', 'SHELL', 'USER', 'LOGNAME', 'PWD', 'HOSTNAME',
  // locale + terminal (LC_* covered by the prefix list below)
  'LANG', 'LANGUAGE', 'TZ', 'TERM', 'TERM_PROGRAM', 'TERM_PROGRAM_VERSION', 'COLORTERM',
  // temp dirs + XDG base dirs (Linux CLI config/cache roots)
  'TMPDIR', 'TEMP', 'TMP', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME',
  // proxy config: non-secret, honored by the CLIs/tools, and the exact seam the L1 egress proxy sets
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'no_proxy', 'all_proxy',
]);
const AGENT_ENV_ALLOW_PREFIX = ['LC_'];

// The L1 egress proxy's loopback URL, set by the daemon once the proxy is listening (null when it
// isn't). agentBaseEnv routes every agent's HTTP(S) traffic through it so the metadata floor +
// net.egress denials bind at the network layer. Fail-open: if the proxy never came up this stays
// null and agents run un-proxied rather than losing all egress.
let _agentProxyUrl: string | null = null;
export function setAgentProxy(url: string | null): void { _agentProxyUrl = url; }

// Containment L1b (kernel FS sandbox) is DEFAULT-ON, mirroring the egress proxy: agents run jailed from
// credential stores + NeuraMesh's userData. Two controls, env wins over UI: the NM_SANDBOX_FS env var
// (on/1 or off/0) is an ops/CI override; otherwise the per-machine UI toggle (persisted in userData,
// loaded into _sandboxFsCache at boot, default ON) decides. Fail-open by construction (Claude
// failIfUnavailable:false; agy falls back to un-jailed on non-macOS / setup error). One reader so every
// call site agrees.
let _sandboxFsCache = true;
export function setSandboxFsCache(enabled: boolean): void { _sandboxFsCache = enabled; }
// true when NM_SANDBOX_FS pins the value — the UI shows the toggle as env-forced + read-only.
export function sandboxEnvForced(): boolean {
  const v = process.env.NM_SANDBOX_FS;
  return v === 'on' || v === '1' || v === 'off' || v === '0';
}
export function sandboxFsEnabled(): boolean {
  const v = process.env.NM_SANDBOX_FS;
  if (v === 'off' || v === '0') return false;
  if (v === 'on' || v === '1') return true;
  return _sandboxFsCache;
}

// The clean base env for any agent child process: the allowlist ∩ the daemon env, plus any
// NM_AGENT_ENV_PASSTHROUGH extras. Carries NO provider key — providerEnv injects that on top.
export function agentBaseEnv(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const extra = (source.NM_AGENT_ENV_PASSTHROUGH ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const allow = new Set([...AGENT_ENV_ALLOW, ...extra]);
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(source)) {
    if (typeof v !== 'string') continue;
    if (allow.has(k) || AGENT_ENV_ALLOW_PREFIX.some((p) => k.startsWith(p))) out[k] = v;
  }
  // Route agent egress through the L1 proxy when it's up — unless the user already runs behind their
  // own proxy (a corp/VPN requirement we must not override; that traffic stays on their proxy).
  if (_agentProxyUrl && !out.HTTP_PROXY && !out.HTTPS_PROXY && !out.http_proxy && !out.https_proxy) {
    out.HTTP_PROXY = out.HTTPS_PROXY = out.http_proxy = out.https_proxy = _agentProxyUrl;
  }
  return out;
}

// Build the child env for a provider invocation. apikey mode injects the key into the var the tool
// reads; subscription mode injects nothing — the allowlist already excludes every inherited key, so
// the CLI/SDK falls back to its own stored login instead of a stray key that would silently bill.
export function providerEnv(provider: ProviderName, token: string | null | undefined, source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = agentBaseEnv(source);
  if (token) {
    const inject = provider === 'openai' ? 'OPENAI_API_KEY' : provider === 'gemini' ? 'GEMINI_API_KEY' : 'ANTHROPIC_API_KEY';
    env[inject] = token;
  }
  return env;
}

// ── Packaged-app native-CLI resolution ─────────────────────────────────────────────────────────
// Remap a node_modules path that lives inside the packed app.asar to its on-disk
// app.asar.unpacked twin (electron-builder copies asarUnpack matches there, leaving a stub in the
// asar). A path with no `/app.asar/` segment — dev, or already unpacked — is returned unchanged,
// so this is a no-op outside the packaged app.
export function asarUnpackedPath(resolved: string): string {
  return resolved.replace(`${sep}app.asar${sep}`, `${sep}app.asar.unpacked${sep}`);
}

// The Claude Agent SDK spawns a native `claude` CLI binary (~220 MB Mach-O) whose path it derives
// from its OWN module location (import.meta.url → createRequire → require.resolve of its optional
// platform package @anthropic-ai/claude-agent-sdk-<platform>-<arch>). PACKAGED, that location is
// inside app.asar — a regular FILE — so spawning the resolved path throws `spawn ENOTDIR` (the OS
// can't descend through a file). We resolve the same platform binary and return its
// app.asar.unpacked path; callers pass it as options.pathToClaudeCodeExecutable. Requires the SDK +
// its platform package in build.asarUnpack so the binary physically exists unpacked. DEV (no asar):
// return undefined so the SDK's own default resolution runs unchanged — which is why dev never hit
// this. Never throws: on any resolution failure return undefined and let the SDK surface its own
// "native CLI not found" error.
export function claudeExecutablePath(): string | undefined {
  const { app } = require('electron') as typeof import('electron');
  if (!app.isPackaged) return undefined;
  const exe = process.platform === 'win32' ? 'claude.exe' : 'claude';
  const platformPkg = `claude-agent-sdk-${process.platform}-${process.arch}`;
  // Resolve by the on-disk layout, NOT require.resolve — the SDK's package.json has an "exports"
  // map that forbids `require.resolve('@anthropic-ai/claude-agent-sdk/package.json')` (ERR_PACKAGE_
  // PATH_NOT_EXPORTED), which silently no-op'd the v0.5.1 attempt. electron-builder flattens
  // node_modules in the asar, so the unpacked native binary sits at this exact path.
  const direct = join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', '@anthropic-ai', platformPkg, exe);
  if (existsSync(direct)) return direct;
  // Fallback for a non-flattened (.pnpm) layout: resolve the platform package's binary file directly
  // (the binary file has no "exports" restriction) and remap the asar path into app.asar.unpacked.
  try {
    return asarUnpackedPath(require.resolve(`@anthropic-ai/${platformPkg}/${exe}`));
  } catch {
    return undefined;
  }
}

// Spread into a claude-agent-sdk query()'s `options` to point it at the unpacked native CLI when
// packaged: `query({ options: { ...claudePathOption(), env: ..., ... } })`. Empty (no-op) in dev.
export function claudePathOption(): { pathToClaudeCodeExecutable?: string } {
  const p = claudeExecutablePath();
  return p ? { pathToClaudeCodeExecutable: p } : {};
}
// sensible default model per runtime (the human can override at registration)
export const DEFAULT_MODEL: Record<RuntimeName, string> = {
  'claude-code': 'claude-opus-4-8',
  codex: 'gpt-5.5', // a model ChatGPT plans actually offer; `gpt-5-codex` is API-only and a subscription rejects it (the SDK falls back to the account default anyway)
  gemini: 'gemini-3.5-flash', // current GA workhorse (best for agentic/coding); 2.5-pro is prev-gen
};
export const RUNTIMES: RuntimeName[] = ['claude-code', 'codex', 'gemini'];

// the chat-teammate system prompt, shared by the non-Claude adapters' streamTurn
// (the Anthropic path keeps its own copy inline in claudeTurn). Mirrors it so a
// Codex/Gemini agent behaves identically in chat — work only via board offers.
//
// `instructions` is the agent's own standing rules (agents.brief). It rides the worker
// prompt, the chat-mode prompt and every subagent leg, and this was the ONE path that
// dropped it — so a hired specialist answering in its own task thread did so as a generic
// teammate, ignoring the remit it was hired for. Takes the agent's strings, not just a name.
export function chatSystemPrompt(agentName: string, channelSlug: string, instructions?: string | null): string {
  const remit = (instructions ?? '').trim();
  return styled(`You are ${agentName}, an AI teammate in the #${channelSlug} channel of a NeuraMesh workspace.${remit ? `\n\nYour standing instructions — they apply to this reply as much as to your board work:\n${remit}\n` : ''} Reply in concise chat style (1–3 sentences unless asked for more). Markdown is rendered: use it only where it aids scanning. Emojis only when they carry meaning — at most one, usually none. No filler, no repeated sign-offs.

When a human @mentions you here, respond if it's within your responsibility and ability — answer the question, give your read, or do the small thing asked if you can do it from chat. If it's outside your remit, say so in a line or hand it to the orchestrator; if there is genuinely nothing for you to add, reply with EXACTLY NO_REPLY to stay quiet (it won't be posted). Actual WORK still moves through the board — a task, repo change, or plan is delivered through an offer (claim → requirements → execute → submit), so don't promise or start it from chat; point them to the orchestrator. Never declare another teammate's open questions resolved — requirements are settled by the humans and the orchestrator in the task thread.`);
}

// the agentic coding-loop prompt for the CLIs (codex/gemini). Built from the same
// inputs as claudeCode's prompt, minus the Claude-only nm tools (screenshot /
// load_skill); the CLIs use their own built-in file+bash tools in the worktree.
// On a rework (a reviewer bounced the PR back), this is folded into the developer's
// prompt so it addresses the SPECIFIC comments and re-submits — instead of re-running
// the whole task from scratch and repeating the same mistakes (the review→rework loop).
// The worker's turn is a CONTRACT now (defaults/agents/worker.yaml). What stays here is the
// assembly — which blocks apply, parsing the checklist, joining lists — because that is logic,
// not language. Every string comes from the contract, so changing how a worker is told to work
// is an edit to a reviewed YAML file instead of a hunt through a template literal.
//
// Resolved as the WORKER contract whatever the agent's own role is: one execution turn serves a
// developer, a marketer drafting a deliverable and a researcher alike, exactly as the single
// literal it replaced did. Role voice rides `instructions`, injected alongside.
const wc = (): Record<string, string> => shippedContract('worker')?.prompt ?? {};
const B = (key: string, vars: Record<string, string | undefined> = {}): string =>
  composePrompt(wc()[key] ?? '', vars);

export function reworkBlock(notes: string | null | undefined, canRecordLesson = false): string {
  const n = (notes ?? '').trim();
  if (!n) return '';
  // the declare_beats + record_lesson nudges ride only where the nm tools exist (the
  // Claude path); CLI runtimes get their rework beat plan declared by the daemon's
  // first-pass and their lessons mined host-side after approval instead.
  const beatsNudge = canRecordLesson ? ` ${B('rework.beats')}` : '';
  const lessonNudge = canRecordLesson ? ` ${B('rework.lesson')}` : '';
  return `\n${B('rework', { notes: n })}\n${beatsNudge}${lessonNudge}`;
}

// `hasNmTools` (docs/harness/03): the CLI runtimes now receive the SAME nm toolset as the Claude
// path, over the loopback MCP bridge. Before the bus this prompt deliberately named none of them
// because they did not exist here — a prompt that named an absent tool would have been worse than
// silence. Now that they are real, the prompt has to say so, or the tools sit there unused: an
// agent uses the tools it is TOLD about, not the ones merely listed in a manifest.
export function nmToolsBlock(hasNmTools: boolean): string {
  return hasNmTools ? `\n${B('nm_tools')}` : '';
}

/** The system prompt for an execution turn — identity + this machine's standing instructions. */
export function codingSystemPrompt(agentName: string, repoBacked: boolean, instructions: string | null): string {
  return styled(B('system', {
    'agent.name': agentName,
    workspace: repoBacked ? 'git worktree' : 'scratch workspace',
    instructionsLine: instructions ? ` ${B('system.instructions', { instructions })}` : '',
  }));
}

export function buildCodingPrompt(t: ExecTask, channelBlock: string | null | undefined, repoBacked: boolean, skills?: SkillRef[], reworkNotes?: string, attachmentsNote?: string, lessonsNote?: string, brief?: string | null, hasNmTools = false): string {
  let checklist: string[] = [];
  try { checklist = t.requirements ? (JSON.parse(t.requirements) as string[]) : []; } catch { /* legacy rows */ }
  // claim-generated checklists are server-capped (3–5 × ≤160); orchestrator-set ones were
  // UNBOUNDED — cap at injection so one verbose intake cannot flood the turn (2026-08-18 audit)
  checklist = checklist.slice(0, 16).map((c) => (c.length > 300 ? `${c.slice(0, 300)} […]` : c));
  return composePrompt(wc()['turn'] ?? '', {
    'task.number': String(t.number),
    'task.title': t.title,
    briefBlock: brief ? `\n${B('brief', { brief })}\n` : '',
    checklistBlock: checklist.length ? `\n${B('checklist', { items: checklist.map((c) => `- ${c}`).join('\n') })}\n` : '',
    channelBlock: channelBlock ? `\n${B('channel', { channelBlock })}\n` : '',
    lessonsNote: lessonsNote ?? '',
    reworkBlock: reworkBlock(reworkNotes, hasNmTools),
    attachmentsNote: attachmentsNote ?? '',
    nmToolsBlock: nmToolsBlock(hasNmTools),
    skillsBlock: skills?.length
      ? `\n${B('skills', { items: skills.slice(0, 24).map((sk) => `- ${sk.name}${sk.pack_name ? ` (${sk.pack_name})` : ''}: ${(sk.description ?? '').slice(0, 90)}`).join('\n') })}\n${hasNmTools ? `${B('skills.load')}\n` : ''}`
      : '',
    where: repoBacked ? B('where.repo') : B('where.scratch'),
  });
}
