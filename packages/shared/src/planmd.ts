// The implementation plan as a DOCUMENT (2026-08-19, founder report): a plan-first unit's plan
// lived only as `tasks.work_plan` jsonb rendered into a gate card — nothing to open in a tab,
// nothing for the block-comment review overlay to bind to, while architect plans and ship plans
// both materialize as `*-vN.md` artifacts and get that overlay for free (Md.tsx linkifies the
// names). This renders the SAME markdown for both the birth plan and every revision, so the
// thread's preview card, the full-tab view, and the review overlay all read one document.
import { executionLegLabel } from './journey';
import { trimLineEnds } from './linear';

export interface PlanDocInput {
  number: number;
  title: string;
  kind?: string | null;
  legs: readonly string[];
  subtasks: readonly string[];
  approach: string;
  version: number;
  /** a repository is bound, or the offer binds one later (control-api createtask.ts: a code unit in a
   *  room whose project has a repository), so the person's last word merges a pull request. else accept */
  repo?: boolean;
}

export function planArtifactName(version: number): string {
  return `implementation-plan-v${version}.md`;
}

/** the ONE matcher for plan-document artifacts — the inverse of planArtifactName */
export function isPlanDoc(name: string): boolean {
  return /^implementation-plan-v\d+\.md$/.test(name);
}

// ── The plan-review CARD (2026-08-19, founder direction) ──
// Approve/request-changes live as a thread-native card — the question-card idiom, richer: the
// response pills sit above an embedded preview of the plan document, one component. The message
// carries this marker exactly like ‹wb:id› / ‹task:id›; renderers that know it swap the card in,
// everything else shows the readable line the body leads with.
const PLAN_REF_RE = /‹plan:v(\d+)›/;

export function planRefMarker(version: number): string {
  return `‹plan:v${version}›`;
}

export interface PlanRef { version: number; prose: string }

export function parsePlanRef(body: string | null | undefined): PlanRef | null {
  if (!body) return null;
  const m = PLAN_REF_RE.exec(body);
  if (!m) return null;
  const prose = trimLineEnds(body.replace(PLAN_REF_RE, '')).replace(/\n{3,}/g, '\n\n').trim();
  return { version: Number(m[1]), prose };
}

/** how a plan version reaches the thread: a unit's birth plan, a revision, or a hands-off run's plan */
export type PlanPostKind = 'birth' | 'revised' | 'routine' | 'playbook';

/**
 * the readable line a plan message leads with (2026-10-05: one function for the server and the preview
 * story, in the house words). it always carries the plan's file name: a published desktop's Md and the
 * phone's thread prose find that name and link it to the plan (the contract test in planmd.test.ts).
 */
export function planPostLine(version: number, kind: PlanPostKind = 'birth'): string {
  const name = planArtifactName(version);
  switch (kind) {
    case 'revised': return `Implementation plan **v${version}** (revised): ${name}`;
    case 'routine': return `⏱ Routine run: implementation plan **v${version}** (${name}). The work starts now and runs to the end without you. You get a notification when it is done.`;
    case 'playbook': return `▶ Playbook run: plan **v${version}** (${name}) comes from the playbook. The work starts now. When the deliverable is ready, say accept in this thread to close it.`;
    default: return `Implementation plan **v${version}**: ${name}`;
  }
}

/** the whole plan message the server posts: the readable line, then the ‹plan:vN› marker on its own line */
export function planMessage(version: number, kind: PlanPostKind = 'birth'): string {
  return `${planPostLine(version, kind)}\n${planRefMarker(version)}`;
}

// the causal order (docs/41, and journeyFor's declared branch): a declared design round, the
// execution leg, a declared review. an unknown leg keeps its place after them
const LEG_RANK: Record<string, number> = { design: 0, build: 1, review: 2 };

export function renderPlanMarkdown(p: PlanDocInput): string {
  const legs = [...new Set(['build', ...p.legs])].sort((a, b) => (LEG_RANK[a] ?? 3) - (LEG_RANK[b] ?? 3));
  const journey = ['plan', ...legs.map((l) => (l === 'build' ? executionLegLabel(p.kind).toLowerCase() : l)), p.repo ? 'merge' : 'accept']
    .filter((l, i, a) => a.indexOf(l) === i);
  const lines = [
    `# Implementation plan · v${p.version} · #${p.number} ${p.title}`,
    '',
    `**Journey:** ${journey.join(' → ')}`,
  ];
  if (p.subtasks.length) {
    lines.push('', '## Subtasks (minted on approval)', ...p.subtasks.map((s) => `- ${s}`));
  }
  lines.push('', '## Approach', '', p.approach.trim(), '');
  return lines.join('\n');
}
