// The review MODEL's shapes — an artifact, its rounds, the gate that decides it, and the
// verdicts that are its buttons. Types only: the behaviour is in review.ts, and separating the
// two is what lets a consumer name a shape without importing the logic.
// Split out of review.ts.



export type ReviewKind = 'plan' | 'ship' | 'design';

/**
 * How the artifact shows itself. Deliberately NOT `WTabMode`: `rendered` (an HTML design round in
 * an iframe) and `preview` (rendered markdown) are different reads of different bytes, and the
 * segment is the ARTIFACT's — a design round renders, a plan previews, a diff diffs.
 */
export type ReviewMode = 'preview' | 'rendered' | 'source' | 'diff';

/** the bytes under review */
export interface ReviewArtifact {
  name: string;
  content: string;
  /** the artifact row's kind (`doc`, `design`, …) — a second way to say "this is a design round" */
  kind?: string | null;
  id?: string | null;
}

/** one round of the same kind on the same task */
export interface ReviewRound {
  name: string;
  content?: string | null;
}

/** what the task can tell us about the decision */
export interface ReviewSubject {
  taskNumber: number;
  /** the FSM state; the gate is live ONLY at the matching review state */
  taskState?: string | null;
  /** every round of every kind on the task — the model picks its own family out of it */
  rounds?: ReviewRound[];
  /** stamped by approve_ship_plan (docs/23) */
  approvedAt?: string | null;
}

export interface ReviewComment {
  id: number;
  block: number;
  quote?: string;
  text: string;
}

/** open = the decision is live · settled = it was made · superseded = a newer round owns the gate */
export type ReviewGateState = 'open' | 'settled' | 'superseded';

export interface ReviewGate {
  state: ReviewGateState;
  /** the FSM says so, not the reviewer's memory (see `humanOnly`) */
  humanOnly: boolean;
  /** what is being decided: "the plan" · "the release" · "the design" */
  subject: string;
  /** the sentence a settled or superseded round wears instead of buttons */
  note: string | null;
}

export interface ReviewVerdict {
  id: 'approve' | 'changes';
  label: string;
  /** `go` is the affirmative pill, `pri` the accented one — the mockup's two button tones */
  tone: 'go' | 'pri';
  /** a spent batch is the only thing `changes` can be made of */
  needsComments: boolean;
  /**
   * a thread message posted alongside the command. The literal `'packet'` means "the batched
   * comments" (built by `reviewPacket`); any other string is posted verbatim — which is how a
   * plan's Approve answers the orchestrator's card, an act with no FSM edge of its own.
   */
  say: 'packet' | string | null;
  /** the audited command, when the verdict has one */
  command: string | null;
  /** RULING 1: a spent verdict closes the tab and returns to the conversation */
  closes: boolean;
}

export interface ReviewBinding {
  kind: ReviewKind;
  name: string;
  /** the kind chip: `plan review` · `release plan` · `design review` */
  label: string;
  version: number;
  latest: boolean;
  modes: ReviewMode[];
  defaultMode: ReviewMode;
  /** the previous round, when there is one to diff against */
  diffAgainst: { name: string; content: string } | null;
  /** the diff mode's own label, which names the round it compares to */
  diffLabel: string | null;
  gate: ReviewGate;
  verdicts: ReviewVerdict[];
  /** the live round's file name, when THIS round is not it */
  openLatest: string | null;
  /** …and its version, so the door can name where it goes */
  openLatestVersion: number | null;
  taskNumber: number;
}

// ── what is reviewable ─────────────────────────────────────────────────────────────────────────
// The three families, and their versions. These regexes are the IDENTITY of a reviewable
// artifact, so they live here rather than being restated per consumer.
