// A review is `{ artifact, gate, verdict[] }` (mockups/review-in-tab.html, docs/36 §13).
//
// This is the model behind the review TAB, and its whole reason for existing is that an
// implementation plan, a release plan and a design round are the SAME surface bound to different
// data. The artifact supplies the bytes and the mode segment; the gate supplies who may decide and
// what the decision is called; the verdicts are the buttons. If a second component per kind ever
// appears beside this file, the model was wrong — that is the claim these functions make, and
// `review.test.ts` is where it is held to it.
//
// Kept pure and renderer-free for the same reason `wtabs.ts` is: the rules that stop a stale round
// presenting a live gate, and that keep a human-only sign-off labelled as one, are provable
// without mounting anything.

import { TRANSITIONS, type TransitionName } from '@neuramesh/shared';
// The artifact-name parsers live in review-names.ts. They are re-exported here because this
// module is the public face of reviewing — a consumer should not have to know the file split.
export { designVer, planVer, reviewKind, shipPlanVer } from './review-names';
export type { ReviewArtifact, ReviewBinding, ReviewComment, ReviewGate, ReviewGateState, ReviewKind, ReviewMode, ReviewRound, ReviewSubject, ReviewVerdict } from './review-types';
import { reviewKind, versionOf } from './review-names';
import { type ReviewArtifact, type ReviewBinding, type ReviewComment, type ReviewGateState, type ReviewKind, type ReviewMode, type ReviewSubject, type ReviewVerdict } from './review-types';

interface KindSpec {
  label: string;
  subject: string;
  /** the ONE state at which this kind's gate is live */
  reviewState: string;
  approve: { label: string; command: string | null; say?: (taskNumber: number) => string };
  changes: { label: string; command: string };
}

const KINDS: Record<ReviewKind, KindSpec> = {
  plan: {
    label: 'plan review',
    subject: 'the plan',
    reviewState: 'plan_review',
    // There is no `approve_plan` edge: the human answers the orchestrator's question card and the
    // orchestrator offers the task. The Approve button posts that card's EXACT answer line, so the
    // card collapses as answered and the reply-watch treats it as the human's verdict.
    approve: { label: 'Approve', command: null, say: (n) => `**Approve the plan for #${n}?** → Approve` },
    changes: { label: 'Request changes', command: 'task.revise_plan' },
  },
  ship: {
    label: 'release plan',
    subject: 'the release',
    reviewState: 'ship_review',
    approve: { label: 'Approve release plan', command: 'task.approve_ship_plan' },
    changes: { label: 'Request changes', command: 'task.revise_ship_plan' },
  },
  design: {
    label: 'design review',
    subject: 'the design',
    reviewState: 'design_review',
    approve: { label: 'Approve design', command: 'task.approve_design' },
    changes: { label: 'Revise', command: 'task.revise_design' },
  },
};

/**
 * Whether every legal actor for this transition is a human — read from the FSM table, never
 * restated here. `approve_ship_plan` and `approve_design` are `by: ['human']` in packages/shared,
 * so the tab wears a human-only badge because the server would reject anyone else, not because a
 * reviewer happened to know. Change the table and the badge follows.
 */
export function humanOnly(command: string | null): boolean {
  if (!command) return false;
  const name = command.replace(/^task\./, '') as TransitionName;
  const specs = TRANSITIONS.filter((t) => t.name === name);
  return specs.length > 0 && specs.every((t) => t.by.length === 1 && t.by[0] === 'human');
}

/**
 * Bind an artifact to its gate. Returns null for anything that is not a review — the caller opens
 * an ordinary file tab instead, which is the honest thing to do with bytes nobody is deciding on.
 *
 * The three postures, in the order they are decided:
 *  - **superseded** — a newer round of the same kind exists. It opens READ-ONLY with a door to the
 *    live round: this is what stops a stale link becoming a second live gate, and it is the one
 *    rule the retired overlay did not have (it offered Approve on any round while the task sat at
 *    its gate).
 *  - **settled** — the task has left the gate (or we cannot see its state at all). A record, not a
 *    decision. An unknown state deliberately lands here: offering a verdict the server would
 *    reject is a lie told to the one person who trusted the button.
 *  - **open** — this round, at its own review state. Buttons.
 */
export function bindReview(artifact: ReviewArtifact, subject: ReviewSubject): ReviewBinding | null {
  const kind = reviewKind(artifact.name, artifact.kind);
  if (!kind) return null;
  const spec = KINDS[kind];
  const version = versionOf(kind, artifact.name);

  // this artifact's own family, newest first — a task carries plans, ship plans and design rounds
  // side by side, and a v2 plan is not superseded by a v3 design
  const family = (subject.rounds ?? [])
    .filter((r) => reviewKind(r.name) === kind)
    .map((r) => ({ ...r, v: versionOf(kind, r.name) }))
    .sort((a, b) => b.v - a.v || a.name.localeCompare(b.name));
  const newest = family[0];
  const latest = !newest || newest.v <= version;

  const prev = family.find((r) => r.v < version && !!r.content);
  const diffAgainst = prev ? { name: prev.name, content: prev.content ?? '' } : null;

  const state: ReviewGateState = !latest ? 'superseded' : subject.taskState === spec.reviewState ? 'open' : 'settled';
  const approveCmd = spec.approve.command;

  const note =
    state === 'superseded' ? `Settled — revised into v${newest?.v ?? version + 1}`
      : state === 'settled' ? (subject.approvedAt ? 'Approved' : 'Settled — no longer under review')
        : null;

  const verdicts: ReviewVerdict[] = state !== 'open' ? [] : [
    {
      id: 'approve',
      label: spec.approve.label,
      tone: 'go',
      needsComments: false,
      say: spec.approve.say ? spec.approve.say(subject.taskNumber) : null,
      command: approveCmd,
      closes: true,
    },
    {
      id: 'changes',
      label: spec.changes.label,
      tone: 'pri',
      needsComments: true,
      say: 'packet',
      command: spec.changes.command,
      closes: true,
    },
  ];

  // the segment is the artifact's: a design round RENDERS (it is a page), a plan PREVIEWS (it is
  // markdown), and either can diff when it has a predecessor to diff against
  const rendered = kind === 'design' || /\.html?$/i.test(artifact.name);
  const modes: ReviewMode[] = rendered ? ['rendered', 'source'] : ['preview', 'source'];
  if (diffAgainst) modes.push('diff');

  return {
    kind,
    name: artifact.name,
    label: spec.label,
    version,
    latest,
    modes,
    defaultMode: modes[0]!,
    diffAgainst,
    diffLabel: diffAgainst ? `Diff v${versionOf(kind, diffAgainst.name)}` : null,
    gate: { state, humanOnly: humanOnly(approveCmd), subject: spec.subject, note },
    verdicts,
    openLatest: latest ? null : newest?.name ?? null,
    openLatestVersion: latest ? null : newest?.v ?? null,
    taskNumber: subject.taskNumber,
  };
}

// ── the batch ──────────────────────────────────────────────────────────────────────────────────
// RULING 4: unsent comments live ON THE TAB. Keeping the batch a plain value (rather than state
// inside the review component) is what makes that structural — a tab switch, a re-render or a
// future change to how panes mount cannot lose a half-written batch, because the batch does not
// live in the thing being switched away from.

let seq = 0;

/** an empty comment is not a comment; ids are local to the batch and never reused */
export function addComment(list: ReviewComment[], c: { block: number; quote?: string; text: string }): ReviewComment[] {
  const text = c.text.trim();
  if (!text) return list;
  const id = Math.max(seq, ...list.map((x) => x.id)) + 1;
  seq = id;
  return [...list, { id, block: c.block, quote: c.quote, text }];
}

/** editing to empty deletes, which is what a cleared textarea means */
export function editComment(list: ReviewComment[], id: number, text: string): ReviewComment[] {
  if (!list.some((c) => c.id === id)) return list;
  const t = text.trim();
  if (!t) return deleteComment(list, id);
  return list.map((c) => (c.id === id ? { ...c, text: t } : c));
}

export function deleteComment(list: ReviewComment[], id: number): ReviewComment[] {
  return list.some((c) => c.id === id) ? list.filter((c) => c.id !== id) : list;
}

/**
 * The batch, spent as one message.
 *
 * Every marker in here is load-bearing and greppable, because events are not replicated and the
 * agents read their feedback out of the THREAD: the shipper greps `Release-plan changes requested`
 * (agents.ts), and designerFlow reads the round off the `🎨 Design changes requested` line. The
 * three headers differ; the body — one quoted anchor per comment, ordered by block — does not.
 */
export function reviewPacket(b: ReviewBinding, comments: ReviewComment[], blocks: string[]): string {
  const n = comments.length;
  const plural = n === 1 ? 'comment' : 'comments';
  const lines = [...comments]
    .sort((x, y) => x.block - y.block || x.id - y.id)
    .map((c) => {
      const ctx = (c.quote || blocks[c.block] || `block ${c.block + 1}`)
        .replace(/\s+/g, ' ')
        .replace(/^[#>\-*\d.\s]+/, '')
        .slice(0, 140);
      return `> ${ctx}\n— ${c.text}`;
    })
    .join('\n\n');
  if (b.kind === 'ship') {
    return `📦 Release-plan changes requested on #${b.taskNumber}:\n${n} ${plural} from the plan review —\n\n${lines}`;
  }
  if (b.kind === 'design') {
    return `🎨 Design changes requested on #${b.taskNumber} (round ${b.version}):\n${lines}`;
  }
  return `📝 Plan review — ${n} ${plural} on #${b.taskNumber}:\n\n${lines}`;
}

// ── the diff mode ──────────────────────────────────────────────────────────────────────────────

/** above this, the LCS table is not worth building — the rounds are re-read, not diffed */
const DIFF_MAX_LINES = 4000;
const DIFF_CONTEXT = 3;

/**
 * A unified diff between two rounds, in the format `DiffView` already parses — so "what changed
 * since the round I last commented on" costs one pure function and no new renderer.
 *
 * Identical rounds produce a header with no hunks rather than a fake one: a diff view that always
 * shows something is a diff view you stop believing.
 */
export function diffRounds(prev: string, next: string, name: string): string {
  const a = lines(prev);
  const b = lines(next);
  const head = `diff --git a/${name} b/${name}\n--- a/${name}\n+++ b/${name}\n`;
  if (a.length > DIFF_MAX_LINES || b.length > DIFF_MAX_LINES) {
    return `${head}@@ -1,${a.length} +1,${b.length} @@\n(rounds too large to diff — read them side by side)\n`;
  }
  const ops = lcsOps(a, b);
  const hunks = group(ops);
  if (!hunks.length) return head;
  return head + hunks.map((h) => render(h, ops)).join('');
}

const lines = (s: string): string[] => (s === '' ? [] : s.replace(/\n$/, '').split('\n'));

type Op = { t: ' ' | '-' | '+'; s: string };

/** longest common subsequence over LINES — the shape every unified diff is cut from */
function lcsOps(a: string[], b: string[]): Op[] {
  const n = a.length;
  const m = b.length;
  // table[i][j] = length of the LCS of a[i…] and b[j…]
  const table: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i]![j] = a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  const out: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ t: ' ', s: a[i]! }); i++; j++; }
    else if (table[i + 1]![j]! >= table[i]![j + 1]!) { out.push({ t: '-', s: a[i]! }); i++; }
    else { out.push({ t: '+', s: b[j]! }); j++; }
  }
  while (i < n) out.push({ t: '-', s: a[i++]! });
  while (j < m) out.push({ t: '+', s: b[j++]! });
  return out;
}

/** the index ranges worth printing: every change, plus DIFF_CONTEXT lines either side, merged */
function group(ops: Op[]): Array<{ from: number; to: number }> {
  const out: Array<{ from: number; to: number }> = [];
  ops.forEach((op, k) => {
    if (op.t === ' ') return;
    const from = Math.max(0, k - DIFF_CONTEXT);
    const to = Math.min(ops.length - 1, k + DIFF_CONTEXT);
    const last = out[out.length - 1];
    if (last && from <= last.to + 1) last.to = Math.max(last.to, to);
    else out.push({ from, to });
  });
  return out;
}

function render(h: { from: number; to: number }, ops: Op[]): string {
  let aLine = 1;
  let bLine = 1;
  for (let k = 0; k < h.from; k++) {
    if (ops[k]!.t !== '+') aLine++;
    if (ops[k]!.t !== '-') bLine++;
  }
  let aCount = 0;
  let bCount = 0;
  const body: string[] = [];
  for (let k = h.from; k <= h.to; k++) {
    const op = ops[k]!;
    if (op.t !== '+') aCount++;
    if (op.t !== '-') bCount++;
    body.push(`${op.t}${op.s}`);
  }
  return `@@ -${aLine},${aCount} +${bLine},${bCount} @@\n${body.join('\n')}\n`;
}
