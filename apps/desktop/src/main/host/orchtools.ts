// THE ORCHESTRATOR'S TOOL REGISTRY — extracted from agents.ts (track B2).
//
// One definition per tool, consumed by BOTH brains: the Anthropic transport wraps each in the
// Agent SDK's tool(), the Gemini transport renders them as function declarations. That is why
// the registry is data — a tool the shared catalogue grants (toolAvailable) cannot be silently
// withheld by one transport, and a tool that does not exist here cannot be prompted into being.
//
// It leaves startAgentHost by taking what it needs: makeOrchTools(ctx) destructures the host's
// services and returns the same function the closure held, so every call inside the body — and
// both call sites — keep working unchanged.




import { TASK_KINDS, toolAvailable, type NmTool, type TurnKind } from '@neuramesh/shared';
import { WB_CREATE_DESC, WB_LIST_DESC, WB_READ_DESC, WB_UPDATE_DESC } from '../harness/tooldesc';

import type { PowerSyncDatabase } from '@powersync/node';
import { type HostedAgent, type SkillRef } from '../agents';
import type { LogFn } from '../agentlog';
import type { HostCtx } from './ctx';
import type { Brain, SubjectRef } from '../harness/brain';
import type { WorkLeg } from '../runs';
import type { WhiteboardToolClosures } from '../harness/toolbus';
import { boardTools } from './tools-board';
import { routeTools } from './tools-route';
import { contentTools } from './tools-content';
import { newGrounding, type Grounding } from './grounding';
import { replyTools } from './tools-replies';
import { contextTools } from './tools-context';
import { roomTools } from './tools-room';
import { playbookTools } from './tools-playbooks';
import { repoTools } from './tools-repo';

/** a library document as the registry hands it to a tool */
/** What a tool group needs to answer for THIS turn. Turn-scoped by design: a tool that closed
 *  over a previous turn's seat or thread would spend the wrong credential or answer in the wrong
 *  place, which is why every group takes this rather than reaching for a module-level value. */
export interface ToolCtx {
  /** what this turn has read from the shelf (host/grounding.ts): draft_posts asks it before it writes */
  grounding: Grounding;
  z: typeof import('zod')['z'];
  db: PowerSyncDatabase;
  post: HostCtx['post'];
  ch: { id: string; slug: string; workspace_id: string };
  agent: HostedAgent;
  actor: { kind: string; id: string; role?: string };
  thread?: { id: string; number: number; title: string; state: string };
  convoThreadId?: string | null;
  deepWorkToken: string;
  kind: TurnKind;
  spawnLeg?: (i: { role: string; prompt: string; label?: string }) => Promise<{ ok: boolean; summary?: string; error?: string }>;
  log?: LogFn;
  skills: SkillRef[];
  draftsHere: (statuses?: readonly string[]) => Promise<{ posts: DraftRow[]; msgAnchor: { taskId: string } | { threadId: string } } | null>;
  /** the room a filed conversation is now in — `here()`, never ch.id, once auto-filing has moved it */
  here: () => string;
  /** set by file_conversation; `here()` reads it. A holder, because an import cannot assign. */
  filed: { to: { id: string; slug: string } | null };
  /** task number → id, seeded with this thread so the common case costs no query */
  known: Map<number, string>;
  /** the shared `kind` field — one enum, one description, so every routing tool asks the same way */
  kindField: import('zod').ZodTypeAny;
  taskByNumber: (num: number) => Promise<{ id: string } | null>;
  resolveRepoBinding: (repoName?: string, repoUrl?: string) => Promise<{ repo?: { id: string; default_branch: string }; label?: string; error?: string }>;
  /** the rooms this conversation may be filed into, resolved before the turn and written into
   *  file_conversation's description — the set is small, so a list_channels call would be a
   *  round trip to learn something already known */
  roomMenu: string;
  siblings: Array<{ id: string; slug: string; topic: string | null; kind: string | null; marketing: string | null }>;
  wbReads: OrchTool[];
  wbWrites: OrchTool[];
  agents: Map<string, HostedAgent>;
  apiGet: (path: string, actor: { kind: string; id: string; role?: string }) => Promise<any>;
  brain: Brain;
  buildScheduleCard: (action: 'schedule' | 'unschedule', items: Array<{ item: string; letter: string; platform: string; slot?: string; preview: string }>, question: string) => string;
  ensureChatWorkspace: (threadId: string) => string;
  executeHire: (orch: HostedAgent, channelId: string, input: { name: string; role: string; description?: string | null; brief?: string | null }) => Promise<{ ok: boolean; rehired: boolean; degradedToAdd: boolean; model?: string; runtime?: string; detail: string }>;
  generateDraftImage: (agent: HostedAgent, ch: { id: string; slug: string; workspace_id: string }, itemId: string) => Promise<string>;
  generateShareImage: (agent: HostedAgent, ch: { id: string; slug: string; workspace_id: string }, brief: string) => Promise<{ thumb?: string; error?: string }>;
  libraryDocs: (channelId: string, limit?: number, scope?: 'room' | 'project' | 'workspace') => Promise<LibDoc[]>;
  startDeepWork: (agent: HostedAgent, ch: { id: string; slug: string; workspace_id: string }, where: { threadId?: string | null; taskId?: string | null }, title: string, legs: WorkLeg[], token: string) => Promise<string | null>;
  subjectFor: (t: { thread?: { number: number } | null; convoThreadId?: string | null }) => SubjectRef | null;
  workspaceListing: (subject: SubjectRef, cap?: number) => Array<{ name: string; bytes: number; modified: string }>;
  workspaceRead: (subject: SubjectRef, name: string, cap?: number) => { ok: true; body: string } | { ok: false; error: string };
}


export interface LibDoc { name: string; kind: string; created_at: string; promoted: number | null; inline_content: string | null; mime?: string | null; room?: string | null; project?: string | null }
/** one drafted post row, as `draft_posts`/`revise_posts` see it */
export type DraftRow = { id: string; platform: string; body: string; status: string; scheduled_at: string | null; letter: string };

// orchestrator tools: every mutation goes through the enforced command API
// as the orchestrator actor — decomposition is model judgment, but offers,
// registration scope, and the FSM are server law it cannot bypass.
// With `thread` set, the turn runs INSIDE a task thread (intake mode): the
// reply posts to the thread, and resolution ends in offer_task.
// The orchestrator's tool set, provider-agnostic: each tool is { name, description, schema (a zod
// shape), run(input) → string }. BOTH brains consume this — the Anthropic transport wraps each in
// the Agent SDK's tool(); the Gemini transport renders them as function declarations — so the two
// stay in lock-step from one definition. (Closes over the host's db + post.)
export interface OrchTool { name: string; description: string; schema: Record<string, import('zod').ZodTypeAny>; run: (input: any) => Promise<string> }

/**
 * Per-sweep toolsets — exactly what each sweep prompt (orchsweeps.ts) instructs, nothing more.
 * A digest reads the board and posts a summary; the watchdog relays verdicts and re-offers; the
 * monitor may additionally route legacy tasks and create (plan-first) for a dropped request.
 * The manifest test (orchregistry.test.ts) pins each set against the BUILT registry.
 */
const SWEEP_TOOLSETS: Record<'digest' | 'watchdog' | 'monitor', readonly string[]> = {
  digest: ['list_tasks', 'task_status', 'list_backlog', 'recall', 'post_thread'],
  watchdog: ['list_tasks', 'task_status', 'list_agents', 'recall', 'post_thread',
             'offer_task', 'request_changes', 'revise_design', 'revise_plan', 'revise_ship_plan', 'request_verdict'],
  // A SELF-CHECK NEVER CREATES WORK (George, 2026-09-19: "rex creates random tickets on its own").
  // #1096 "Draft grounded Flowe UGC scripts" was born from the monitor: a human's ask got a
  // tool-less prose answer, and ten minutes later the periodic check judged it "a request that
  // fell through" and minted a unit with a plan. The monitor routes and nudges EXISTING work; the
  // human's own word (or a routine they armed) is the only thing that creates a unit. Enforced by
  // the inventory, not the prompt: create_task and propose_impl_plan are absent here.
  monitor: ['list_tasks', 'task_status', 'list_agents', 'list_backlog', 'recall', 'post_thread',
            'offer_task', 'request_changes', 'revise_design', 'revise_plan', 'request_verdict',
            'request_design', 'request_plan'],
};

export function makeOrchTools(ctx: HostCtx & {
  db: PowerSyncDatabase;
  agents: Map<string, HostedAgent>;
  apiGet: (path: string, actor: { kind: string; id: string; role?: string }) => Promise<any>;
  brain: Brain;
  buildScheduleCard: (action: 'schedule' | 'unschedule', items: Array<{ item: string; letter: string; platform: string; slot?: string; preview: string }>, question: string) => string;
  draftsForAnchor: (taskId: string | null, threadId: string | null) => Promise<{ posts: DraftRow[]; msgAnchor: { taskId: string } | { threadId: string } } | null>;
  ensureChatWorkspace: (threadId: string) => string;
  executeHire: (orch: HostedAgent, channelId: string, input: { name: string; role: string; description?: string | null; brief?: string | null }) => Promise<{ ok: boolean; rehired: boolean; degradedToAdd: boolean; model?: string; runtime?: string; detail: string }>;
  generateDraftImage: (agent: HostedAgent, ch: { id: string; slug: string; workspace_id: string }, itemId: string) => Promise<string>;
  generateShareImage: (agent: HostedAgent, ch: { id: string; slug: string; workspace_id: string }, brief: string) => Promise<{ thumb?: string; error?: string }>;
  libraryDocs: (channelId: string, limit?: number, scope?: 'room' | 'project' | 'workspace') => Promise<LibDoc[]>;
  startDeepWork: (agent: HostedAgent, ch: { id: string; slug: string; workspace_id: string }, where: { threadId?: string | null; taskId?: string | null }, title: string, legs: WorkLeg[], token: string) => Promise<string | null>;
  subjectFor: (t: { thread?: { number: number } | null; convoThreadId?: string | null }) => SubjectRef | null;
  whiteboardClosures: (actor: { kind: string; id: string; role?: string }, ch: { id: string; workspace_id: string }, at: { taskId?: string; threadId?: string }) => WhiteboardToolClosures;
  workspaceListing: (subject: SubjectRef, cap?: number) => Array<{ name: string; bytes: number; modified: string }>;
  workspaceRead: (subject: SubjectRef, name: string, cap?: number) => { ok: true; body: string } | { ok: false; error: string };
}) {
const { post, db, agents, apiGet, brain, buildScheduleCard, draftsForAnchor, ensureChatWorkspace, executeHire,
        generateDraftImage, generateShareImage, libraryDocs, startDeepWork, subjectFor, whiteboardClosures, workspaceListing, workspaceRead } = ctx;

async function buildOrchestratorTools(ctx: {
  ch: { id: string; slug: string; workspace_id: string };
  agent: HostedAgent;
  actor: { kind: string; id: string; role?: string };
  skills: SkillRef[];
  log?: LogFn;
  thread?: { id: string; number: number; title: string; state: string };
  // the conversation this turn continues — create_task links it (threads.task_id)
  convoThreadId?: string | null;
  // the resolved provider credential: deep work keeps running AFTER this turn, so its
  // legs need the seat the turn was granted (never re-resolved from a dead wake's context)
  token: string;
  /**
   * What this turn IS, in the shared catalogue's terms — `triage` routing a room message, `own`
   * advancing a task it holds, `sweep` for the digest/watchdog tick. Availability reads from it
   * (toolAvailable), so a tool the catalogue grants cannot be silently withheld here.
   */
  kind: TurnKind;
  /**
   * Which sweep this is, when kind='sweep' — each gets the toolset its job needs and NOTHING
   * else. Before this, every 15-minute tick carried the full ~31K-char registry to usually
   * answer NO_REPLY, including five content tools that are refuse-by-construction on a sweep
   * (no thread anchor) — the audit's largest recurring silent spend (2026-08-18).
   */
  sweepScope?: 'digest' | 'watchdog' | 'monitor';
  /**
   * The turn's fan-out (docs/harness/04). Optional so a sweep/digest turn — which has no run to
   * parent legs onto and no human waiting — simply has no spawn tool rather than a broken one.
   */
  spawn?: (i: { role: string; prompt: string; label?: string }) => Promise<{ ok: boolean; summary?: string; error?: string }>;
}): Promise<OrchTool[]> {
  const { z } = await import('zod');
  const { ch, agent, actor, skills, log, thread, convoThreadId, token: deepWorkToken, kind, spawn: spawnLeg } = ctx;
  // the room's kind — a marketing HQ gets the brand/calendar CONTEXT in its prompt. It is no
  // longer what decides whether the content TOOLS exist (see draft_posts).

  // this turn's drafts, resolved once (see draftsForAnchor)
  const draftsHere = async (statuses?: readonly string[]): ReturnType<typeof draftsForAnchor> => {
    const found = await draftsForAnchor(thread?.id ?? null, convoThreadId ?? null);
    return found && statuses ? { ...found, posts: found.posts.filter((p) => statuses.includes(p.status)) } : found;
  };
  // work-type label the orchestrator sets at triage (docs/16). A routing PRIOR, never a
  // gate: set it from what the work IS; the route (design/plan/direct) is your per-request
  // judgment and ANY kind may take ANY route. Required to route (request_plan/design/offer).
  const kindField = z
    .enum(TASK_KINDS)
    .describe('work-type: bug · feature · refactor · chore · docs · research · spike · design — the label, a prior for the route, never a gate');

  // ── auto-filing (0109) ────────────────────────────────────────────────────────────────────
  // THE TRAP this variable exists for: every tool below binds `ch.id`, the channel the wake
  // arrived on. File the conversation into #dev and then create_task in the same turn, and the
  // task lands in the room you just left — the conversation in one room, its work in another,
  // which is worse than the guess auto-filing replaces. So the move rebinds the turn, and
  // everything downstream reads `here()` rather than `ch.id`.
  // file_conversation rebinds the turn mid-flight (tools-room.ts), and a module cannot assign a
  // caller's `let` — so the filed room travels as a holder both sides read through.
  const filed: { to: { id: string; slug: string } | null } = { to: null };
  const here = () => filed.to?.id ?? ch.id;
  // The rooms it may file into, resolved HERE and written into the tool's description rather
  // than behind a `list_channels` call: the set is small, it is known before the turn starts,
  // and a tool that has to be looked up first is a round-trip spent on a label. Same project
  // only — every project is seeded with the same starter slugs, so a bare `dev` names two rooms
  // across a workspace, and a cross-project move is refused by the server anyway.
  const siblings = await db.getAll<{ id: string; slug: string; topic: string | null; kind: string | null; marketing: string | null }>(
    `select id, slug, topic, kind, marketing from channels
      where workspace_id = ?
        and project_id is not distinct from (select project_id from channels where id = ?)
      order by slug`,
    [ch.workspace_id, ch.id],
  ).catch(() => [] as Array<{ id: string; slug: string; topic: string | null; kind: string | null; marketing: string | null }>);
  // Each room's KIND rides the menu, not just its name. Seen live 2026-08-03: rex filed a
  // post-drafting request into a room called #marketing with the reason "that room owns the
  // calendar and crew" — it owned neither, because its kind was still `build`. The name was the
  // only thing it had to reason from, so it reasoned from the name. A set-up marketing HQ is a
  // genuinely different room (its own calendar, library, connectors and content flow); a room
  // merely CALLED marketing is a normal room, and filing into it buys nothing.
  const roomMenu = siblings.map((c) => {
    const hq = c.kind === 'marketing' ? (c.marketing ? ' [marketing HQ — calendar, library, connectors]' : ' [marketing room, not set up yet]') : '';
    return `#${c.slug}${hq}${c.topic ? ` — ${c.topic}` : ''}`;
  }).join(' · ');
  // the create→post_thread→offer chain must not depend on sync latency: create_task records
  // number→id from the API response, and a thread wake seeds the task it runs in. The replica
  // lookup (with retry) only covers numbers from outside this turn (the model citing older work).
  const known = new Map<number, string>();
  if (thread) known.set(thread.number, thread.id);
  const taskByNumber = async (num: number): Promise<{ id: string } | null> => {
    const hit = known.get(num);
    if (hit) return { id: hit };
    for (let i = 0; i < 20; i++) {
      const [t] = await db.getAll<{ id: string }>(`select id from tasks where channel_id = ? and number = ?`, [ch.id, num]);
      if (t) return t;
      await new Promise((r) => setTimeout(r, 600));
    }
    return null;
  };
  // ── Whiteboards (docs/38) ─────────────────────────────────────────────────────────────────
  // THE DEFECT this closes, reported live 2026-08-08: asked in a Tasks-on room to "draft a
  // whiteboard diagram for the platform architecture", rex proposed a markdown file with a
  // mermaid fence in it. Its contract has said "a diagram through create_whiteboard" since the
  // deliverable-is-not-a-task ruling — but this registry never carried the tool, so the
  // instruction named something that did not exist and the model reached for the nearest thing
  // that did (propose_library_doc). Same shape as `spawn` above and as draft_posts (0115): a
  // capability granted in the shared catalogue and never delivered by the registry.
  //
  // AVAILABILITY IS THE CATALOGUE'S CALL, never a local heuristic. The first cut of this gated
  // writes on having a thread or task to anchor the card to — and the live run failed on it: the
  // ask arrived as a room message that had not birthed a thread yet, so rex got the reads only
  // and answered "whiteboard tooling isn't wired into this room", then drew the diagram in Claude
  // Design instead (which ToolSearch can still reach). A turn kind is what decides — `sweep` has
  // no whiteboard tools at all, a human-triggered turn has them all — and the anchor is only
  // where the card lands: its thread, its task, or the room, exactly like the reply itself.
  const wbAt = convoThreadId ? { threadId: convoThreadId } : thread?.id ? { taskId: thread.id } : {};
  const wb = whiteboardClosures(actor, ch, wbAt);
  const wbReads: OrchTool[] = [
    { name: 'list_whiteboards', description: WB_LIST_DESC, schema: {
      all: z.boolean().optional().describe('true to look across the whole workspace, not just this room'),
    }, run: async (input) => {
      const r = await wb.list({ all: input.all === true });
      return r.ok ? r.lines ?? '(none)' : `list failed: ${r.error ?? 'error'}`;
    } },
    { name: 'read_whiteboard', description: WB_READ_DESC, schema: {
      id: z.string().min(1).describe('the whiteboard id'),
    }, run: async (input) => {
      const r = await wb.read({ id: String(input.id) });
      return r.ok ? r.text ?? '(empty board)' : `read failed: ${r.error ?? 'error'}`;
    } },
  ];
  const wbWrites: OrchTool[] = [
    { name: 'create_whiteboard', description: WB_CREATE_DESC, schema: {
      title: z.string().min(1).max(200).describe('a short name for the board'),
      mermaid: z.string().min(1).max(100_000).optional().describe('mermaid source — flowchart/sequence/class arrive as EDITABLE shapes'),
      elements: z.string().min(1).max(200_000).optional().describe('an Excalidraw element-skeleton JSON array AS A STRING'),
    }, run: async (input) => {
      if (!input.mermaid === !input.elements) return 'provide exactly one of `mermaid` or `elements`';
      const r = await wb.create({ title: String(input.title), ...(input.mermaid ? { mermaid: String(input.mermaid) } : {}), ...(input.elements ? { elements: String(input.elements) } : {}) });
      log?.({ kind: 'tool', phase: 'call', summary: `create_whiteboard "${String(input.title).slice(0, 60)}"${r.ok ? '' : ' (failed)'}`, level: r.ok ? 'info' : 'warn' });
      return r.ok
        ? `whiteboard "${input.title}" created (id ${r.id}) — its card is already in this thread, and the human can open, edit and share it. Do NOT paste the diagram source into your reply: one line naming what you drew.`
        : `create failed: ${r.error ?? 'error'}`;
    } },
    { name: 'update_whiteboard', description: WB_UPDATE_DESC, schema: {
      id: z.string().min(1).describe('the whiteboard id (from list_whiteboards or the conversation)'),
      baseRev: z.number().int().min(1).describe('the rev you READ this turn'),
      title: z.string().min(1).max(200).optional(),
      mermaid: z.string().min(1).max(100_000).optional(),
      elements: z.string().min(1).max(200_000).optional(),
    }, run: async (input) => {
      if (input.mermaid && input.elements) return 'provide at most one of `mermaid` or `elements`';
      const r = await wb.update({
        id: String(input.id), baseRev: Number(input.baseRev),
        ...(input.title ? { title: String(input.title) } : {}),
        ...(input.mermaid ? { mermaid: String(input.mermaid) } : {}),
        ...(input.elements ? { elements: String(input.elements) } : {}),
      });
      log?.({ kind: 'tool', phase: 'call', summary: `update_whiteboard ${String(input.id).slice(0, 8)}…${r.ok ? ` → rev ${r.rev}` : ' (refused)'}`, level: r.ok ? 'info' : 'warn' });
      return r.ok ? `whiteboard updated to rev ${r.rev} — the board redraws where it already sits on screen` : `update refused: ${r.error ?? 'error'}`;
    } },
  ];


  // resolve a repo to bind to a task: prefer one already in list_repos by name; otherwise, if the
  // human named a URL/shorthand, register it to the workspace and bind by the returned id.
  const resolveRepoBinding = async (repoName?: string, repoUrl?: string): Promise<{ repo?: { id: string; default_branch: string }; label?: string; error?: string }> => {
    if (repoName) {
      const [r] = await db.getAll<{ id: string; default_branch: string }>(`select id, default_branch from repos where workspace_id = ? and name = ?`, [ch.workspace_id, repoName]);
      if (r) return { repo: r, label: repoName };
      if (!repoUrl) return { error: `no repo named "${repoName}" in this workspace — call list_repos, or pass repoUrl to attach it` };
    }
    if (repoUrl) {
      const res = await post('/v1/commands', actor, { type: 'repo.link', workspace: ch.workspace_id, channel: ch.id, url: repoUrl });
      const body = (await res.json()) as any;
      if (!res.ok) return { error: `could not attach "${repoUrl}": ${body.message ?? body.code ?? res.status}` };
      log?.({ kind: 'tool', phase: 'call', summary: `attached repo ${repoUrl}${body.inserted ? '' : ' (already registered)'}` });
      return { repo: { id: body.repoId as string, default_branch: 'main' }, label: repoUrl };
    }
    return {};
  };

  // The registry, by domain (tools-*.ts). It is ONE list to both transports; the split is for
  // the reader. ToolCtx is what each group needs to answer for THIS turn.
  const tc: ToolCtx = { grounding: newGrounding(), z, db, post, ch, agent, actor, thread, convoThreadId, deepWorkToken, kind, spawnLeg, log, skills,
    draftsHere, here, filed, known, kindField, taskByNumber, resolveRepoBinding, roomMenu, siblings, wbReads, wbWrites,
    agents, apiGet, brain, buildScheduleCard, ensureChatWorkspace, executeHire, generateDraftImage, generateShareImage, libraryDocs,
    startDeepWork, subjectFor, workspaceListing, workspaceRead };
  // Whiteboards ride kind-gated from the shared catalogue — the #272 domain split dropped this
  // spread and the orchestrator spent five days commanded to draw with no drawing tool
  // (promptbudget/orchregistry tests now assert the BUILT registry, so a lost spread fails CI).
  const wbTools = [...wbWrites, ...wbReads].filter((t) => toolAvailable(t.name as NmTool, kind));
  const all = [...contextTools(tc), ...boardTools(tc), ...routeTools(tc), ...roomTools(tc), ...contentTools(tc), ...replyTools(tc), ...playbookTools(tc), ...repoTools(tc), ...wbTools];
  if (kind !== 'sweep') return all;
  const scoped = new Set(SWEEP_TOOLSETS[ctx.sweepScope ?? 'monitor']);
  return all.filter((t) => scoped.has(t.name));
}

  return { buildOrchestratorTools };
}
