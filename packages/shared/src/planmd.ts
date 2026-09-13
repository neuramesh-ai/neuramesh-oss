// The implementation plan as a DOCUMENT (2026-08-19, founder report): a plan-first unit's plan
// lived only as `tasks.work_plan` jsonb rendered into a gate card — nothing to open in a tab,
// nothing for the block-comment review overlay to bind to, while architect plans and ship plans
// both materialize as `*-vN.md` artifacts and get that overlay for free (Md.tsx linkifies the
// names). This renders the SAME markdown for both the birth plan and every revision, so the
// thread's preview card, the full-tab view, and the review overlay all read one document.
import { executionLegLabel } from './journey';

export interface PlanDocInput {
  number: number;
  title: string;
  kind?: string | null;
  legs: readonly string[];
  subtasks: readonly string[];
  approach: string;
  version: number;
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
  const prose = body.replace(PLAN_REF_RE, '').replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
  return { version: Number(m[1]), prose };
}

export function renderPlanMarkdown(p: PlanDocInput): string {
  const journey = ['plan', ...p.legs.filter((l) => l !== 'build'), executionLegLabel(p.kind).toLowerCase(), 'accept']
    .filter((l, i, a) => a.indexOf(l) === i);
  const lines = [
    `# Implementation plan · v${p.version} — #${p.number} ${p.title}`,
    '',
    `**Journey:** ${journey.join(' → ')}`,
  ];
  if (p.subtasks.length) {
    lines.push('', '## Subtasks (minted on approval)', ...p.subtasks.map((s) => `- ${s}`));
  }
  lines.push('', '## Approach', '', p.approach.trim(), '');
  return lines.join('\n');
}
