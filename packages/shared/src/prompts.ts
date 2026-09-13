import { composePrompt } from './agentcontract';
// Role prompt ASSEMBLY. The words themselves live in defaults/agents/*.yaml and are passed in —
// see buildDesignPrompt, whose `blocks` argument is required precisely so nobody can compose a
// designer turn out of nothing.
//
// This file once ALSO carried hand-synced copies of the worker and reviewer prompts "for the
// benchmark harness" — and they drifted, so the leaderboard measured a prompt no agent runs
// (2026-08-18 audit, defect A7). packages/bench now composes from defaults/agents/*.yaml itself
// (packages/bench/src/contracts.ts); nothing here may duplicate a contract's words again.

/** Minimal task shape the design prompt needs (a structural subset of the host's task rows). */
export interface DesignTaskInput {
  number: number;
  title: string;
  description?: string | null;
  /** JSON array of resolved-requirement checklist strings, or null. */
  requirements?: string | null;
}

/**
 * The designer's agentic-turn prompt (docs/14 §3): study the existing design
 * language in the checkout FIRST, then produce self-contained HTML mockups under
 * `.nm-evidence/design/`. The host collects those files and proposes them as
 * versioned `design` artifacts for the human's approval gate.
 */
/** The prompt blocks a designer turn reads — defaults/agents/designer.yaml `prompt`. */
export type PromptBlocks = Record<string, string>;

/**
 * The designer's agentic-turn prompt (docs/14 §3): study the existing design language in the
 * checkout FIRST, then produce self-contained HTML mockups under `.nm-evidence/design/`.
 *
 * The WORDS live in the designer's contract and are passed in — this function owns only the
 * assembly (which study block applies, parsing the checklist). Blocks are a required argument on
 * purpose: defaulting them to {} would compose an empty prompt and ship a designer with no
 * instructions, which is precisely the failure mode this split exists to make impossible.
 */
export function buildDesignPrompt(
  blocks: PromptBlocks,
  t: DesignTaskInput,
  opts?: {
    repoBacked?: boolean;
    feedback?: string | null;
    channelBlock?: string | null;
    /** filenames of the previous round, already staged in `.nm-evidence/design/` */
    priorMockups?: string[] | null;
    /** the round those files came from (this run is priorRound + 1) */
    priorRound?: number | null;
  },
): string {
  const B = (key: string, vars: Record<string, string | undefined> = {}) => composePrompt(blocks[key] ?? '', vars);
  const repoBacked = opts?.repoBacked ?? true;
  const prior = (opts?.priorMockups ?? []).filter(Boolean);
  let checklist: string[] = [];
  try {
    checklist = t.requirements ? (JSON.parse(t.requirements) as string[]) : [];
  } catch {
    /* legacy rows */
  }
  const study = prior.length
    ? B('study.prior', { round: String(opts?.priorRound ?? 1), files: prior.join(', ') })
    : repoBacked
    ? B('study.repo')
    : B('study.none');
  const feedback = (opts?.feedback ?? '').trim();
  return B('turn', {
    'task.number': String(t.number),
    'task.title': t.title,
    descriptionBlock: t.description ? `\n${t.description}\n` : '',
    checklistBlock: checklist.length ? `\n${B('checklist', { items: checklist.map((c) => `- ${c}`).join('\n') })}\n` : '',
    channelBlock: opts?.channelBlock ? `\n${B('channel', { channelBlock: opts.channelBlock })}\n` : '',
    feedbackBlock: feedback ? `\n${B('feedback', { feedback })}\n` : '',
    study,
    deliverableCount: prior.length ? 'the edited' : '1–3',
    deliverableWhere: prior.length ? 'in' : 'written to',
  });
}

/** The designer agent's system prompt (Claude runtime; CLIs fold everything into the turn prompt). */
export function designSystemPrompt(blocks: PromptBlocks, agentName: string, repoBacked: boolean): string {
  return composePrompt(blocks['system'] ?? '', {
    agentName,
    where: repoBacked ? ' from a read-only repository checkout' : ' in a scratch workspace',
  });
}

export type ReviewVerdict = 'approve' | 'changes';

/** Thrown when a reply contains no usable verdict — lets the harness retry/aggregate a format
 * failure without ever treating it as a silent approve. */
export class ReviewParseError extends Error {}

/**
 * Parse a reviewer model's raw output into a verdict. STRICT by design: unlike the production
 * host's fail-open (agents.ts reviewFlow approves on a parse error because a structural repo
 * gate already passed), the benchmark MUST surface an unparseable verdict as a thrown error so
 * we measure the model's TRUE precision/recall — never silently score a garbled reply as an
 * approve. This is the eval analogue of the docs/10 §8 fail-open warning.
 */
export function parseReviewVerdict(raw: string): { verdict: ReviewVerdict; reason: string } {
  // Prefer a complete JSON object (handles ```json fences — we match the braces, not the fence).
  const obj = raw.match(/\{[\s\S]*\}/);
  if (obj) {
    try {
      const j = JSON.parse(obj[0]) as { verdict?: unknown; reason?: unknown };
      if (j.verdict === 'approve' || j.verdict === 'changes') {
        return { verdict: j.verdict, reason: typeof j.reason === 'string' ? j.reason.trim() : '' };
      }
    } catch {
      /* malformed / truncated object — fall through to field extraction */
    }
  }
  // Fallback: pull the verdict field directly. Robust to a truncated reason or a missing close
  // brace (a verbose model cut off at max_tokens still stated its verdict). This is NOT fail-open:
  // if there is no `"verdict":"approve|changes"` at all, we still throw rather than assume approve.
  const v = raw.match(/"verdict"\s*:\s*"(approve|changes)"/);
  if (v) {
    const reason = raw.match(/"reason"\s*:\s*"([^"]*)/);
    return { verdict: v[1] as ReviewVerdict, reason: reason ? reason[1]!.trim() : '' };
  }
  throw new ReviewParseError(`reviewer output has no verdict: ${raw.slice(0, 200)}`);
}

// ── Ship stage (docs/23) ─────────────────────────────────────────────────────
// The shipper's release-planning turn: one completion, no tools — the host
// pre-gathers everything (diff, PR deploy notes, CI verdict, shipscan findings,
// release docs, lessons, skills) so the same prompt runs on every runtime.

// The shipper's SYSTEM prompt moved to defaults/agents/shipper.yaml (it is the agent's
// behaviour, and behaviour belongs in a contract you can read). What stays here is the USER
// half — a labelled dump of the task's own facts, which is data plumbing, not language.


export interface ShipPlanInput {
  taskNumber: number;
  title: string;
  definitionOfDone: string;
  prNumber: number | null;
  prTitle: string;
  deployNotes: string;   // the PR body's `## Deploy notes` section, verbatim ('' when absent)
  ciNote: string;        // the host-settled CI verdict line
  scanNote: string;      // shipscan findings (deterministic)
  diffSummary: string;   // truncated unified diff / file list
  releaseDocs: string;   // the repo's release doctrine excerpt ('' when none found)
  lessonsNote: string;   // channelLessons() block ('' when none)
  skillsNote: string;    // bundled shipping/launch skill excerpt ('' when none)
  reworkFeedback: string; // revise_ship_plan feedback when redrafting ('' first round)
  rosterNote: string;    // channel roster with real agent ids ('' when unavailable)
}

export function buildShipUserPrompt(i: ShipPlanInput): string {
  return [
    `Task #${i.taskNumber}: ${i.title}`,
    i.prNumber ? `Pull request: #${i.prNumber} — ${i.prTitle}` : 'Pull request: none',
    i.definitionOfDone ? `Definition of Done (already review-approved against this):\n${i.definitionOfDone}` : '',
    i.ciNote,
    i.scanNote,
    i.deployNotes ? `PR deploy notes (the author's own manual-step declarations — honor them):\n${i.deployNotes}` : 'PR deploy notes: none declared.',
    i.rosterNote,
    i.releaseDocs ? `Team release doctrine (excerpt):\n${i.releaseDocs}` : '',
    i.lessonsNote,
    i.skillsNote,
    i.reworkFeedback ? `REWORK — the human bounced the previous plan with this feedback; address it explicitly:\n${i.reworkFeedback}` : '',
    `Diff summary:\n${i.diffSummary}`,
  ].filter(Boolean).join('\n\n');
}
