import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { createCloudMachine } from '../src/fleet';
import { bootMachine } from '../src/fleet-cloudrun-boot';
import { applyMachineStatus } from '../src/fleet-cloudrun';
import { machineIntent } from '../src/fleet-lifecycle';
import { mintMachineToken } from '../src/machine-auth';
import { PostgresStore } from '../src/pgstore';
const DB=process.env.DATABASE_URL;
const sql=DB?postgres(DB):null, store=DB?new PostgresStore(DB):null;
const app=store?createApp(store):null;
const workspace=randomUUID(), owner='00000000-0000-0000-0000-000000000001';
const before='2026-01-01T00:00:00.000Z';
let machine='', credential='';
const row=async()=> (await sql!`select last_seen_at,interactive_ready,boot_streak from machines where id=${machine}::uuid`)[0]!;
beforeAll(async()=>{
 if(!sql)return;
 await sql`insert into workspaces(id,name,slug,created_by,plan) values(${workspace}::uuid,'Readiness fixture',${'ready-'+workspace},${owner}::uuid,'cloud')`;
 await sql`insert into workspace_members(workspace_id,user_id,role) values(${workspace}::uuid,${owner}::uuid,'owner')`;
 machine=(await createCloudMachine(sql,{workspaceId:workspace,kind:'member',ownerUserId:owner,name:'Readiness fixture',tokenHash:mintMachineToken().hash,substrate:'cloudrun'})).id;
 // A known old liveness stamp, independent of wall-clock timing.
 await sql`update machines set last_seen_at=${before}::timestamptz where id=${machine}::uuid`;
 const { mintBootCredential }=await import('../src/fleet-cloudrun-boot');
 credential=(await mintBootCredential(sql,machine))!.credential;
});
afterAll(async()=>{if(sql&&machine){await sql`update machines set lifecycle='destroyed',desired_replicas=0 where id=${machine}::uuid`;await sql`insert into agents(workspace_id,name,retired_at) values(${workspace}::uuid,'readiness-fixture-completed',now())`;}await sql?.end();await store?.close();});
describe.skipIf(!DB)('explicit interactive readiness on the real schema',()=>{
 it('boot and running-but-unregistered reports do not create a ready heartbeat',async()=>{
  const response=await app!.request('/v1/machines/boot',{method:'POST',headers:{authorization:`Bearer ${credential}`,'content-type':'application/json'},body:JSON.stringify({readinessProtocol:1})});
  expect(response.status).toBe(200);const grant=await response.json() as {epoch:number};
  expect((await row()).interactive_ready).toBe(false);
  expect(new Date((await row()).last_seen_at).toISOString()).toBe(before);
  await applyMachineStatus(sql!,machine,{state:'running',epoch:grant.epoch,interactiveReady:false});
  expect(new Date((await row()).last_seen_at).toISOString()).toBe(before);
  expect((await row()).boot_streak).toBeGreaterThan(0);
  expect((await machineIntent(sql!,workspace))[0]?.interactiveReady).toBe(false);
  await applyMachineStatus(sql!,machine,{state:'running',epoch:grant.epoch,interactiveReady:true});
  expect((await row()).interactive_ready).toBe(true);expect(new Date((await row()).last_seen_at).getTime()).toBeGreaterThan(Date.parse(before));
  expect((await row()).boot_streak).toBe(0);
  await applyMachineStatus(sql!,machine,{state:'running',epoch:grant.epoch,interactiveReady:false});
  expect((await row()).interactive_ready).toBe(false);
 });
 it('an older daemon can still boot and report without the new field',async()=>{
  const grant=await bootMachine(sql!,credential);expect(grant&&'epoch' in grant).toBe(true);
  if(!grant||!('epoch' in grant))throw Error('No boot grant');
  expect((await row()).interactive_ready).toBe(null);
  await applyMachineStatus(sql!,machine,{state:'booting',epoch:grant.epoch});expect((await row()).interactive_ready).toBe(null);
  await applyMachineStatus(sql!,machine,{state:'running',epoch:grant.epoch});expect((await row()).boot_streak).toBe(0);
 });
 it('an incompatible rollback cannot advance the epoch or replace a manifest-backed machine',async()=>{
  await sql!`update machines set snapshot_work='manifest-e2' where id=${machine}::uuid`;
  const [before]=await sql!`select epoch,token_hash from machines where id=${machine}::uuid`;
  const refused=await app!.request('/v1/machines/boot',{method:'POST',headers:{authorization:`Bearer ${credential}`,'content-type':'application/json'},body:'{}'});
  expect(refused.status).toBe(409);expect(await refused.json()).toMatchObject({code:'SNAPSHOT_READER_REQUIRED'});
  const [after]=await sql!`select epoch,token_hash from machines where id=${machine}::uuid`;expect(after).toEqual(before);
  const compatible=await app!.request('/v1/machines/boot',{method:'POST',headers:{authorization:`Bearer ${credential}`,'content-type':'application/json'},body:JSON.stringify({readinessProtocol:1,snapshotFormats:['nm-lazy-work-v1']})});
  expect(compatible.status).toBe(200);
 });

});
