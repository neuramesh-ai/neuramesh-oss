// The tool bus (docs/harness/03) — ONE registry for every nm tool, keyed by turn kind, and the only
// path from a model to an effect.
//
// The defect it ends: `RuntimeAdapter.runQuery` took 19 positional parameters, six of which were
// tools, and the Codex/Gemini adapters ignored all six. So `record_lesson`, `add_backlog_item`,
// `declare_beats` and friends were "Claude-tool only today" — a Codex-seated worker silently could
// not record a lesson or park a discovery, and beats degraded to asking the model to echo
// `NM_BEAT_DONE` into stdout (progress tracking whose reliability was model etiquette).
//
// Here a tool is declared ONCE. Availability comes from `toolsForKind` in shared — the runtime is
// deliberately not an input. Delivery differs per runtime and is the adapter's only remaining job:
// in-process for the Claude SDK, the loopback MCP bridge (runtime/orchmcp.ts) for the CLIs.
//
// Run: pnpm exec tsx --test src/main/harness/toolbus.test.ts
import { z, type ZodRawShape } from 'zod';
import { toolsForKind, type NmTool, type TurnKind } from '@neuramesh/shared';
import type { LogFn } from '../agentlog';
import { jsonSchemaFor } from './toolschema';

/** What a tool returns. `image` rides the Claude path as an image block and degrades to its note elsewhere. */
export type ToolOutput = { kind: 'text'; text: string } | { kind: 'image'; base64: string; mime: string; note: string };

export const text = (t: string): ToolOutput => ({ kind: 'text', text: t });

/** The impure operations a tool needs, injected by the daemon — the existing closure idiom, gathered. */
export interface ToolHost {
  /** the turn's working directory (worktree, scratch dir, or chat workspace) */
  dir: string;
  log?: LogFn;
  skills?: Array<{ name: string; description: string; body: string; pack_name?: string | null }>;
  proposeSkill?: (i: { name: string; description: string; scope: 'channel' | 'global'; body: string }) => Promise<{ ok: boolean; error?: string }>;
  recordLesson?: (i: { lesson: string }) => Promise<{ ok: boolean; error?: string }>;
  addBacklogItem?: (i: { title: string; description?: string; parent?: boolean }) => Promise<{ ok: boolean; number?: number; error?: string }>;
  beats?: { declare: (steps: string[]) => string; complete: (step: number, blocked: boolean) => string };
  /** render a static .html file or a running URL to a PNG in `dir`; returns the bytes + the file name */
  screenshot?: (i: { file?: string; url?: string; name?: string; width?: number; height?: number }) => Promise<{ png: Buffer; outName: string }>;
  /**
   * Fan out a subagent (docs/harness/04). The host owns seating, budget slicing and the child run;
   * this closure exists so the TOOL stays declarative and the ownership rules live in one place.
   */
  spawn?: (i: { role: string; prompt: string; label?: string }) => Promise<{ ok: boolean; summary?: string; error?: string }>;
  /**
   * End this turn cleanly with a wake condition (docs/harness/05 §3.8). The host records it and the
   * dispatcher re-admits later; the turn does NOT submit.
   */
  park?: (i: { until: string; prNumber?: number; afterMinutes?: number; note: string }) => Promise<{ ok: boolean; error?: string }>;
  /** whiteboards (docs/38): the four closures — reads workspace-wide, writes rev-guarded */
  whiteboards?: WhiteboardToolClosures;
  /** X reads on a research leg (marketing-os round) — the host/searchx.ts impl, closed over
   *  the leg's room; absent = the tool never exists (a build room's leg has no X to read) */
  searchX?: (i: { query: string; max?: number }) => Promise<string>;
  /** the reply card (reply-radar) — host/replycard.ts closed over the turn's thread */
  draftReplies?: (i: { report?: string; baseline?: string; replies: unknown[] }) => Promise<string>;
}

/** Whiteboards (docs/38): what the daemon injects. One bundle, built once per turn, shared by the
 *  bus DEFS below and the Claude in-process clones — so the wording of an outcome lives here-adjacent
 *  and the transport never decides behaviour. */
export interface WhiteboardToolClosures {
  list(i: { all?: boolean }): Promise<{ ok: boolean; lines?: string; error?: string }>;
  read(i: { id: string }): Promise<{ ok: boolean; text?: string; error?: string }>;
  create(i: { title: string; mermaid?: string; elements?: string }): Promise<{ ok: boolean; id?: string; error?: string }>;
  update(i: { id: string; baseRev: number; title?: string; mermaid?: string; elements?: string }): Promise<{ ok: boolean; rev?: number; error?: string }>;
}

export interface ToolDef {
  name: NmTool;
  description: string;
  /** the zod shape — used to VALIDATE, and handed to the Claude SDK's tool() as-is */
  params: ZodRawShape;
  run: (host: ToolHost, input: Record<string, unknown>) => Promise<ToolOutput>;
}

// ── The catalogue ─────────────────────────────────────────────────────────────────────────────
// Descriptions are lifted verbatim from the shipped Claude tools: they are load-bearing prompt
// surface that has been tuned against real agent behaviour, and rewording them here would be an
// undeclared behaviour change riding a refactor.

import { DEFS } from './tooldefs';


/** Every definition, catalogue order. */
export function allToolDefs(): ToolDef[] {
  return [...DEFS];
}

/**
 * The tools a turn may call — availability by turn kind, from the shared matrix.
 *
 * `have` filters further by what the host can actually service: a turn with no `recordLesson`
 * closure must not ADVERTISE record_lesson, because a tool that exists and always answers
 * "unavailable here" teaches the model to distrust its toolset.
 */
export function toolsForTurn(kind: TurnKind, host: ToolHost): ToolDef[] {
  const available = new Set<NmTool>(toolsForKind(kind));
  return DEFS.filter((d) => available.has(d.name) && serviceable(d.name, host));
}

function serviceable(name: NmTool, host: ToolHost): boolean {
  switch (name) {
    case 'screenshot': return !!host.screenshot;
    case 'load_skill': return (host.skills?.length ?? 0) > 0;
    case 'propose_skill': return !!host.proposeSkill;
    case 'record_lesson': return !!host.recordLesson;
    case 'add_backlog_item':
    case 'add_subtask': return !!host.addBacklogItem;
    case 'declare_beats':
    case 'advance_beat': return !!host.beats;
    case 'spawn': return !!host.spawn;
    case 'park': return !!host.park;
    case 'create_whiteboard':
    case 'update_whiteboard':
    case 'list_whiteboards':
    case 'read_whiteboard': return !!host.whiteboards;
    case 'search_x': return !!host.searchX;
    case 'draft_replies': return !!host.draftReplies;
  }
}

// ── Hooks (docs/harness/03 §3.3, phase P5) ────────────────────────────────────────────────────
// pre_tool / post_tool, machine-local, riding the SAME choke point as everything else — so a hook
// cannot be bypassed either.
//
// The one rule that keeps hooks from becoming a security hole: **a hook may DENY, never GRANT.** Its
// verdict is intersected with the policy verdict, never unioned. Otherwise a workspace config becomes
// a privilege-escalation path around `evaluatePolicy`, which is exactly what the policy engine exists
// to prevent.
export type PreToolHook = (call: { name: string; input: Record<string, unknown> }) => Promise<{ deny?: string } | void>;
export type PostToolHook = (call: { name: string; input: Record<string, unknown>; output: ToolOutput }) => Promise<void>;

export interface Hooks { pre?: PreToolHook[]; post?: PostToolHook[] }

/**
 * Run the pre-tool hooks, returning the FIRST denial.
 *
 * A throwing hook is ignored rather than fatal: a broken lint hook must not take the agent loop down,
 * and — critically — must not accidentally block work either, which a fail-closed hook would.
 */
export async function runPreHooks(hooks: Hooks | undefined, name: string, input: Record<string, unknown>): Promise<string | null> {
  for (const h of hooks?.pre ?? []) {
    try {
      const r = await h({ name, input });
      if (r && r.deny) return r.deny;
    } catch { /* a broken hook is not a veto and not an outage */ }
  }
  return null;
}

export async function runPostHooks(hooks: Hooks | undefined, name: string, input: Record<string, unknown>, output: ToolOutput): Promise<void> {
  for (const h of hooks?.post ?? []) {
    try { await h({ name, input, output }); } catch { /* observability, never correctness */ }
  }
}

// ── Invocation: the one path, so validation and logging cannot be skipped ──────────────────────
export interface InvokeOutcome { output: ToolOutput; rejected?: 'unavailable' | 'invalid' | 'denied' }

/**
 * Call a tool by name for a turn.
 *
 * Two refusals happen here rather than inside a tool, so every runtime gets them identically:
 * a name outside the turn's toolset is a HARD error (not a silent no-op — that is how a registry
 * mistake stays invisible), and invalid input is returned to the MODEL with the validation message
 * so it can correct itself, which is the same shape a rejected tool input already has.
 */
/**
 * The codex accommodation (2026-08-26, found live).
 *
 * A codex-seated worker delivers structured arguments as JSON STRINGS: `replies: "[{…}]"` where
 * the schema declares an array. Validation then rejects the call before `run` ever sees it, and
 * codex reports it to the model as "the MCP call was cancelled by the tool layer" — which is how
 * a marketer spent a whole run writing its drafted replies into a markdown report instead of
 * handing them over as a card, and said so honestly in its delivery note.
 *
 * The same normalization `resolvePlaybookInputs` already does for `inputs` (that one bit first:
 * a stringified object was exploded into characters and became a unit titled `{, ", c, o, m…`).
 * Parse a string ONLY where the schema wants an array or an object, and only when it parses to
 * that shape — anything else is left exactly as sent, so a genuine string argument is untouched.
 */
function unstringifyArgs(params: ZodRawShape, input: unknown): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  const out: Record<string, unknown> = { ...(input as Record<string, unknown>) };
  for (const [key, schema] of Object.entries(params)) {
    if (typeof out[key] !== 'string') continue;
    let node = schema as { _def?: { typeName?: string; innerType?: unknown } };
    while (node._def?.typeName === 'ZodOptional' || node._def?.typeName === 'ZodDefault') node = node._def.innerType as typeof node;
    const wants = node._def?.typeName;
    if (wants !== 'ZodArray' && wants !== 'ZodObject') continue;
    try {
      const parsed: unknown = JSON.parse(out[key] as string);
      const ok = wants === 'ZodArray' ? Array.isArray(parsed) : !!parsed && typeof parsed === 'object' && !Array.isArray(parsed);
      if (ok) out[key] = parsed;
    } catch { /* not JSON — leave it, and let validation say so honestly */ }
  }
  return out;
}

export async function invokeTool(kind: TurnKind, host: ToolHost, name: string, input: unknown, hooks?: Hooks): Promise<InvokeOutcome> {
  const def = toolsForTurn(kind, host).find((d) => d.name === name);
  if (!def) return { output: text(`no such tool "${name}" for a ${kind} turn`), rejected: 'unavailable' };
  const parsed = z.object(def.params).safeParse(unstringifyArgs(def.params, input ?? {}));
  if (!parsed.success) {
    const why = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
    host.log?.({ kind: 'tool', phase: 'result', summary: `${name} rejected: ${why.slice(0, 160)}`, level: 'warn' });
    return { output: text(`invalid input for ${name} — ${why}`), rejected: 'invalid' };
  }
  const args = parsed.data as Record<string, unknown>;
  const denied = await runPreHooks(hooks, name, args);
  if (denied) {
    host.log?.({ kind: 'tool', phase: 'result', summary: `${name} denied by a hook: ${denied.slice(0, 140)}`, level: 'warn' });
    return { output: text(`${name} was denied: ${denied}`), rejected: 'denied' };
  }
  try {
    const output = await def.run(host, args);
    await runPostHooks(hooks, name, args, output);
    return { output };
  } catch (err) {
    // a throwing tool must not kill the turn: the model sees the failure and can adapt
    const msg = err instanceof Error ? err.message : 'tool failed';
    host.log?.({ kind: 'tool', phase: 'result', summary: `${name} threw: ${msg.slice(0, 160)}`, level: 'warn' });
    return { output: text(`${name} failed: ${msg}`) };
  }
}

/** Flatten a ToolOutput to the single text string the MCP bridge transports. */
export function outputToText(o: ToolOutput): string {
  return o.kind === 'text' ? o.text : o.note;
}

/**
 * The turn's tools as loopback-bridge tools (runtime/orchmcp.ts `BridgeTool`).
 *
 * This is the whole reason a Codex or Gemini agent gains parity: the bridge already existed for the
 * orchestrator's tools on `agy`, guarded by a per-turn secret on 127.0.0.1. Generalizing its SCOPE —
 * every turn kind, every CLI runtime — is what closes the capability drift, with no new transport.
 *
 * Images degrade to their note: MCP text transport cannot carry an image block, and a CLI runtime
 * would not render one anyway. The PNG is still written into the workspace and still attaches as an
 * artifact, so the human loses nothing; only the model's own view of its render is lost.
 */
export function bridgeToolsForTurn(kind: TurnKind, host: ToolHost, hooks?: Hooks): Array<{ name: string; description: string; inputSchema: unknown; run: (input: unknown) => Promise<string> }> {
  return toolsForTurn(kind, host).map((d) => ({
    name: d.name,
    description: d.description,
    inputSchema: jsonSchemaFor(d.params),
    run: async (input: unknown) => outputToText((await invokeTool(kind, host, d.name, input, hooks)).output),
  }));
}
