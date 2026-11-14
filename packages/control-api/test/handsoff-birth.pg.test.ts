import { createHash, randomUUID } from 'node:crypto';
// The hands-off BIRTH stamp against the REAL schema (marketing-os round 3, found live):
// pgstore's task insert silently dropped plan_approved_at, so every "born approved" unit
// (routine- or playbook-born) was actually born GATED on postgres and parked at plan_review —
// while the memory store, which persists the whole object, kept the tests green. The pg row
// is the only truth that catches this class. Run via scripts/test-pg.sh — skipped without
// DATABASE_URL.
import type { Actor } from '@neuramesh/shared';
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { PostgresStore } from '../src/pgstore';

const DB = process.env['DATABASE_URL'];
const WS = 'a0000000-0000-0000-0000-00000000000a';

const rex: Actor = { kind: 'agent', id: '20000000-0000-0000-0000-000000000002', role: 'orchestrator' };

const store = DB ? new PostgresStore(DB) : null;
const app = store ? createApp(store) : null;
const sql = DB ? postgres(DB) : null;
const j = (r: Response): Promise<any> => r.json() as Promise<any>;

function send(actor: Actor, body: unknown, bearer?: string) {
  const input=body as Record<string,unknown>,thread=input.originThread??input.threadId;
  return app!.request('/v1/commands', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor), ...(bearer ? {authorization:'Bearer '+bearer,'x-nm-agent-scopes':'1'} : {}),...(actor.kind==='agent'&&typeof thread==='string'?{'x-nm-agent-context':JSON.stringify({workspace:WS,subject:{kind:'thread',id:thread}})}:{}) },
    body: JSON.stringify(body),
  });
}

afterAll(async () => {
  await sql?.end();
  await store?.close();
});

describe.skipIf(!DB)('hands-off birth persists on postgres', () => {
  it('a playbook unit is born with plan_approved_at SET in the pg row itself', async () => {
    const r = await j(await send(rex, {
      type: 'task.create', workspace: WS, channel: 'dev',
      title: 'pg playbook birth '+randomUUID(), description: 'x', kind: 'research',
      plan: { legs: ['build'], subtasks: [], approach: 'Study the site and deliver the scored report with fixes written out, honest about gaps.' },
      playbook: 'audit',
    }));
    expect(r.task?.planApprovedAt).toBeTruthy();
    const [row] = await sql!`select plan_approved_at, requirements_confirmed from tasks where id = ${r.task.id}`;
    expect(row!['plan_approved_at']).toBeTruthy();
    expect(row!['requirements_confirmed']).toBe(true);
  });

  // ROUTINE OR CONTENT (George, 2026-09-27, "Guard the routine rules"): the rule is SQL on this store
  // (store/routine-rule.ts), so only postgres proves the join and the jsonb test.
  it('verified routine and content runs approve implementation; replies in either session keep the human gate', async () => {
    const scheduler: Actor = {kind:'human', id:randomUUID()};
    await sql!`insert into nm_users(id,clerk_user_id) values(${scheduler.id},${randomUUID()})`;
    await sql!`insert into workspace_members(workspace_id,user_id,role) values(${WS},${scheduler.id},'member')`;
    const room = crypto.randomUUID();
    await sql!`insert into channels (id, workspace_id, slug, topic, kind, project_id)
      select ${room}::uuid, workspace_id, ${`drafts-${room.slice(0, 8)}`}, '', 'marketing', project_id from channels where id = 'c0000000-0000-0000-0000-00000000000b'::uuid`;
    const token = 'nmm_' + randomUUID();
    const [host] = await sql!`insert into machines(workspace_id,owner_user_id,name,platform,kind,token_hash,last_seen_at)
      values(${WS},${scheduler.id},${'schedule-test-'+room},'linux','member',${createHash('sha256').update(token).digest('hex')},null) returning id`;
    const [worker] = await sql!`insert into agents(workspace_id,machine_id,name,role)
      values(${WS},${host!.id},${'schedule-agent-'+room},'orchestrator') returning id`;
    await sql!`insert into agent_channels(agent_id,channel_id) values(${worker!.id},${room}) on conflict do nothing`;
    const caller: Actor = {kind:'agent',id:worker!.id,role:'orchestrator'};
    // The owner explicitly grants both routine principals access to Marketing.
    await sql!`insert into workspace_destination_members(workspace_id,destination,principal_kind,principal_id,added_by) values(${WS},'marketing','human',${scheduler.id},'00000000-0000-0000-0000-000000000001'),(${WS},'marketing','agent',${caller.id},'00000000-0000-0000-0000-000000000001')`;
    const session = async (payload: Record<string, unknown>) => {
      const scheduleId = crypto.randomUUID();
      await sql!`insert into schedules (id, workspace_id, channel_id, title, cadence, at_time, tz, next_run_at, payload, created_by_kind, created_by)
        values (${scheduleId}::uuid, ${WS}::uuid, ${room}::uuid, 'X audit', 'weekdays', '09:00', 'UTC', now(), ${sql!.json(payload as never)}, 'human', ${scheduler.id})`;
      const threadId = crypto.randomUUID();
      const claim = await j(await send(scheduler,{type:'schedule.claim_run',schedule:scheduleId,runCount:0,nextRunAt:null},token));
      expect(claim.schedulePermission).toBeTruthy();
      const message = randomUUID(), runId = randomUUID();
      const opener = await app!.request('/v1/messages', {method:'POST',
        headers:{'content-type':'application/json','x-nm-actor':JSON.stringify(scheduler),authorization:'Bearer '+token,'x-nm-agent-scopes':'1'},
        body:JSON.stringify({id:message,workspace:WS,channel:room,threadId,scheduleId,schedulePermission:claim.schedulePermission,body:'Audit the account.'})});
      expect(opener.status).toBe(200);
      const wake = await send(caller,{type:'run.open',id:runId,workspace:WS,channel:room,threadId,kind:'wake',title:'Audit the account',total:0,triggerMessageId:message,machineId:host!.id},token);
      expect(wake.status).toBe(200);
      return { scheduleId, threadId, runId };
    };
    const routine = await session({ prompt: 'x', routine: true });
    const draft = await session({ prompt: 'x' });
    const stringy = await session({ prompt: 'x', routine: 'true' });
    expect(await store!.getThreadRoutineId(WS, routine.threadId)).toBe(routine.scheduleId);
    expect(await store!.getThreadRoutineId(WS, draft.threadId)).toBeNull();
    expect(await store!.getThreadRoutineId(WS, stringy.threadId)).toBeNull(); // only a boolean marks a routine
    const plan = { legs: ['build'], subtasks: [], approach: 'Audit the account and report what the numbers say, with the next three moves written out.' };
    // two titles: an agent's second open task with one title in one room is a DUPLICATE_TASK
    for (const home of [routine,draft]) {
      const birth = async (fromSchedule: boolean) => {
        const response = await send(caller,{type:'task.create',workspace:WS,channel:room,title:'Audit '+randomUUID(),
          description:'Run the site audit',kind:'research',plan,originThread:home.threadId,...(fromSchedule ? {permissionRunId:home.runId} : {})},token);
        expect(response.status).toBe(200);
        const {task} = await j(response);
        const [row] = await sql!`select plan_approved_at from tasks where id=${task.id}`;
        return row!.plan_approved_at;
      };
      expect(await birth(true)).toBeTruthy();
      expect(await birth(false)).toBeNull();
    }
  });

  it('an ordinary planned unit still persists a NULL stamp — the gate is real', async () => {
    const r = await j(await send(rex, {
      type: 'task.create', workspace: WS, channel: 'dev',
      title: 'pg gated birth '+randomUUID(), description: 'x', kind: 'research',
      plan: { legs: ['build', 'review'], subtasks: [], approach: 'A plan a human must read before anything runs, because nothing selected it but the agent.' },
    }));
    expect(r.task?.planApprovedAt).toBeNull();
    const [row] = await sql!`select plan_approved_at from tasks where id = ${r.task.id}`;
    expect(row!['plan_approved_at']).toBeNull();
  });
});
