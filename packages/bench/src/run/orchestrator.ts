// Orchestration = hybrid 60/40. The candidate outputs a STRUCTURED decomposition (tasks with a
// role, a Definition of Done, and dependencies) via structured output; we score it structurally
// (valid roles · every task has a DoD · sensible count · acyclic deps) and have the cross-family
// ensemble judge score the decomposition's quality. quality = 0.6·structural + 0.4·judge.
import { CEILINGS, completeJson } from '../runtime';
import { judgeRubric } from '../judge';
import { ORCHESTRATION_RUBRIC } from '../rubrics';
import { costUsd } from '../pricing';
import { TASK_KINDS } from '@neuramesh/shared';
import type { JudgedTask, JudgedRun } from './judged';

const VALID_ROLES = ['orchestrator', 'architect', 'developer', 'worker', 'reviewer', 'designer', 'sales', 'curator'];

export const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          kind: { type: 'string', enum: [...TASK_KINDS] },
          role: { type: 'string' },
          definitionOfDone: { type: 'string' },
          dependsOn: { type: 'array', items: { type: 'integer' } },
        },
        required: ['title', 'kind', 'role', 'definitionOfDone', 'dependsOn'],
        additionalProperties: false,
      },
    },
  },
  required: ['tasks'],
  additionalProperties: false,
};

export const ORCH_SYSTEM =
  "You are the orchestrator of a team of role-specialised AI agents (roles: orchestrator, architect, developer, worker, reviewer, designer, sales, curator). Decompose the user's request into the minimal correct set of board tasks. Each task has a title, a `kind` (bug · feature · refactor · chore · docs · research · spike · design — what the work IS), the single role that should do it, a concrete testable Definition of Done, and dependsOn — the indices of the tasks that must finish before it. Route each task to the LIGHTEST SAFE PATH: an architect (planning) task is the EXCEPTION you justify — include one ONLY when net-new/feature-shaped work needs a designed APPROACH before it is safe to build (a novel/unproven approach, many components, schema/security/performance/irreversible decisions). That is an unknown APPROACH, never an unknown CAUSE: a bug's cause is found by a developer investigating the code, never by an architect plan, so bugs — even hard or recurring ones where prior fixes failed — go STRAIGHT to a developer to root-cause (a bug reaches the architect only if investigation reveals a structural change, never preemptively). Small, well-understood changes go straight to a developer too; user-facing visual work gets a designer first; research/analysis goes to a worker. Kind is a prior, not a gate — any kind may take any route. Prefer the smallest plan that fully delivers the request; do NOT insert an architect task for a bug (however hard or recurring) or a well-scoped change.";

interface PlanTask {
  title: string;
  kind: string;
  role: string;
  definitionOfDone: string;
  dependsOn: number[];
}

function isDag(tasks: PlanTask[]): boolean {
  const n = tasks.length;
  const state = new Array<number>(n).fill(0); // 0 unvisited · 1 visiting · 2 done
  const visit = (i: number): boolean => {
    if (i < 0 || i >= n) return true;
    if (state[i] === 1) return false; // back-edge → cycle
    if (state[i] === 2) return true;
    state[i] = 1;
    for (const d of tasks[i]?.dependsOn ?? []) if (!visit(d)) return false;
    state[i] = 2;
    return true;
  };
  for (let i = 0; i < n; i++) if (!visit(i)) return false;
  return true;
}

/**
 * Recover the task array from a model's structured output, tolerating the double-encoding some
 * models emit (`tasks` as a JSON STRING containing either the array or a whole {tasks:[…]}
 * object — Sonnet 5 did this until `strict: true`). We measure orchestration ability, not
 * JSON-nesting discipline.
 */
export function coercePlanTasks(val: unknown): PlanTask[] {
  if (Array.isArray(val)) return val as PlanTask[];
  if (typeof val === 'string') {
    try {
      const inner = JSON.parse(val) as unknown;
      if (Array.isArray(inner)) return inner as PlanTask[];
      if (inner && typeof inner === 'object' && Array.isArray((inner as { tasks?: unknown }).tasks)) {
        return (inner as { tasks: PlanTask[] }).tasks;
      }
    } catch {
      /* not parseable → no plan */
    }
  }
  return [];
}

/** Structural correctness of a decomposition, 0–100 (four equally-weighted checks). */
export function structuralScore(tasks: PlanTask[]): number {
  if (!tasks.length) return 0;
  let s = 0;
  if (tasks.every((t) => VALID_ROLES.includes(t.role))) s++;
  if (tasks.every((t) => (TASK_KINDS as readonly string[]).includes(t.kind))) s++;
  if (tasks.every((t) => (t.definitionOfDone ?? '').trim().length >= 12)) s++;
  if (tasks.length >= 2 && tasks.length <= 8) s++;
  if (tasks.every((t) => (t.dependsOn ?? []).every((d) => d >= 0 && d < tasks.length)) && isDag(tasks)) s++;
  return (s / 5) * 100;
}

export async function runOrchestration(model: string, task: JudgedTask): Promise<JudgedRun> {
  const started = Date.now();
  // CEILINGS.orchestrator (runtime.ts). At 5000 this truncated Sonnet 5 into a bimodal 43±39 of
  // structural zeros, the third budget-artifact incident of this suite.
  const gen = await completeJson(model, ORCH_SYSTEM, task.prompt, PLAN_SCHEMA, CEILINGS.orchestrator);
  const latencyMs = Date.now() - started;
  const cand = costUsd(model, gen.tokensIn, gen.tokensOut);
  let tasks: PlanTask[] = [];
  try {
    const parsed = JSON.parse(gen.text.match(/\{[\s\S]*\}/)?.[0] ?? '{}') as { tasks?: unknown };
    tasks = coercePlanTasks(parsed.tasks);
  } catch {
    /* no structured plan → structural 0 */
  }
  const structural = structuralScore(tasks);
  const j = await judgeRubric(model, task.prompt, JSON.stringify(tasks, null, 2), ORCHESTRATION_RUBRIC);
  return { quality: 0.6 * structural + 0.4 * j.overall, costUsd: cand, latencyMs, judgeCostUsd: j.judgeCostUsd, tokensIn: gen.tokensIn, tokensOut: gen.tokensOut , truncated: gen.truncated };
}
