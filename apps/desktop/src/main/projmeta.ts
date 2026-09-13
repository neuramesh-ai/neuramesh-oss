// Projects-page card aggregates (nm:workspace-meta): every open task rolls into exactly
// one of four pulse buckets — the 4px whisper strip on a project card. Terminal states
// (accepted, closed) are history, not board weight, and stay out of the pulse. The bucket
// basis deliberately matches open_tasks (no parent_task_id filter) so the strip's
// proportions always sum to the number shown beside it.
export const PULSE_BUCKETS = {
  pre: ['backlog', 'todo', 'designing', 'design_review', 'planning', 'plan_review'],
  build: ['in_progress', 'blocked'],
  review: ['in_review'],
  land: ['done', 'shipping', 'ship_review', 'verifying', 'releasing'],
} as const;

export type PulseBucket = keyof typeof PULSE_BUCKETS;

const inList = (states: readonly string[]) => states.map((s) => `'${s}'`).join(', ');

// One correlated subselect per bucket, aliased t_<bucket> — the same rollup shape the
// switcher-era query already uses for open_tasks, so it rides the existing 2.5s poll.
export const pulseSelects = (alias = 'p'): string =>
  (Object.entries(PULSE_BUCKETS) as Array<[PulseBucket, readonly string[]]>)
    .map(([k, states]) => `(select count(*) from tasks tb where tb.project_id = ${alias}.id and tb.state in (${inList(states)})) as t_${k}`)
    .join(',\n         ');
