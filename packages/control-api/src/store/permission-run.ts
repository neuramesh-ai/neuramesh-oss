import type postgres from 'postgres';
import { createHash, randomUUID } from 'node:crypto';
import type { NMEvent, Actor } from '@neuramesh/shared';
import { DomainError } from '../errors';
import type { NMMessage } from '../store';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');

/** Called inside the winning schedule-claim transaction. A signed machine for
 * this workspace, or the member who owns the schedule, can attest its opener. */
export async function issueSchedulePermission(sql: postgres.Sql, schedule: string, slot: number, workspace: string, authority?: { machineWorkspace?: string; actor: Actor }): Promise<string | undefined> {
  if (!authority) return;
  if (authority.machineWorkspace && authority.machineWorkspace !== workspace) throw new DomainError('NOT_PERMITTED', 'This schedule belongs to another workspace.');
  if (!authority.machineWorkspace) {
    if (authority.actor.kind !== 'human') return;
    const [owner] = await sql`select 1 from schedules s join workspace_members m on m.workspace_id=s.workspace_id
      where s.id=${schedule} and m.user_id=${authority.actor.id} and s.created_by_kind='human'
        and s.created_by=m.user_id::text`;
    if (!owner) return;
  }
  const token = randomUUID();
  await sql`insert into permission_schedule_claims(schedule_id,slot,token_hash) values(${schedule},${slot},${digest(token)})`;
  return token;
}

/** Consume in the same transaction as the opener. It cannot be replayed into
 * another room, an unrelated home, or two independent agent turns. */
export async function bindSchedulePermission(sql: postgres.Sql, message: NMMessage): Promise<void> {
  if (!message.schedulePermission) return;
  const claimed = await sql`update permission_schedule_claims p set token_hash=null,message_id=${message.id}
    from schedules s,threads t where s.id=p.schedule_id and s.id=${message.scheduleId ?? null} and s.workspace_id=${message.workspace}
      and t.id=${message.threadId ?? null} and t.workspace_id=s.workspace_id and t.channel_id=${message.channel}
      and (s.owner_home_thread_id=t.id or (s.owner_home_thread_id is null and s.channel_id=t.channel_id and t.schedule_id=s.id))
      and p.expires_at>now() and p.token_hash=${digest(message.schedulePermission)} and p.message_id is null returning p.slot`;
  if (!claimed.length) throw new DomainError('NOT_PERMITTED', 'The automation slot does not authorize this thread.');
}

/** A running wake is tied to one authenticated machine, actor, exact message
 * and thread. A newer human request never borrows an earlier wake's authority. */
export async function scheduledWake(sql: postgres.Sql, workspace: string, thread: string, runId: string, agent: string, machineId?: string, memberId?:string) {
  if (!machineId && !memberId) return null;
  const [row] = await sql`select s.id as schedule,m.id as message from runs r
    join messages m on m.id=r.trigger_message_id and m.thread_id=r.thread_id and m.workspace_id=r.workspace_id
    join permission_schedule_claims p on p.message_id=m.id join schedules s on s.id=p.schedule_id and s.workspace_id=r.workspace_id
    where r.id=${runId} and r.workspace_id=${workspace} and r.thread_id=${thread} and r.agent_id=${agent}
      and (r.machine_id=${machineId ?? null} or (${memberId ?? null}::uuid is not null and s.created_by=${memberId ?? null}
        and exists(select 1 from machines m join workspace_members wm on wm.workspace_id=m.workspace_id and wm.user_id=m.owner_user_id
          where m.id=r.machine_id and m.workspace_id=r.workspace_id and m.owner_user_id=${memberId ?? null})))
      and r.state='running' and r.kind='wake'`;
  return row ? { schedule:String(row.schedule), message:String(row.message) } : null;
}

export async function claimSchedule(db:postgres.Sql, scheduleId:string,runCount:number,nextRunAt:string|null,makeEvent:(workspace:string)=>NMEvent,insertEvent:(sql:postgres.Sql,event:NMEvent)=>Promise<unknown>,authority?:{actor:Actor;machineWorkspace?:string}) {
    return db.begin(async (_tx) => {
      const sql = _tx as unknown as postgres.Sql;
      // the CAS: run_count is the claim token (counter, not timestamp — the ship-stage
      // lesson), so two daemons racing the same due row get exactly one winner.
      const [row] = await sql`update schedules
        set run_count = run_count + 1, next_run_at = ${nextRunAt}, last_run_at = now(),
            status = case when ${nextRunAt}::timestamptz is null then 'done' else status end
        where id = ${scheduleId}::uuid and run_count = ${runCount} and status = 'active'
        returning workspace_id`;
      if (!row) {
        const [exists] = await sql`select 1 from schedules where id = ${scheduleId}::uuid`;
        if (!exists) throw new DomainError('NOT_FOUND', 'schedule not found');
        return { claimed: false };
      }
      await insertEvent(sql, makeEvent(row['workspace_id'] as string));
      const schedulePermission = await issueSchedulePermission(sql, scheduleId, runCount, String(row['workspace_id']), authority);
      return { claimed: true, ...(schedulePermission ? { schedulePermission } : {}) };
    });
}
