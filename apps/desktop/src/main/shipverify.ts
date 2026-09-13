// Post-merge release verification (docs/23 v2) — DETECTION is code (the
// shipscan/stall.ts idiom: pure, no electron imports, unit-testable). The
// verifying watch feeds it the merge commit's raw GitHub signals — check runs,
// commit statuses (Vercel deployments report here), and workflow runs the push
// triggered (release pipelines) — and it answers one question: did the release
// actually land? A verdict is judgment-free aggregation; what to DO about a red
// one stays with the human (accept-override or a fix-forward bounce).

export interface ReleaseSignal {
  /** 'check' = commit check-run · 'status' = commit status context · 'run' = workflow run */
  source: 'check' | 'status' | 'run';
  name: string;
  state: 'pending' | 'success' | 'failure';
}

export interface ReleaseVerdict {
  /** none = the merge triggered no CI/status/workflow at all (no-CI repos proceed) */
  verdict: 'green' | 'red' | 'pending' | 'none';
  /** one factual, human-legible line for the thread/event note */
  detail: string;
}

// ── GitHub JSON → signals (tolerant: absent/garbled fields never throw) ──────

/** `gh api repos/{slug}/commits/{sha}/check-runs` → check_runs[] */
export function checkRunSignals(json: unknown): ReleaseSignal[] {
  const runs = (json as { check_runs?: unknown[] } | null)?.check_runs;
  if (!Array.isArray(runs)) return [];
  return runs.map((r) => {
    const c = r as { name?: string; status?: string; conclusion?: string | null };
    const settled = c.status === 'completed';
    const ok = c.conclusion === 'success' || c.conclusion === 'neutral' || c.conclusion === 'skipped';
    return {
      source: 'check' as const,
      name: String(c.name ?? 'check'),
      state: !settled ? ('pending' as const) : ok ? ('success' as const) : ('failure' as const),
    };
  });
}

/** `gh api repos/{slug}/commits/{sha}/status` → statuses[] (deploy providers live here) */
export function commitStatusSignals(json: unknown): ReleaseSignal[] {
  const statuses = (json as { statuses?: unknown[] } | null)?.statuses;
  if (!Array.isArray(statuses)) return [];
  // GitHub keeps every posted status; only the LATEST per context counts
  const latest = new Map<string, { name: string; state: string }>();
  for (const s of statuses) {
    const c = s as { context?: string; state?: string };
    const name = String(c.context ?? 'status');
    if (!latest.has(name)) latest.set(name, { name, state: String(c.state ?? 'pending') });
  }
  return [...latest.values()].map((s) => ({
    source: 'status' as const,
    name: s.name,
    state: s.state === 'success' ? ('success' as const) : s.state === 'pending' ? ('pending' as const) : ('failure' as const),
  }));
}

/** `gh run list --commit <sha> --json name,status,conclusion` (release workflows) */
export function workflowRunSignals(json: unknown): ReleaseSignal[] {
  if (!Array.isArray(json)) return [];
  return (json as unknown[]).map((r) => {
    const c = r as { name?: string; status?: string; conclusion?: string | null };
    const settled = c.status === 'completed';
    const ok = c.conclusion === 'success' || c.conclusion === 'neutral' || c.conclusion === 'skipped';
    return {
      source: 'run' as const,
      name: String(c.name ?? 'workflow'),
      state: !settled ? ('pending' as const) : ok ? ('success' as const) : ('failure' as const),
    };
  });
}

// ── The verdict ───────────────────────────────────────────────────────────────

// Workflow runs double-report as check runs on the same commit; dedupe by name
// so "12 signals green" counts pipelines, not their echoes. Any failure is red
// (a release with one dead pipeline did not land); otherwise any pending keeps
// the verdict pending; a signal-less merge is 'none' — no CI is configured on
// this repo and review already gated the code, so the caller may proceed.
export function classifyRelease(signals: ReleaseSignal[]): ReleaseVerdict {
  const byName = new Map<string, ReleaseSignal>();
  for (const s of signals) {
    const prev = byName.get(s.name);
    // a failure outranks whatever else reported under this name; pending outranks success
    if (!prev || rank(s.state) > rank(prev.state)) byName.set(s.name, s);
  }
  const uniq = [...byName.values()];
  if (!uniq.length) return { verdict: 'none', detail: 'no post-merge checks, statuses, or workflows reported' };
  const failed = uniq.filter((s) => s.state === 'failure');
  if (failed.length) {
    return { verdict: 'red', detail: `${failed.map((s) => s.name).slice(0, 3).join(', ')}${failed.length > 3 ? ` (+${failed.length - 3} more)` : ''} failed` };
  }
  const pending = uniq.filter((s) => s.state === 'pending');
  if (pending.length) {
    return { verdict: 'pending', detail: `${pending.length} of ${uniq.length} still running (${pending[0]!.name}${pending.length > 1 ? ', …' : ''})` };
  }
  return { verdict: 'green', detail: `${uniq.length} post-merge signal${uniq.length === 1 ? '' : 's'} green (${summarize(uniq)})` };
}

function rank(state: ReleaseSignal['state']): number {
  return state === 'failure' ? 2 : state === 'pending' ? 1 : 0;
}

function summarize(signals: ReleaseSignal[]): string {
  const names = signals.map((s) => s.name);
  return names.slice(0, 3).join(', ') + (names.length > 3 ? `, +${names.length - 3} more` : '');
}
