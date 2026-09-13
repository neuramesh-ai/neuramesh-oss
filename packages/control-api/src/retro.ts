// Agent Retro aggregation (docs/13) — every number derives from the append-only
// events log, task lifecycle stamps, facts(kind='lesson'), and skills authorship.
// Events and facts are deliberately unsynced, so this runs server-side; the
// queries all ride existing indexes (events (workspace_id, ts) / (task_id, ts),
// tasks workspace scans). Levels are recomputed from cumulative history at the
// window edges on every call — nothing is stored (the honesty guarantee).
import { retroRows } from './retro-queries';
import type postgres from 'postgres';
import {
  levelOf,
  levelProgress,
  rateDeltaPoints,
  rateOrNull,
  retroWindow,
  xpOf,
  type RetroAgentStats,
  type RetroCurvePoint,
  type RetroHeadlineKind,
  type RetroPayload,
  type RetroRange,
  type XpCounts,
} from '@neuramesh/shared';

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

const HEADLINE_OF: Record<string, RetroHeadlineKind> = {
  developer: 'firstTry',
  worker: 'firstTry',
  reviewer: 'caught',
  architect: 'planFirstPass',
  orchestrator: 'routed',
};


export async function computeRetro(
  sql: postgres.Sql,
  workspaceId: string,
  range: RetroRange,
  dayStart: number,
): Promise<RetroPayload> {
  const w = retroWindow(range, dayStart);
  const [from, to] = [iso(w.from), iso(w.to)];
  const bucketCount = Math.ceil((w.to - w.from) / w.bucketMs);

  // the fifteen reads (retro-queries.ts) — this function keeps the shaping
  const { acceptedRows, agents, curveRows, firstTryRows, learnedRows, lessonList, lessonRows, orgLessons, orgRows, planRows, reviewRows, routedRows, skillRows, sparkAccepted, sparkReviews } =
    await retroRows({ sql, workspaceId, dayStart, w });
  // ── assemble
  const byId = <T extends { agent_id?: string; assignee_id?: string }>(rows: T[]) => {
    const m = new Map<string, T>();
    for (const r of rows) m.set((r.agent_id ?? r.assignee_id)!, r);
    return m;
  };
  const num = (v: string | number | null | undefined) => Number(v ?? 0);

  const accepted = byId(acceptedRows);
  const firstTry = byId(firstTryRows);
  const reviews = byId(reviewRows);
  const plans = byId(planRows);
  const routed = byId(routedRows);
  const lessons = byId(lessonRows);
  const learned = byId(learnedRows);
  const skills = byId(skillRows);

  const sparkOf = (agentId: string): number[] => {
    const spark = Array.from({ length: bucketCount }, () => 0);
    for (const rows of [sparkAccepted, sparkReviews]) {
      for (const r of rows) {
        if (r.agent_id !== agentId) continue;
        const i = Number(r.bucket);
        if (i >= 0 && i < bucketCount) spark[i]! += num(r.n);
      }
    }
    return spark;
  };

  const cumCounts = (id: string, edge: 'cum_end' | 'cum_start'): XpCounts => ({
    accepted: num(accepted.get(id)?.[edge]),
    reviews: num(reviews.get(id)?.[edge]),
    plansApproved: num(plans.get(id)?.[edge === 'cum_end' ? 'approved_cum_end' : 'approved_cum_start']),
    lessons: num(lessons.get(id)?.[edge]),
    skillsProposed: num(skills.get(id)?.[edge]),
  });

  let leveledUpCount = 0;
  const agentStats: RetroAgentStats[] = agents.map((a) => {
    const xpEnd = xpOf(cumCounts(a.id, 'cum_end'));
    const xpStart = xpOf(cumCounts(a.id, 'cum_start'));
    const level = levelOf(xpEnd);
    const leveledUp = level > levelOf(xpStart);
    if (leveledUp) leveledUpCount++;

    const kind = HEADLINE_OF[a.role] ?? 'firstTry';
    let n = 0;
    let d = 0;
    let nPrev = 0;
    let dPrev = 0;
    if (kind === 'firstTry') {
      const f = firstTry.get(a.id);
      n = num(f?.n_cur); d = num(f?.d_cur); nPrev = num(f?.n_prev); dPrev = num(f?.d_prev);
    } else if (kind === 'caught') {
      const r = reviews.get(a.id);
      n = num(r?.caught_cur); d = num(r?.cur); nPrev = num(r?.caught_prev); dPrev = num(r?.prev);
    } else if (kind === 'planFirstPass') {
      const p = plans.get(a.id);
      n = num(p?.['clean_cur']); d = num(p?.['approved_cur']); nPrev = num(p?.['clean_prev']); dPrev = num(p?.['approved_prev']);
    } else {
      const r = routed.get(a.id);
      n = num(r?.cur); d = num(r?.cur); nPrev = num(r?.prev); dPrev = num(r?.prev);
    }

    return {
      id: a.id,
      name: a.name,
      role: a.role,
      level,
      leveledUp,
      xp: xpEnd,
      progress: levelProgress(xpEnd),
      headline: {
        kind,
        n,
        d,
        rate: kind === 'routed' ? null : rateOrNull(n, d),
        deltaPoints: kind === 'routed' ? null : rateDeltaPoints({ n, d }, { n: nPrev, d: dPrev }),
      },
      counts: {
        accepted: num(accepted.get(a.id)?.cur),
        reviews: num(reviews.get(a.id)?.cur),
        plansApproved: num(plans.get(a.id)?.['approved_cur']),
        lessons: num(lessons.get(a.id)?.cur),
        skillsProposed: num(skills.get(a.id)?.cur),
      },
      spark: sparkOf(a.id),
      learned: learned.get(a.id)?.content ?? null,
    };
  });

  const org = orgRows[0];
  const curve: RetroCurvePoint[] = Array.from({ length: 8 }, (_, i) => {
    const row = curveRows.find((r) => Number(r.wk) === i);
    const d = num(row?.d);
    const n = num(row?.n);
    return {
      weekStart: iso(dayStart + DAY - 8 * 7 * DAY + i * 7 * DAY),
      n,
      d,
      rate: rateOrNull(n, d),
    };
  });

  return {
    range,
    from,
    to,
    org: {
      accepted: num(org?.cur),
      acceptedPrev: num(org?.prev),
      avgCycleMs: org?.cycle_cur == null ? null : Number(org.cycle_cur),
      prevAvgCycleMs: org?.cycle_prev == null ? null : Number(org.cycle_prev),
      lessons: num(orgLessons[0]?.n),
      leveledUp: leveledUpCount,
    },
    agents: agentStats,
    curve,
    lessons: lessonList.map((l) => ({
      content: l.content,
      taskNumber: l.task_number == null ? null : Number(l.task_number),
      learner: l.learner,
      at: new Date(l.created_at).toISOString(),
    })),
  };
}
