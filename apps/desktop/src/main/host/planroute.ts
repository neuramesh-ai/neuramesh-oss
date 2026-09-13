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
