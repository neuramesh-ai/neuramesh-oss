// A WAKE SERVED BY ANOTHER MACHINE (`?thinking=<name>`, 2026-09-18): the agent's synced status flips
// to 'thinking' with NO local stream — the desktop never emits one for work it did not run — and a
// bare wake run (no legs, so no card) opens for it in th-flowe-before, served by sam-mbp. Three Flowe
// threads then tell the whole story: th-flowe-before wears the ghost from the synced row alone,
// th-flowe-runs shows rex's run card and no ghost (card › ghost), and every other conversation shows
// nothing — the leak this reproduces lit the orb in all of them. Kept apart from mock-fixtures.ts
// (at its size cap) and spliced in there, so this file must import nothing from it.
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

export function stageThinking(w: { agents: Array<{ id: string; name: string; status: string }>; mockWorkRuns: any[] }, name: string | null): void {
  const a = name ? w.agents.find((x) => x.name === name) : null;
  if (!a) return;
  a.status = 'thinking';
  w.mockWorkRuns.push({
    id: 'run-thinking-wake', channel_id: 'cf-general', thread_id: 'th-flowe-before', task_id: null, agent_id: a.id,
    parent_run_id: null, kind: 'wake', title: 'what are some flowe competitors out there?', state: 'running',
    step: 'thinking…', done: 0, total: 0, summary: null, machine_id: 'm2', machine_name: 'sam-mbp',
    started_at: ago(4_000), ended_at: null, updated_at: ago(1_000),
  });
}
