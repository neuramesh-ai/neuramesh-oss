// THE STARTER LANE FOR WORKER TURNS (2026-09-16, George: "build the starter worker lane too; we
// should be able to switch the active brain to starter at any point, and every agent in that thread
// re-seats onto it — that's the whole point").
//
// Until this round the metered proxy served ONE transport: the orchestrator's (host/orchturn.ts,
// `geminiDispatch` → /v1/starter/generate). Every worker-shaped turn — the execute loop, a spawned
// leg, the designer's round, the reviewer's verdict, the architect's draft, a chat reply — went
// through `runtimeFor(agent.runtime)`, and for the house model that meant the Gemini adapter, which
// drives the `agy` CLI on the user's Google login. A seat on the house model with no login therefore
// failed on the runner and posted an auth card on a laptop, which is why docs/10 §15.7's first cut had
// to say "the build legs still run on their own seats". This module closes that: the same function-
// calling loop the orchestrator runs on the proxy, over the SAME tool bus a Claude or Codex worker
// gets, plus the three file tools a worker needs to produce deliverables — and nothing else.
//
// What it deliberately does NOT have: a shell. The proxy is a model transport, not a machine; a
// Starter-seated worker writes its deliverables (a report, posts.json, a mockup's HTML) with
// `write_file`, reads what it staged with `read_file`, and reaches everything else through the nm
// bus. Repo-backed work that needs `git`, a build or a test run stays on a runtime with a login —
// the honest limit, said in the prompt so the model never promises a command it cannot run.
//
// The lane is set ONCE at boot (setStarterLane) with the coordinates the proxy needs — the API, the
// workspace, the actor the daemon signs as — so the adapter's signatures do not grow (docs/harness/06
// R1: an adapter takes what the seam gives it). Unset (a plain-node test, a daemon that never
// booted a host) it fails loudly rather than reaching for a vendor login it was told not to use.
import { resolve, sep } from 'node:path';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { STARTER_MODEL, type TurnKind } from '@neuramesh/shared';
import { invokeTool, outputToText, toolsForTurn, type ToolHost } from '../harness/toolbus';
import { beatsAdapter } from '../harness/turntools';
import { geminiOrchestratorTurn, starterGenerate } from '../host/orchturn';
import { instructionsFor } from '../host/turnkit';
import { buildCodingPrompt, codingSystemPrompt, type PermissionGate, type PromptOverride, type TurnOpts } from './adapter';
import type { OrchTool } from '../host/orchtools';
import type { ExecTask, HostedAgent, SkillRef } from '../agents';
import type { LogFn } from '../agentlog';

export interface StarterLane { apiUrl: string; workspace: string; actorId: string }
let lane: StarterLane | null = null;
export function setStarterLane(l: StarterLane | null): void { lane = l; }
export function starterLane(): StarterLane | null { return lane; }
function laneOrThrow(): StarterLane {
  if (!lane) throw new Error('the Starter lane is not configured on this host — no proxy coordinates were set at boot');
  return lane;
}

/** the house model with no credential of the user's own: the metered proxy serves it, never a
 *  vendor login. A user's own Gemini KEY (token set) still wins — their key, their bill. */
export const isStarterSeat = (model: string | null | undefined, token: string | null | undefined): boolean =>
  model === STARTER_MODEL && !token;

/** how many tool rounds a WORKER may take on the proxy — the orchestrator's 14 is a routing
 *  budget; a worker writing several files and advancing beats needs more, and the wall-clock
 *  budget (TURN_BUDGETS.work) is what really bounds it */
export const STARTER_WORKER_MAX_TURNS = 40;

// ── The file tools ─────────────────────────────────────────────────────────────────────────────
/** a model-supplied path resolved INSIDE the workspace, or null when it tries to leave it */
export function insideDir(dir: string, rel: string): string | null {
  if (!rel || typeof rel !== 'string') return null;
  const root = resolve(dir);
  const full = resolve(root, rel);
  return full === root || full.startsWith(root + sep) ? full : null;
}

function fileTools(dir: string, gate: PermissionGate | undefined, log?: LogFn): OrchTool[] {
  const allowed = async (tool: 'Write' | 'Read', file_path: string): Promise<string | null> => {
    if (!gate) return null;
    const g = await gate(tool, { file_path });
    return g.decision === 'allow' ? null : (g.reason ?? 'denied by policy');
  };
  return [
    { name: 'write_file', description: 'Write a file in your workspace (the deliverable, or a working file under .nm-evidence/). Paths are relative to the workspace root; parent folders are created. Overwrites.', schema: {
      path: z.string().min(1).describe('relative path, e.g. report.md or posts.json'),
      content: z.string().describe('the full file content'),
    }, run: async (i: { path: string; content: string }) => {
      const full = insideDir(dir, i.path);
      if (!full) return `refused: "${i.path}" is outside the workspace`;
      const no = await allowed('Write', full);
      if (no) return `refused: ${no}`;
      await mkdir(resolve(full, '..'), { recursive: true });
      await writeFile(full, i.content);
      log?.({ kind: 'tool', phase: 'call', summary: `write_file ${i.path} (${i.content.length}b)` });
      return `wrote ${i.path}`;
    } },
    { name: 'read_file', description: 'Read a file from your workspace (staged context, brand docs, your own drafts). Relative path.', schema: {
      path: z.string().min(1).describe('relative path'),
    }, run: async (i: { path: string }) => {
      const full = insideDir(dir, i.path);
      if (!full) return `refused: "${i.path}" is outside the workspace`;
      const no = await allowed('Read', full);
      if (no) return `refused: ${no}`;
      try { return (await readFile(full, 'utf8')).slice(0, 120_000); }
      catch (e) { return `read failed: ${e instanceof Error ? e.message : 'error'}`; }
    } },
    { name: 'list_files', description: 'List the files in your workspace (recursive, names relative to the root).', schema: {}, run: async () => {
      const out: string[] = [];
      const walk = async (d: string, rel: string): Promise<void> => {
        for (const e of await readdir(d).catch(() => [] as string[])) {
          if (e === 'node_modules' || (e.startsWith('.') && e !== '.nm-evidence')) continue;
          const p = resolve(d, e); const r = rel ? `${rel}/${e}` : e;
          const s = await stat(p).catch(() => null);
          if (!s) continue;
          if (s.isDirectory()) await walk(p, r); else if (out.length < 200) out.push(`${r} (${s.size}b)`);
        }
      };
      await walk(dir, '');
      return out.join('\n') || '(empty workspace)';
    } },
  ];
}

/** the bus tools of this turn, in the shape the Gemini loop drives (docs/harness/03 §3.4: delivery
 *  is the adapter's only job — here it is a direct call, no bridge, same registry) */
export function busToolsForStarter(kind: TurnKind, host: ToolHost): OrchTool[] {
  return toolsForTurn(kind, host).map((d) => ({
    name: d.name, description: d.description, schema: d.params,
    run: async (input: unknown) => outputToText((await invokeTool(kind, host, d.name, input)).output),
  }));
}

const STARTER_NOTE = '\n\n[YOUR RUNTIME — the NeuraMesh Starter brain. You have write_file / read_file / list_files for the workspace and the nm tools listed above; you have NO shell: do not promise to run commands, tests or builds — produce the deliverable files directly, validate by re-reading them, and say what you could not verify.]';

// ── The three seats of the adapter, on the proxy ───────────────────────────────────────────────
export async function starterComplete(system: string, user: string): Promise<string> {
  const l = laneOrThrow();
  const r: any = await starterGenerate({ apiUrl: l.apiUrl, workspace: l.workspace, actorId: l.actorId, contents: [{ role: 'user', parts: [{ text: user }] }], config: { systemInstruction: system } });
  return ((r.candidates?.[0]?.content?.parts ?? []).map((p: any) => p?.text).filter(Boolean).join('') as string).trim();
}

export async function starterRunQuery(
  agent: HostedAgent, t: ExecTask, dir: string, channelBlock: string | null | undefined, repoBacked: boolean,
  ac?: AbortController, log?: LogFn, skills?: SkillRef[],
  proposeSkill?: ToolHost['proposeSkill'], reworkNotes?: string, attachmentsNote?: string,
  recordLesson?: ToolHost['recordLesson'], lessonsNote?: string, promptOverride?: PromptOverride,
  addBacklogItem?: ToolHost['addBacklogItem'], beats?: { declare: (items: string[]) => Promise<void>; advance: (seq: number, status: string) => Promise<void> },
  permissionGate?: PermissionGate, opts?: TurnOpts,
): Promise<string> {
  const l = laneOrThrow();
  const kind: TurnKind = opts?.turnKind ?? (promptOverride ? 'design' : 'work');
  // the SAME host the CLI adapters build for the bus — a design round carries no beats (mirrors
  // claudeCode: the round is not a phase the worker owns), a leg carries no subtasks by kind
  const host: ToolHost = { dir, log, skills, proposeSkill, recordLesson, addBacklogItem,
    ...(beats && !promptOverride ? { beats: beatsAdapter(beats) } : {}),
    ...(opts?.spawn ? { spawn: opts.spawn } : {}), ...(opts?.park ? { park: opts.park } : {}), ...(opts?.whiteboards ? { whiteboards: opts.whiteboards } : {}),
    ...(opts?.searchX ? { searchX: opts.searchX } : {}), ...(opts?.draftReplies ? { draftReplies: opts.draftReplies } : {}) };
  const tools = [...busToolsForStarter(kind, host), ...fileTools(dir, permissionGate, log)];
  log?.({ kind: 'tool', phase: 'inject', summary: `${tools.length} tools on the Starter lane (${kind} turn) — bus + files, no shell` });
  const prompt = (promptOverride?.prompt ?? buildCodingPrompt(t, channelBlock, repoBacked, skills, reworkNotes, attachmentsNote, lessonsNote, agent.brief, true)) + STARTER_NOTE;
  const systemPrompt = promptOverride?.system ?? codingSystemPrompt(agent.name, repoBacked, instructionsFor(agent));
  const started = Date.now();
  const out = await geminiOrchestratorTurn({ model: STARTER_MODEL, token: '', systemPrompt, transcript: prompt, tools, log, starter: true, apiUrl: l.apiUrl, workspace: l.workspace, actorId: l.actorId, maxTurns: STARTER_WORKER_MAX_TURNS, abort: ac?.signal });
  log?.({ kind: 'result', phase: 'success', summary: `completed ${Math.round((Date.now() - started) / 1000)}s · starter` });
  return out.trim() || '(no summary)';
}

// the fallback door is configured beside the lane, so agents.ts pays one import for both (host/starterfallback.ts)
export { configureStarterFallback } from '../host/starterfallback';
