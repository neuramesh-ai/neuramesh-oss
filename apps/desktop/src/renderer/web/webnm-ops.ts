// THE OPERATIONS LANES — the workspace's settings, its brains, its crew, and the six watches
// nobody else owns.
//
// webnm-rooms wired the room list, webnm-convo the conversation, webnm-board the work. What was
// still missing is everything AROUND the work: the permission policies Settings edits, the custom
// brains every model picker reads, the roster the whole shell derives crew from, the runs strip,
// the phase spectrum's routing evidence, the reply tallies, the session history, the archived
// chats, the capacity-failover fly-up, the compute panel's two counts, the memory surface and the
// retro view.
//
// Left unwired every one of them answered with the warn-once proxy's empty — which is an OBJECT,
// and therefore TRUTHY. That is not a harmless blank here: an empty roster is a workspace with no
// agents (so nothing renders a crew, a mention or an avatar), an empty `modelPacks()` silently
// deletes every custom brain from the pickers, and `watchFailover` handing a truthy empty to
// `cb(row)` would raise a sticky capacity fly-up over a workspace that has no capacity problem.
//
// Ports, not new behaviour: the SAME SQL the desktop's IPC handlers run — sync/ipc/settings.ts,
// watch-board.ts, watch-rooms.ts, watch-crew.ts, membership.ts, task.ts and sync.ts's shared
// loadRoster — against the same replica this client already syncs, and the SAME control-api
// routes where the answer is server truth. Where the desktop reads `WS` from module state, the
// web reads it from cfg; that is the whole difference. Every query is copied verbatim, and
// webnm-ops.test.ts proves it character-for-character against the handler it came from.
//
// FIVE LANES ARE MACHINE-LOCAL AND ARE REFUSED, NOT FAKED — see machineLanes() at the foot.
import type { PowerSyncDatabase } from '@powersync/web';
import type { RetroPayload } from '@neuramesh/shared';
import type { NMBridge } from '../src/bridge/nm';
import type { RunUI } from '../src/bridge/rows-board';
import type { AgentRow, MachineRow } from '../src/bridge/rows-crew';
import type { HistoryThreadRow } from '../src/bridge/rows-rooms';
import type { ArchivedThreadRow, FailoverRow, PolicyRowUI } from '../src/bridge/rows-infra';
import { authHeaders, postCommand, type WebNmConfig } from './webnm';

/** a live query: run it, then re-run whenever one of `tables` changes. mirrors db.watch's
 *  contract for the renderer, minus the IPC hop the desktop needs. Duplicated from
 *  webnm-board.ts rather than shared, the same way `orEmpty` already is: a lane file stands
 *  alone, and these are being written in parallel. */
function watch<T>(db: PowerSyncDatabase, tables: string[], run: () => Promise<T[]>, cb: (rows: T[]) => void): () => void {
  let live = true;
  const push = () => {
    if (!live) return;
    // a failed read leaves the last good rows standing rather than blanking the surface
    void run().then((rows) => { if (live) cb(rows); }).catch((e: unknown) => { console.error('[webnm] watch read failed:', e); });
  };
  push();
  const stop = db.onChangeWithCallback({ onChange: () => push() }, { tables });
  return () => { live = false; stop(); };
}

/** A failed read must not look like an empty workspace. So it SAYS SO and then yields empty,
 *  rather than yielding empty quietly — "no agents yet" on a staffed workspace is the same bug
 *  class as the "no channels yet" one these lanes were written to end. */
const orEmpty = <T>(what: string) => (e: unknown): T[] => {
  console.error(`[webnm] ${what} failed:`, e);
  return [];
};

/** one command, typed to what the contract promises back. It THROWS on refusal (postCommand
 *  does), which is the point: a policy the server refused must not read as saved. */
const cmd = <T>(cfg: WebNmConfig, c: Record<string, unknown>): Promise<T> => postCommand(cfg, c) as Promise<T>;

/** a /v1 GET. Throws with the server's own sentence where it sends one, matching the desktop's
 *  `api()` — every caller of these three reads renders its absent state from the rejection. */
async function apiGet<T>(cfg: WebNmConfig, path: string): Promise<T> {
  const res = await fetch(`${cfg.apiUrl}${path}`, { headers: await authHeaders(cfg) });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(String(body['error'] ?? `${path} failed ${res.status}`));
  return body as T;
}

// ── the queries, copied from their handlers ───────────────────────────────────────────────────

// sync/ipc/settings.ts nm:policies — the persisted permission overrides (the renderer merges
// them with the shared baseline). Writes go through the command handler, never a local row.
const POLICIES_SQL = `select id, scope, capability, selector, verdict, rationale, locked, project_id from policies where workspace_id = ?`;

// sync.ts loadRoster — the machines half. `owner_user_id` + `runtimes` answer whose machine a
// host is and what it can serve; `kind` (0126) tells the workspace's cloud runner from a laptop.
const ROSTER_MACHINES_SQL = `select id, name, platform, daemon_version, last_seen_at, owner_user_id, runtimes, kind from machines where workspace_id = ? order by name`;

// sync.ts loadRoster — the agents half, with the room membership every "+ add to channel"
// control reads and `hosted_on`, the machine holding this agent's open run right now.
const ROSTER_AGENTS_SQL = `select a.id, a.name, a.role, a.model, a.runtime, a.model_source, a.emoji, a.card, a.kind, a.status, a.machine_id, a.retired_at, a.description, a.brief,
        (select group_concat(c.slug, ', ') from agent_channels ac join channels c on c.id = ac.channel_id where ac.agent_id = a.id) as channels,
        (select group_concat(ac.channel_id, ',') from agent_channels ac where ac.agent_id = a.id) as channel_ids,
        (select m.name from runs r join machines m on m.id = r.machine_id
          where r.agent_id = a.id and r.state = 'running' order by r.started_at desc limit 1) as hosted_on
       from agents a where a.workspace_id = ? order by a.name`;

// sync/ipc/watch-board.ts nm:watch-runs — every run that touched this room, newest first.
const RUNS_SQL = `select r.id, r.channel_id, r.thread_id, r.task_id, r.agent_id, r.parent_run_id, r.kind, r.title, r.state, r.step, r.seat,
              r.done, r.total, r.summary, r.started_at, r.ended_at, r.updated_at, r.machine_id, m.name as machine_name
       from runs r left join machines m on m.id = r.machine_id
       where r.channel_id = ? order by r.started_at desc limit 80`;

// sync/ipc/watch-board.ts nm:watch-journey — which tasks carry a design round / an
// implementation plan, the routing evidence the phase spectrum derives its legs from.
const JOURNEY_SQL = `select task_id,
              max(case when kind = 'design' then 1 else 0 end) as has_design,
              max(case when kind = 'doc' and name like 'implementation-plan%' then 1 else 0 end) as has_plan
       from artifacts where workspace_id = ? and task_id is not null group by task_id`;

// sync/ipc/watch-rooms.ts nm:watch-reply-counts — per-root reply tallies for the replies footer.
const REPLY_COUNTS_SQL = `select t.root_message_id as message_id, t.id as thread_id, count(m.id) as n,
              max(m.created_at) as last_at
         from threads t join messages m on m.thread_id = t.id and m.id <> t.root_message_id
        where t.channel_id = ? and t.root_message_id is not null and t.archived_at is null
        group by t.root_message_id, t.id`;

// sync/ipc/watch-rooms.ts nm:watch-history-all — EVERY live thread in the workspace, task
// threads included: the one row-set behind the session list, the Recents rail and ⌘Y.
const HISTORY_ALL_SQL = `select t.id, t.channel_id, c.slug as channel_slug, t.title, t.task_id, t.updated_at, t.schedule_id, t.settled_at,
              (select m.body from messages m where m.thread_id = t.id order by m.created_at desc limit 1) as last_body,
              -- the status inputs (shared/threadstatus.ts): who spoke last, and when
              (select m.author_kind from messages m where m.thread_id = t.id order by m.created_at desc limit 1) as last_author_kind,
              (select max(m.created_at) from messages m where m.thread_id = t.id) as last_at
         from threads t join channels c on c.id = t.channel_id
        where t.workspace_id = ? and t.archived_at is null
        order by t.updated_at desc limit 400`;

// sync/ipc/watch-rooms.ts nm:watch-archived-threads — Settings › Archived chats, the only
// place archived conversations exist. Everything else in the app filters them out.
const ARCHIVED_THREADS_SQL = `select t.id, t.channel_id, c.slug as channel_slug, t.title, t.archived_at, t.updated_at,
              (select m.body from messages m where m.thread_id = t.id order by m.created_at desc limit 1) as last_body
         from threads t join channels c on c.id = t.channel_id
        where t.workspace_id = ? and t.archived_at is not null
        order by t.archived_at desc limit 200`;

// sync/ipc/watch-crew.ts nm:watch-failover — the single OPEN capacity failover across the
// workspace (docs/22). The decision row carries the status; the message body carries the payload.
const FAILOVER_SQL = `select d.id as decision_id, d.channel_id, c.slug as channel_slug, m.body
         from decisions d
         join messages m on m.id = d.message_id
         join channels c on c.id = d.channel_id
        where d.workspace_id = ? and d.status = 'open' and m.body like '%"failover"%'
        order by d.created_at desc limit 1`;

// sync/ipc/membership.ts nm:live-runs — what is mid-flight right now, for the switch sheet's
// warning. Zero live runs must produce no warning at all, not a zeroed one.
const LIVE_RUNS_SQL = `select r.title, a.name as agent_name, t.number
         from runs r left join agents a on a.id = r.agent_id left join tasks t on t.id = r.task_id
        where r.workspace_id = ? and r.state = 'running' order by r.started_at asc limit 8`;

// sync/ipc/task.ts nm:compute-shared-threads — how many of a member's conversations have run on
// a machine I own. Three params: the workspace, the member, and ME.
const SHARED_THREADS_SQL = `select count(distinct t.id) as n from threads t
        where t.workspace_id = ? and t.created_by = ? and t.archived_at is null
          and exists (select 1 from runs r
                       join machines m on m.id = r.machine_id
                      where r.thread_id = t.id and m.workspace_id = t.workspace_id and m.owner_user_id = ?)`;

type JourneyRow = { task_id: string; has_design: number; has_plan: number };
type ReplyCountRow = { message_id: string; thread_id: string; n: number; last_at: string };
type LiveRunRow = { title: string; agent_name: string | null; number: number | null };

/** THE REPLICA HALF. Every workspace-wide read carries `workspace_id = ?` — the replica holds
 *  every workspace this identity belongs to, so a query missing it silently returns another
 *  workspace's rows, which is worse than returning none. */
function replicaLanes(cfg: WebNmConfig, db: PowerSyncDatabase): Partial<NMBridge> {
  const ws = () => cfg.workspaceId();
  return {
    policies: async () => db.getAll<PolicyRowUI>(POLICIES_SQL, [ws()]).catch(orEmpty('policies')),

    // the two halves are read independently so a broken one does not take the other down; the
    // desktop's shared loadRoster also carries `members`, which belongs to watchRoster's payload
    // and not to this contract, so it is deliberately not read here.
    roster: async () => ({
      machines: await db.getAll<MachineRow>(ROSTER_MACHINES_SQL, [ws()]).catch(orEmpty('roster.machines')),
      agents: await db.getAll<AgentRow>(ROSTER_AGENTS_SQL, [ws()]).catch(orEmpty('roster.agents')),
    }),

    liveRuns: async () => ({ runs: await db.getAll<LiveRunRow>(LIVE_RUNS_SQL, [ws()]).catch(orEmpty('liveRuns')) }),

    computeSharedThreads: async (member) => {
      const rows = await db.getAll<{ n: number }>(SHARED_THREADS_SQL, [ws(), member, cfg.actorId()]).catch(orEmpty<{ n: number }>('computeSharedThreads'));
      return { count: Number(rows[0]?.n ?? 0) };
    },

    // `machines` is watched as well as `runs`: the row carries the machine's NAME, so a machine
    // renamed (or first seen) mid-run changes this result without any run row changing.
    watchRuns: (channelId, cb) =>
      watch<RunUI>(db, ['runs', 'machines'], () => db.getAll<RunUI>(RUNS_SQL, [channelId]), cb),

    watchJourney: (cb) =>
      watch<JourneyRow>(db, ['artifacts'], () => db.getAll<JourneyRow>(JOURNEY_SQL, [ws()]), cb),

    watchReplyCounts: (channelId, cb) =>
      watch<ReplyCountRow>(db, ['threads', 'messages'], () => db.getAll<ReplyCountRow>(REPLY_COUNTS_SQL, [channelId]), cb),

    // `channels` is in both thread sets because the slug is joined in — a room renamed changes
    // every one of these rows without a threads row moving.
    watchHistoryAll: (cb) =>
      watch<HistoryThreadRow>(db, ['threads', 'channels', 'messages'], () => db.getAll<HistoryThreadRow>(HISTORY_ALL_SQL, [ws()]), cb),

    watchArchivedThreads: (cb) =>
      watch<ArchivedThreadRow>(db, ['threads', 'channels', 'messages'], () => db.getAll<ArchivedThreadRow>(ARCHIVED_THREADS_SQL, [ws()]), cb),

    // THE ONE ROW-OR-NULL WATCH. Its callback takes a single row, so the list has to be collapsed
    // here — handing it the empty ARRAY the other watches publish would be truthy, and the client
    // renders a sticky capacity fly-up over any truthy row. `?? null` is the whole guard.
    watchFailover: (cb) =>
      watch<FailoverRow>(db, ['decisions', 'messages', 'channels'], () => db.getAll<FailoverRow>(FAILOVER_SQL, [ws()]), (rows) => cb(rows[0] ?? null)),
  };
}

/** THE SERVER-TRUTH HALF. model packs, memory and retro are deliberately OUTSIDE the sync
 *  publication (workspace config, and aggregates over the unsynced events/facts tables), so
 *  there is no local row to watch — on any client. The three writes are commands, which throw
 *  on refusal rather than reporting a save that never happened. */
function httpLanes(cfg: WebNmConfig): Partial<NMBridge> {
  const ws = () => cfg.workspaceId();
  return {
    policySet: (input) => cmd(cfg, { type: 'policy.set', workspace: ws(), ...input }),
    policyDelete: (id) => cmd(cfg, { type: 'policy.delete', workspace: ws(), policyId: id }),
    modelPacks: () => apiGet(cfg, `/v1/model-packs?workspace=${ws()}`),
    modelPackSave: (input) => cmd(cfg, { type: 'modelpack.save', workspace: ws(), ...input }),
    modelPackDelete: (packId) => cmd(cfg, { type: 'modelpack.delete', workspace: ws(), packId }),
    memory: (channelSlug) => apiGet(cfg, `/v1/memory?workspace=${ws()}&channel=${encodeURIComponent(channelSlug)}`),
    retro: (range) => apiGet<RetroPayload>(cfg, `/v1/retro?workspace=${ws()}&range=${encodeURIComponent(range)}`),
  };
}

/** what a browser genuinely cannot reach — answered honestly, the webnm-local.ts way. */
const NO_MACHINE = 'agent instructions are a machine-local file — a browser has no machine to write one on';

function machineLanes(): Partial<NMBridge> {
  return {
    // INSTRUCTIONS ARE MACHINE-LOCAL (0110 §B.1): `local` is <userData>/agent-instructions/
    // <name>.yaml on the host, `shipped`/`prompt` are defaults/agents/*.yaml read off that host's
    // disk. A browser has neither, and no route serves them. Both nulls are the honest answer and
    // the surface already handles them — the overlay then shows the SYNCED `agents.brief`, which
    // is exactly the baseline a machine that has never been configured inherits. The cost is
    // named: `path` is only a tooltip on the "this machine" chip, and '' blanks it.
    agentInstructions: async () => ({ local: null, shipped: null, path: '', prompt: null }),

    // A REFUSAL THAT SURFACES, not `{ ok: false }`. The overlay ignores `ok` and renders whatever
    // this rejects with (cleanCmdErr), so a false here would look exactly like a save — and the
    // next read, which returns nulls, would look like the file silently reverting.
    agentInstructionsWrite: async () => { throw new Error(NO_MACHINE); },

    // the local activity log: a per-machine sqlite store the daemon writes, never synced. Empty
    // is what the desktop itself answers on a machine that has run nothing — webnm-local.ts
    // already answers its sibling `agentLogs` the same way.
    agentRuns: async () => [],

    // A LIVE TOKEN STREAM, NOT A TABLE QUERY — and this is the one lane here a browser cannot
    // have at all. The desktop's emitStream broadcasts over WebContents from the agent process
    // running on that host; there is no row, no route and no relay yet. So: a real unsubscribe
    // and a callback that never fires, which degrades exactly as the desktop does between turns —
    // no live bubble, and the ghost falls back to the SYNCED `runs` rows (watchRuns above), which
    // is how the browser still shows that an agent is working.
    watchAgentStream: () => () => {},

    // the orchestrator's live read of the room, run through THIS machine's provider credentials.
    // null is a first-class answer in this contract — the launcher falls back to its generic
    // sample pills, so the button still yields pills.
    launcherIdeas: async () => null,
  };
}

/**
 * `Partial<NMBridge>`, NOT `Record<string, unknown>`. The overrides are handed to a proxy, so an
 * untyped bag typechecks whatever it contains — and a wrong SHAPE then fails only in use. The
 * precedent is `send`, which is positional (channelId, body, opts) and was first written taking
 * one options object: it would have posted `undefined` as every message body and compiled
 * cleanly. Typing the bag against the contract makes the compiler check every lane here, so a
 * cb-second watch written cb-first cannot reach a browser. The three halves are typed the same
 * way for the same reason — the split is for readability, never to loosen the check.
 */
export function opsOverrides(cfg: WebNmConfig, db: PowerSyncDatabase): Partial<NMBridge> {
  return { ...replicaLanes(cfg, db), ...httpLanes(cfg), ...machineLanes() };
}
