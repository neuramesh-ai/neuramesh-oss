// THE SECOND CONNECTION (U3b, artboards B1 to B4). `?conns=2` gives the harness two connections:
// the local stack this Mac stands in (Acme Robotics, the standard fixtures) and the hosted cloud
// (Flowe, the rows below). The rail's union (`watchRailRows`) carries whichever one is NOT in the
// foreground, tagged, exactly as main's rail-rows.ts does; `setForeground` flips the pointer and
// the preview's shell remounts on it, so the swap is measurable here. `?conns=1` is the local
// connection alone — today's rail, the B0 baseline.
import { MOCK_WS_ID, agents, allTasks, channels, historyAllSnapshot, mockDecisions, mockWorkRuns, mockWorkspaces, projects, qp, seedIso } from './mock-fixtures';

export const CONNS = qp('conns');
export const TWO_CONNS = CONNS === '2';
// ?bandfold=cloud,local folds the rail's connection bands; absent = both open (seeded here, beside the
// connections it folds, because preview/main.tsx sits at the size bar)
const bandfold = qp('bandfold');
if (bandfold) localStorage.setItem('nm:navBandFold', JSON.stringify(bandfold.split(',').filter(Boolean)));
else localStorage.removeItem('nm:navBandFold');

const FLOWE_WS = { id: 'ws-flowe', name: 'Flowe', slug: 'flowe', role: 'owner', memberCount: 3, plan: 'cloud' };

let foreground: 'local' | 'cloud' = 'local';
export const mockForeground = () => foreground;
export const mockForegroundWorkspace = () => (foreground === 'cloud' ? FLOWE_WS : null);
export function mockSetForeground(id: string): void {
  if (id !== 'local' && id !== 'cloud') throw new Error(`no connection ${id}`);
  foreground = id;
}

const LOCAL = () => ({
  id: 'local', kind: 'local' as const, authMode: 'local' as const, host: '127.0.0.1:8788',
  workspaceId: MOCK_WS_ID, workspace: { name: 'Acme Robotics', slug: 'acme' }, workspaces: mockWorkspaces(), account: null, live: true,
});
const CLOUD = () => ({
  id: 'cloud', kind: 'cloud' as const, authMode: 'clerk' as const, host: 'api.neuramesh.app',
  workspaceId: FLOWE_WS.id, workspace: { name: FLOWE_WS.name, slug: FLOWE_WS.slug }, workspaces: [FLOWE_WS], account: { email: 'george@acme.dev' }, live: true,
});
export const mockConnections = () => (TWO_CONNS ? [LOCAL(), CLOUD()] : [LOCAL()]);

// ── the cloud's rows: a marketing HQ with one live task, one setup ask, and settled work ──
const task = (over: Record<string, unknown>) => ({
  kind: 'feature', assignee_kind: null, assignee_id: null, offered_agent_id: null, requirements: null, requirements_confirmed: 1, definition_of_done: '',
  project_id: 'pw-flowe', channel_id: 'cw-marketing', channel_slug: 'marketing', branch: null, repo_id: null, submitted_sha: null, pr_url: '', pr_number: null,
  artifact_count: 0, parent_task_id: null, origin_thread_id: null, work_plan: null, plan_approved_at: null, last_human_msg_at: null, settled_at: null,
  created_at: seedIso(7_200_000), ...over,
});
const cloudTasks = [
  task({ id: 'tkw-201', number: 201, title: 'X content schedule', state: 'in_progress', assignee_kind: 'agent', assignee_id: 'aw-plume', updated_at: seedIso(60_000), thread_id: 'thw-201' }),
  task({ id: 'tkw-214', number: 214, title: 'Set up your marketing HQ', kind: 'setup', state: 'todo', updated_at: seedIso(900_000), thread_id: 'thw-214' }),
  task({ id: 'tkw-198', number: 198, title: 'Reply radar, @joinflowe on X', kind: 'research', state: 'accepted', assignee_kind: 'agent', assignee_id: 'aw-plume', updated_at: seedIso(7_200_000), thread_id: 'thw-198', settled_at: seedIso(7_000_000) }),
];
const thread = (over: Record<string, unknown>) => ({ channel_id: 'cw-marketing', channel_slug: 'marketing', task_id: null, schedule_id: null, last_author_kind: 'agent', settled_at: null, ...over });
const cloudThreads = [
  thread({ id: 'thw-201', title: 'X content schedule', task_id: 'tkw-201', updated_at: seedIso(60_000), last_body: 'plume · Drafting the week-two cadence now.', last_at: seedIso(60_000) }),
  thread({ id: 'thw-214', title: 'Set up your marketing HQ', task_id: 'tkw-214', updated_at: seedIso(900_000), last_body: 'Step 2 of 5 · connect X.', last_at: seedIso(900_000) }),
  thread({ id: 'thw-scan', title: 'Flowe competitor social media scan', updated_at: seedIso(5_400_000), last_body: 'Three accounts post daily; none reply to customers.', last_at: seedIso(5_400_000), settled_at: seedIso(5_000_000) }),
  thread({ id: 'thw-198', title: 'Reply radar, @joinflowe on X', task_id: 'tkw-198', updated_at: seedIso(7_200_000), last_body: 'Report attached. 14 reply opportunities.', last_at: seedIso(7_200_000), settled_at: seedIso(7_000_000) }),
  thread({ id: 'thw-hello', channel_id: 'cw-general', channel_slug: 'general', title: 'Welcome to Flowe', updated_at: seedIso(86_400_000), last_body: 'Say hello to the crew.', last_author_kind: 'human', last_at: seedIso(86_400_000), settled_at: seedIso(80_000_000) }),
];
const cloudRuns = [
  { id: 'runw-201', channel_id: 'cw-marketing', thread_id: null, task_id: 'tkw-201', agent_id: 'aw-plume', parent_run_id: null, kind: 'work', title: '#201 X content schedule', state: 'running', step: 'drafting week two', seat: null, done: 1, total: 3, summary: null, started_at: seedIso(300_000), ended_at: null, updated_at: seedIso(60_000), machine_id: null, machine_name: null },
];
const cloudChannels = [
  { id: 'cw-marketing', slug: 'marketing', project_id: 'pw-flowe', msg_count: 164 },
  { id: 'cw-general', slug: 'general', project_id: 'pw-flowe', msg_count: 20 },
];
const cloudProjects = [{ id: 'pw-flowe', name: 'Flowe AI', slug: 'flowe-ai', status: 'active', logo_url: null }];
const cloudAgents = [{ id: 'aw-plume', role: 'marketer', retired_at: null, channel_ids: 'cw-marketing,cw-general' }];

const slices = (id: 'local' | 'cloud') => id === 'cloud'
  ? { threads: cloudThreads, tasks: cloudTasks, runs: cloudRuns, decisions: [] as unknown[], channels: cloudChannels, projects: cloudProjects, agents: cloudAgents }
  : {
    threads: historyAllSnapshot(), tasks: allTasks, runs: mockWorkRuns.filter((r: { state: string }) => r.state === 'running'), decisions: mockDecisions,
    channels: channels.map((c) => ({ id: c.id, slug: c.slug, project_id: c.project_id, msg_count: c.msg_count ?? 0 })),
    projects: projects.map((p) => ({ id: p.id, name: p.name, slug: p.slug, status: p.status, logo_url: (p as { logo_url?: string }).logo_url ?? null })),
    agents: agents.map((a) => ({ id: a.id, role: a.role, retired_at: (a as { retired_at?: string }).retired_at ?? null, channel_ids: a.channel_ids ?? null })),
  };

/** the shells listening for a foreground swap — the preview's Shell remounts App on it, as the real one does */
const foregroundWatchers = new Set<(c: { id: string; kind: string; authMode: string; workspaceId: string }) => void>();

// the lanes behind mock-nm's five connection entries (U3b) — the entries themselves stay literal in
// mock-nm.ts, one line each, because mock-drift.test.ts reads that file's keys as the mocked surface
type ForegroundCb = (c: { id: string; kind: string; authMode: string; workspaceId: string }) => void;
export function watchForeground(cb: ForegroundCb): () => void { foregroundWatchers.add(cb); return () => { foregroundWatchers.delete(cb); }; }
/** the dev lane (no ?conns=, no ?conn=local) is one custom connection, as main plans it */
export const connectionList = (localConn: boolean) => (localConn ? mockConnections() : [{ id: 'dev', kind: 'custom', authMode: 'dev', host: '127.0.0.1:8788', workspaceId: MOCK_WS_ID, workspace: { name: 'Acme Robotics', slug: 'acme' }, workspaces: mockWorkspaces(), account: null, live: true }]);
export async function swapForeground(connectionId: string, workspaceId?: string | null): Promise<{ ok: true; switching: true }> {
  mockSetForeground(connectionId);
  const c = mockConnections().find((x) => x.id === connectionId)!;
  console.log(`[preview] foreground_swap to=${connectionId} ws=${workspaceId ?? c.workspaceId}`);
  for (const cb of foregroundWatchers) cb({ id: c.id, kind: c.kind, authMode: c.authMode, workspaceId: workspaceId ?? c.workspaceId });
  return { ok: true, switching: true };
}

/** the FOREGROUND's own threads and tasks — what the four workspace-wide watches serve. After a swap onto the
 *  cloud they are the cloud's, exactly as the real replica watches re-subscribe against the new connection. */
export const foregroundThreads = (): unknown[] => (foreground === 'cloud' ? cloudThreads : historyAllSnapshot());
export const foregroundTasks = (): unknown[] => (foreground === 'cloud' ? cloudTasks : allTasks);

/** the union as main emits it: every connection the shell does NOT stand in, every slice tagged */
export function railRowsSnapshot(): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = { threads: [], tasks: [], runs: [], decisions: [], channels: [], projects: [], agents: [] };
  for (const c of mockConnections()) {
    if (c.id === foreground) continue;
    const s = slices(c.id as 'local' | 'cloud');
    for (const q of Object.keys(out)) for (const r of s[q as keyof typeof s] as unknown[]) out[q]!.push({ ...(r as object), connectionId: c.id, connectionKind: c.kind });
  }
  return out;
}
