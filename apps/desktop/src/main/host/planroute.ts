// PLAN-FIRST DESIGN ROUTING (2026-08-17) — extracted host service (the agents.ts ratchet).
//
// An APPROVED work plan whose declared journey leads with a design leg routes itself to the
// channel designer — mechanically, no LLM turn. The human's approve_plan is the trigger (a
// tasks-column change, so it fires the watch); the server's PLAN_NOT_APPROVED gate keeps a
// premature fire harmless, and the FSM stays the law: a refused/raced command clears the
// one-shot guard so the next row change retries. Build-first units never come here — the claim
// watch in agents.ts handles them (and both it and the server refuse to skip a design leg).
import type { HostCtx } from './ctx';

interface WatchDb {
  watch: (
    sql: string,
    params: unknown[],
    handlers: { onResult: (r: { rows?: { _array?: unknown[] } }) => void; onError: (e: unknown) => void },
  ) => void;
  getAll: <T>(sql: string, params?: unknown[]) => Promise<T[]>;
}

export function startPlanRouteWatch(ctx: { db: WatchDb; post: HostCtx['post']; workspace: string }): void {
  const { db, post, workspace } = ctx;
  const routed = new Set<string>();
  db.watch(
    // the designer-presence EXISTS is not an optimization — naming agent_channels/agents in
    // the query makes STAFFING changes refire this watch. Found live (2026-08-17): an approved
    // design-first unit in a designer-less room parked forever, because adding the designer
    // later changed no tasks row and nothing retriggered.
    `select t.id, t.number, t.channel_id, t.kind from tasks t
      where t.workspace_id = ? and t.state = 'plan_review' and t.plan_approved_at is not null
        and t.parent_task_id is null and t.assignee_id is null
        and instr(coalesce(t.work_plan, ''), '"design"') > 0
        and exists (select 1 from agent_channels ac join agents a on a.id = ac.agent_id
                     where ac.channel_id = t.channel_id and a.role = 'designer' and a.retired_at is null)`,
    [workspace],
    {
      onResult: (r) => {
        for (const t of (r.rows?._array ?? []) as Array<{ id: string; number: number; channel_id: string; kind: string | null }>) {
          if (routed.has(t.id)) continue;
          routed.add(t.id);
          void (async () => {
            const [orch] = await db.getAll<{ id: string }>(
              `select a.id from agents a join agent_channels ac on ac.agent_id = a.id
                where ac.channel_id = ? and a.role = 'orchestrator' and a.retired_at is null order by a.name limit 1`,
              [t.channel_id],
            );
            const [des] = await db.getAll<{ id: string; name: string }>(
              `select a.id, a.name from agents a join agent_channels ac on ac.agent_id = a.id
                where ac.channel_id = ? and a.role = 'designer' and a.retired_at is null order by a.name limit 1`,
              [t.channel_id],
            );
            // unstaffed — the journey bar shows the dashed gap; staffing fixes it, the next change retries
            if (!orch || !des) { routed.delete(t.id); return; }
            const res = await post('/v1/commands', { kind: 'agent', id: orch.id, role: 'orchestrator' }, {
              type: 'task.request_design', taskId: t.id, designer: des.id, ...(t.kind ? {} : { kind: 'feature' }),
            });
            if (!res.ok) routed.delete(t.id);
          })().catch(() => routed.delete(t.id));
        }
      },
      onError: () => {},
    },
  );
}

/**
 * THE BUILD OFFER AFTER A HANDS-OFF DESIGN ROUND (2026-09-16). A routine-anchored plan-first unit
 * whose design round the server auto-approved (planfollowup.ts) returns to `todo` with its plan
 * approved and nobody to offer it: a human's round wakes the orchestrator with their approval
 * click, a routine's cannot. Mechanical, like the design routing above — the room's worker is
 * offered exactly as an approved plan is (offerPlanToWorker). Routine-scoped on purpose: the human
 * path keeps the orchestrator's judgment about WHO builds. `artifacts.promoted` is the proof the
 * round was approved (the approve promotes it in the same transaction), and the repo floor rides
 * in the query — a repo-backed round is a human's to approve, so it never lands here.
 */
export function startRoutineBuildWatch(ctx: {
  db: WatchDb;
  workspace: string;
  agents: Map<string, { id: string; role: string; channels: Set<string> }>;
  offerPlanToWorker: (orch: never, t: never, ch: { id: string; slug: string; workspace_id: string }) => Promise<void>;
}): void {
  const { db, workspace, agents, offerPlanToWorker } = ctx;
  const offered = new Set<string>();
  db.watch(
    `select t.id, t.number, t.title, t.description, t.channel_id, t.requirements from tasks t
      where t.workspace_id = ? and t.state = 'todo' and t.plan_approved_at is not null
        and t.offered_agent_id is null and t.assignee_id is null and t.parent_task_id is null and t.repo_id is null
        and instr(coalesce(t.work_plan, ''), '"design"') > 0
        and exists (select 1 from threads th where th.id = t.origin_thread_id and th.schedule_id is not null)
        and exists (select 1 from artifacts a where a.task_id = t.id and a.kind = 'design' and a.promoted = 1)`,
    [workspace],
    {
      onResult: (r) => {
        for (const t of (r.rows?._array ?? []) as Array<{ id: string; number: number; title: string; description: string | null; channel_id: string; requirements: string | null }>) {
          if (offered.has(t.id)) continue;
          const orch = [...agents.values()].find((a) => a.role === 'orchestrator' && a.channels.has(t.channel_id));
          if (!orch) continue; // not this host's room — the host with the orchestrator offers
          offered.add(t.id);
          void (async () => {
            const [ch] = await db.getAll<{ id: string; slug: string; workspace_id: string }>('select id, slug, workspace_id from channels where id = ?', [t.channel_id]);
            if (!ch) { offered.delete(t.id); return; }
            await offerPlanToWorker(orch as never, t as never, ch);
            console.log(`routine_build_offer task=${t.number} — the design round auto-approved, the build offered`);
          })().catch((err) => { offered.delete(t.id); console.error(`routine_build_offer #${t.number} failed:`, err); });
        }
      },
      onError: () => {},
    },
  );
}
