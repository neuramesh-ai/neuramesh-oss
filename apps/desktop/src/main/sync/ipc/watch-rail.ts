// The rail's union watch — the IPC end of rail-rows.ts (U3b, the source-release round).
//
// `nm:watch-rail-rows` streams, for every live connection the shell does NOT stand in, the seven
// row-sets a rail row and its band derive from, each row tagged with its connection. The
// foreground's rows keep arriving through the four watches they always did (a dozen surfaces read
// them), so nothing here runs twice for the connection on screen. It re-scans when the registry
// changes: a connection added by the upgrade, one removed, or one whose replica just opened.
import { ipcMain, type WebContents } from 'electron';
import { connections } from '../../connections';
import type { WatchDeps } from './watchdeps';
import { RAIL_QUERIES, railRowsUnion, type RailQuery, type RailSource } from './rail-rows';
import { HISTORY_ALL_SQL } from './watch-rooms';
import { DECISIONS_ALL_SQL, OPEN_RUNS_SQL, TASKS_ALL_SQL } from './watch-board';

/** a band's folders need the connection's rooms and projects — the rail-shaped slices of
 *  `nm:channels` and `nm:workspace-meta`, read live rather than one-shot */
const RAIL_CHANNELS_SQL = `select c.id, c.slug, c.project_id, (select count(*) from messages m where m.channel_id = c.id) as msg_count
  from channels c where c.workspace_id = ? order by msg_count desc, c.slug`;
const RAIL_PROJECTS_SQL = `select p.id, p.name, p.slug, p.status, p.logo_url from projects p where p.workspace_id = ? order by p.is_default desc, p.name`;
/** the staffing predicate behind an unroutable todo's ask reads the roster's agents (shared/staffing.ts) */
const RAIL_AGENTS_SQL = `select a.id, a.role, a.retired_at,
  (select group_concat(ac.channel_id, ',') from agent_channels ac where ac.agent_id = a.id) as channel_ids
  from agents a where a.workspace_id = ?`;

const RAIL_SQL: Record<RailQuery, string> = {
  threads: HISTORY_ALL_SQL,
  tasks: TASKS_ALL_SQL,
  runs: OPEN_RUNS_SQL,
  decisions: DECISIONS_ALL_SQL,
  channels: RAIL_CHANNELS_SQL,
  projects: RAIL_PROJECTS_SQL,
  agents: RAIL_AGENTS_SQL,
};

/** the connections the union streams: live (replica open) and not the one the shell stands in */
export function backgroundSources(watchFailed: (err: unknown) => void): RailSource[] {
  const fg = connections.peek()?.id;
  return connections.all()
    .filter((c) => c.db && c.id !== fg && c.ws)
    .map((c) => ({
      id: c.id,
      kind: c.kind,
      watch: (q, onRows, signal) => {
        c.db!.watch(RAIL_SQL[q], [c.ws], { onResult: (r) => onRows((r.rows?._array ?? []) as Array<Record<string, unknown>>), onError: watchFailed }, { signal });
      },
    }));
}

export function registerRailWatch(d: Pick<WatchDeps, 'watchers' | 'watchFailed'>): void {
  const { watchers, watchFailed } = d;
  ipcMain.handle('nm:watch-rail-rows', (event, { subId }: { subId: string }) => {
    const sender: WebContents = event.sender;
    const union = railRowsUnion({
      sources: () => backgroundSources(watchFailed),
      emit: (p) => { if (!sender.isDestroyed()) sender.send('nm:rail-rows', { subId, ...p }); },
    });
    const off = connections.onChanged(() => union.refresh());
    const ac = new AbortController();
    ac.signal.addEventListener('abort', () => { off(); union.abort(); });
    watchers.set(subId, ac);
    union.refresh();
    console.log(`ipc_probe=watch-rail-rows queries=${RAIL_QUERIES.length} background=${backgroundSources(watchFailed).map((s) => s.id).join(',') || 'none'}`);
  });
}
