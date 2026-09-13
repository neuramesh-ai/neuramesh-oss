// Beats (docs/17): the worker's plan, surfaced as the ordered, ticking-off progress
// set the human watches. Pure (the execpolicy/replypolicy idiom) so every mapping is
// unit-testable without the host or the SDK.
//
// The invariant this encodes: ONE clean beat set per developer run, whichever of the
// worker's TWO write paths declares it first:
//  · the explicit nm MCP tools (declare_beats / advance_beat) — the runtime-OWNED
//    path the prompt instructs, immune to harness tool-policy drift (the #1010
//    lesson: TodoWrite silently vanished from the SDK's default toolset — the SDK's
//    `allowedTools` is a permission list, availability is the `tools` option);
//  · the native TodoWrite list, mapped automatically when the model uses it.
// createBeatRun coordinates both with first-declare-wins; everything stateful lives
// in closures here, and writes serialize on one chain so rapid updates can't race.

export type BeatOp = { op: 'declare'; items: string[] } | { op: 'advance'; seq: number; status: string };

// Claude Code todo status → beat_status. in_progress is the *active* (pulsing) beat.
const TODO_TO_BEAT: Record<string, string> = { pending: 'pending', in_progress: 'active', completed: 'done' };
const MAX_BEATS = 12; // the command surface caps a set at 12 — keep the reducer in lockstep

export function todoBeatReducer(): (todos: Array<{ content?: string; status?: string }>) => BeatOp[] {
  let titles: string[] | null = null; // the declared set (null until the first non-empty list)
  let last: string[] = []; // last-emitted beat status per seq, so we only advance on a real change
  return (todos) => {
    const ops: BeatOp[] = [];
    const items = todos.map((td) => (td.content ?? '').trim()).filter(Boolean).slice(0, MAX_BEATS);
    if (!items.length) return ops; // an empty list never declares — wait for a real plan
    if (!titles) {
      titles = items;
      last = items.map(() => 'pending');
      ops.push({ op: 'declare', items });
    }
    for (let i = 0; i < titles.length && i < todos.length; i++) {
      const st = TODO_TO_BEAT[todos[i]?.status ?? 'pending'] ?? 'pending';
      if (st !== last[i]) {
        last[i] = st;
        ops.push({ op: 'advance', seq: i, status: st });
      }
    }
    return ops;
  };
}

// The codex/gemini live-ticking protocol (docs/17 §5): the daemon injects the ordered plan
// into the run and asks the model to print a line `NM_BEAT_DONE <n>` (n = the 1-based step it
// just finished). This reducer folds the model's streamed output into advance ops — finishing
// step n marks beat n-1 done and lights beat n. Idempotent per marker (streamed text arrives
// cumulatively / repeatedly), so re-scanning the same output never double-advances. Lighting a
// seq past the set is a harmless no-op downstream (the store updates 0 rows).
export function beatMarkerReducer(): (text: string) => BeatOp[] {
  const seen = new Set<number>();
  return (text) => {
    const ops: BeatOp[] = [];
    const re = /NM_BEAT_DONE\s+(\d+)/g; // fresh per call — a shared g-flag regex's lastIndex would race across sinks
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const n = Number(m[1]);
      if (!Number.isInteger(n) || n < 1 || n > MAX_BEATS || seen.has(n)) continue;
      seen.add(n);
      ops.push({ op: 'advance', seq: n - 1, status: 'done' });
      ops.push({ op: 'advance', seq: n, status: 'active' }); // no-op if n is past the last beat
    }
    return ops;
  };
}

// A serialized text sink built from a runtime's live output stream: scans for NM_BEAT_DONE
// markers and drives beat advances on a promise chain (streamed chunks can't race the state).
// Best-effort — a beats hiccup never disturbs the run. codex/gemini runQuery wire their stream to it.
export function beatMarkerSink(advance: (seq: number, status: string) => Promise<void>): (text: string) => void {
  const reduce = beatMarkerReducer();
  let chain: Promise<void> = Promise.resolve();
  return (text) => {
    const ops = reduce(text);
    if (!ops.length) return;
    chain = chain.then(async () => { for (const op of ops) if (op.op === 'advance') await advance(op.seq, op.status); }).catch(() => {});
  };
}

// Strip the NM_BEAT_DONE marker lines from a run's returned summary so the internal protocol
// never leaks into the thread message or the artifact.
export function stripBeatMarkers(text: string): string {
  // consume the whole marker line incl. its newline so removing an interleaved marker
  // doesn't leave a blank line; collapse any 3+ run that remains, then trim.
  return text.replace(/^[ \t]*NM_BEAT_DONE\s+\d+[ \t]*\r?\n?/gm, '').replace(/\n{3,}/g, '\n\n').trim();
}

// Phase-attempt titles for the daemon-declared flows (docs/17 §5). Round 1 keeps the
// canonical milestones. A rework round (revise_design / revise_plan / request_changes
// bounced it back) must declare DIFFERENT titles: the fresh set already gets a fresh
// run_id, but identical canned titles made a rework's tracker pixel-identical to the
// prior attempt's — the human reads that as "stuck on the previous beats". The counts
// are load-bearing: each flow advances exactly as many milestones as it declares.
export function designerBeatTitles(round: number): string[] {
  return round > 1
    ? ['Digest the feedback and restudy the design system', `Rework and render the mockups — round ${round}`]
    : ['Study the existing design system', 'Draft and render the mockups'];
}

export function architectBeatTitles(version: number): string[] {
  return version > 1
    ? ['Digest the review notes', 'Rework the implementation approach', 'Stress-test it with adversarial critics', `Finalize plan v${version} and the Definition of Done`]
    : ['Map the requirements and affected code', 'Draft the implementation approach', 'Stress-test it with adversarial critics', 'Finalize the plan and Definition of Done'];
}

export function shipperBeatTitles(round: number): string[] {
  return round > 1
    ? ['Digest the plan feedback', 'Re-scan the change and deploy notes', `Redraft release plan v${round}`, 'Propose the reworked plan']
    : ['Study the diff, PR deploy notes and CI', 'Scan for migrations · env vars · sync rules', 'Draft rollout order and rollback', 'Propose the release plan'];
}

export function reviewerBeatTitles(repoRequired: boolean, round: number): string[] {
  const gate = round > 1 ? `Re-review round ${round} against the Definition of Done` : 'Review against the Definition of Done';
  return repoRequired
    ? [round > 1 ? 'Confirm the resubmitted pull request is reviewable' : 'Confirm the pull request is reviewable', 'Settle CI on the pull request', gate]
    : [round > 1 ? 'Confirm the resubmission is reviewable' : 'Confirm the submission is reviewable', gate];
}

// One developer run's beat coordinator: the nm MCP tools (declare_beats/advance_beat)
// and the native TodoWrite mapping both funnel through here — FIRST declare wins the
// run, the other path is absorbed silently (no dual sets, no thrash). Tool methods
// return the human-legible string the model sees as its tool result, so the ritual is
// self-correcting ("no plan declared yet — call declare_beats first"). All writes
// serialize on one chain; settle() lets the caller drain it before the phase moves.
export interface BeatRunFns { declare: (items: string[]) => Promise<void>; advance: (seq: number, status: string) => Promise<void> }
export function createBeatRun(fns: BeatRunFns) {
  let owner: 'tools' | 'todos' | null = null; // which path declared — the other is absorbed/refused
  let count = 0;
  const completed = new Set<number>();
  let chain: Promise<void> = Promise.resolve();
  const q = (f: () => Promise<void>) => { chain = chain.then(f).catch(() => {}); };
  const reduceTodos = todoBeatReducer();
  return {
    declare(itemsIn: string[]): string {
      const items = (itemsIn ?? []).map((s) => String(s).trim()).filter(Boolean).slice(0, MAX_BEATS);
      if (owner) return 'a beat plan is already active for this run — advance it with advance_beat instead of re-declaring';
      if (items.length < 1) return 'declare_beats needs at least one real step';
      owner = 'tools';
      count = items.length;
      q(async () => { await fns.declare(items); await fns.advance(0, 'active'); });
      return `beat plan declared (${count} steps) — the human sees it live. Call advance_beat with each step number the moment it completes.`;
    },
    complete(step: number, blocked = false): string {
      if (!owner) return 'no beat plan declared yet — call declare_beats first (your ordered steps for this task)';
      if (!Number.isInteger(step) || step < 1 || step > count) return `step must be an integer between 1 and ${count}`;
      if (completed.has(step)) return `step ${step} was already marked — nothing to do`;
      completed.add(step);
      q(async () => {
        await fns.advance(step - 1, blocked ? 'blocked' : 'done');
        if (!blocked && step < count && !completed.has(step + 1)) await fns.advance(step, 'active');
      });
      return blocked
        ? `step ${step} marked blocked — say why in your summary so the reviewer sees it`
        : `step ${step} done${step < count ? ` — step ${step + 1} is now active` : ' — all steps complete'}`;
    },
    // The native-TodoWrite path: full-list snapshots absorb into the same run. Once the
    // TOOLS declared, todo snapshots are ignored entirely (positional advances from a
    // different list must never write into the tool-declared set); if todos declare
    // first they own the run, and later declare_beats calls get the "already active"
    // reply (advance_beat still works — same set, same 1-based positions).
    absorbTodos(todos: Array<{ content?: string; status?: string }>): void {
      if (owner === 'tools') return;
      const ops = reduceTodos(todos);
      if (!ops.length) return;
      if (ops[0]!.op === 'declare') {
        owner = 'todos';
        count = (ops[0] as { items: string[] }).items.length;
      }
      for (const op of ops) {
        if (op.op === 'declare') q(() => fns.declare(op.items));
        else q(() => fns.advance(op.seq, op.status));
      }
    },
    get declared(): boolean { return owner !== null; },
    settle(): Promise<void> { return chain; },
    /**
     * The phase is moving — stop the set claiming it is still working.
     *
     * `settle()` only flushes pending WRITES; it never closes the set, so a run that submitted with
     * a beat still `active` left that step spinning forever. Live: a worker declared 7 steps, ticked
     * 4, submitted — and the tracker showed "4/7" with step 5 pulsing long after the task reached
     * in_review. The animation is driven by `status === 'active'`, so the fix is to leave nothing in
     * that state once the work is over.
     *
     * The in-flight step IS marked done: the worker stopped because it finished, not because it gave
     * up. Steps it never started stay `pending`, so the tracker reads "5/7" — honest about what was
     * ticked — rather than being rounded up to 7/7, which would be the set lying to look tidy.
     */
    closeOut(): Promise<void> {
      if (!owner) return chain;
      const active = highestCompleted() + 1;
      if (active >= 1 && active <= count && !completed.has(active)) {
        completed.add(active);
        q(() => fns.advance(active - 1, 'done'));
      }
      return chain;
    },
  };

  function highestCompleted(): number {
    let n = 0;
    for (const s of completed) if (s > n) n = s;
    return n;
  }
}
