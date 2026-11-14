import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import postgres from 'postgres';
import {describe,it,expect} from 'vitest';
import {agentAuthorization} from '../src/agent-replica-scope';
import {authorization} from '../src/local-sync-scope';
const url=process.env.NM_DESTINATION_TEST_DATABASE_URL??process.env.DATABASE_URL;
// Explicit opt-in; every mutation, including roles, is rolled back. Never production.
if(url&&!['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname))throw new Error('Destination tests require loopback Postgres.');
describe.skipIf(!url)('agent destination authorization on Postgres',()=>{
 it('binds private data to the conversation, both principals and current grants',async()=>{
  const sql=postgres(url!,{max:1}),rollback=new Error('rollback');
  try{try{await sql.begin(async tx=>{
   const owner=randomUUID(),member=randomUUID(),workspace=randomUUID(),machine=randomUUID(),agent=randomUUID(),project=randomUUID();
   await tx`insert into nm_users(id,email) values(${owner},'owner@destination.test'),(${member},'member@destination.test')`;
   await tx`insert into workspaces(id,name,slug,created_by) values(${workspace},'Destination test',${'dest-'+workspace},${owner})`;
   await tx`insert into workspace_members(workspace_id,user_id,role) values(${workspace},${owner},'owner'),(${workspace},${member},'member')`;
   await tx`insert into projects(id,workspace_id,name,slug) values(${project},${workspace},'Test','test')`;
   await tx`insert into machines(id,workspace_id,owner_user_id,name) values(${machine},${workspace},${owner},'Test')`;
   await tx`insert into agents(id,workspace_id,machine_id,name) values(${agent},${workspace},${machine},'reader')`;
   const subjects=[];
   for(const kind of ['build','marketing']){
    const [channel]=await tx`insert into channels(workspace_id,project_id,slug,kind) values(${workspace},${project},${kind},${kind}) returning id`;
    const [thread]=await tx`insert into threads(workspace_id,project_id,channel_id,title,created_by) values(${workspace},${project},${channel!.id},'Test',${owner}) returning id`;
    subjects.push({kind:'thread' as const,id:String(thread!.id)});
   }
   const actor={kind:'scoped-agent' as const,id:agent,workspaceId:workspace};
   expect((await agentAuthorization(tx,{...actor,subject:subjects[0]})).workspaces).toEqual([workspace]);
   expect((await agentAuthorization(tx,{...actor,subject:subjects[1]})).workspaces).toEqual([]);
   await tx`insert into workspace_destination_members(workspace_id,destination,principal_kind,principal_id,added_by) values(${workspace},'marketing','agent',${agent},${owner})`;
   const privateRead=await agentAuthorization(tx,{...actor,subject:subjects[1]});expect(privateRead.marketing).toEqual([workspace]);
   expect((await agentAuthorization(tx,{...actor,subject:subjects[0]})).marketing).toEqual([]);
   expect((await agentAuthorization(tx,{...actor,subject:subjects[1],callerId:member})).workspaces).toEqual([]);
   await tx`insert into workspace_destination_members(workspace_id,destination,principal_kind,principal_id,added_by) values(${workspace},'marketing','human',${member},${owner})`;
   expect((await agentAuthorization(tx,{...actor,subject:subjects[1],callerId:member})).marketing).toEqual([workspace]);
   expect((await authorization(tx,{kind:'machine',id:machine,workspaceId:workspace})).marketing).toEqual([]);
   expect((await authorization(tx,{kind:'machine',id:machine,workspaceId:workspace,agentScopes:true})).marketing).toEqual([workspace]);
   await tx`delete from workspace_destination_members where workspace_id=${workspace} and principal_id=${agent}`;
   const revoked=await agentAuthorization(tx,{...actor,subject:subjects[1]});expect(revoked.workspaces).toEqual([]);expect(revoked.scope).not.toBe(privateRead.scope);
   throw rollback;
  });}catch(e){if(e!==rollback)throw e;}}finally{await sql.end();}
 });
 it('removes legacy table-wide project SELECT while preserving safe columns',async()=>{
  const sql=postgres(url!,{max:1}),rollback=new Error('rollback');
  try{try{await sql.begin(async tx=>{
   // Exercise the exact conditional privilege block, even on local stacks without these roles.
   if((await tx`select 1 from pg_roles where rolname='authenticated'`).length)throw new Error('Use a local stack without an authenticated role for this isolated privilege-branch test.');
   await tx.unsafe('create role authenticated nologin; grant select on projects to authenticated');
   const migration=readFileSync(new URL('../../../supabase/migrations/0183_destination_read_boundaries.sql',import.meta.url),'utf8');
   const section=migration.slice(migration.indexOf('  select string_agg'),migration.indexOf('\nend $$;',migration.indexOf('  select string_agg')));
   await tx.unsafe('do $$ declare safe_columns text; role_name text; begin\n'+section+'\nend $$;');
   const [privilege]=await tx`select has_column_privilege('authenticated','projects','brand_profile','select') as brand,has_column_privilege('authenticated','projects','name','select') as name`;
   expect(privilege).toMatchObject({brand:false,name:true});throw rollback;
  });}catch(e){if(e!==rollback)throw e;}}finally{await sql.end();}
 });
 it('keeps private backend reads working without weakening direct-client destination access',async()=>{
  const sql=postgres(url!,{max:1,onnotice(){}}),rollback=new Error('rollback');
  try{try{await sql.begin(async tx=>{
   const owner=randomUUID(),member=randomUUID(),outsider=randomUUID(),workspace=randomUUID(),project=randomUUID();
   await tx.unsafe("do $$ begin if not exists(select from pg_roles where rolname='nm_runtime') then create role nm_runtime nologin; end if; if not exists(select from pg_roles where rolname='authenticated') then create role authenticated nologin; end if; if not exists(select from pg_roles where rolname='anon') then create role anon nologin; end if; end $$;");
   await tx.unsafe('create role nm_finance_backend_test nologin inherit; grant nm_runtime to nm_finance_backend_test');
   await tx.unsafe('grant usage on schema public,auth to nm_runtime,authenticated,anon; grant execute on function auth.uid() to nm_runtime,authenticated,anon; grant select on channels,threads to nm_runtime,authenticated,anon');
   // Match the existing private backend policy, with a non-admin member role as
   // production nm_api uses. The test never grants BYPASSRLS or table ownership.
   for(const tab of ['channels','threads'])await tx.unsafe(`drop policy if exists nm_control_api on ${tab}; create policy nm_control_api on ${tab} to nm_runtime using(true) with check(true)`);
   await tx`insert into nm_users(id,email) values(${owner},'rls-owner@qa.invalid'),(${member},'rls-member@qa.invalid'),(${outsider},'rls-outsider@qa.invalid')`;
   await tx`insert into workspaces(id,name,slug,created_by) values(${workspace},'Backend RLS test',${'backend-'+workspace},${owner})`;
   await tx`insert into workspace_members(workspace_id,user_id,role) values(${workspace},${owner},'owner'),(${workspace},${member},'member')`;
   await tx`insert into projects(id,workspace_id,name,slug) values(${project},${workspace},'RLS test','rls')`;
   const rows:Record<string,{channel:string;thread:string}>={};
   for(const kind of ['build','marketing']){
    const [channel]=await tx`insert into channels(workspace_id,project_id,slug,kind) values(${workspace},${project},${kind},${kind}) returning id`;
    const [thread]=await tx`insert into threads(workspace_id,project_id,channel_id,title,created_by) values(${workspace},${project},${channel!.id},'Synthetic RLS test',${owner}) returning id`;
    rows[kind]={channel:String(channel!.id),thread:String(thread!.id)};
   }
   const visible=async()=>({channels:(await tx`select id from channels where workspace_id=${workspace}`).map(r=>String(r.id)).sort(),threads:(await tx`select id from threads where workspace_id=${workspace}`).map(r=>String(r.id)).sort()});
   const all={channels:Object.values(rows).map(r=>r.channel).sort(),threads:Object.values(rows).map(r=>r.thread).sort()};
   const buildOnly={channels:[rows.build!.channel],threads:[rows.build!.thread]};
   const policies=await tx`select qual from pg_policies where schemaname='public' and policyname='destination_restricted_read'`;
   expect(policies).toHaveLength(17);
   expect(policies.every(p=>String(p.qual).includes('pg_has_role'))).toBe(true);
   await tx.unsafe('set local role nm_finance_backend_test');
   expect((await tx`select auth.uid() caller`)[0]!.caller).toBeNull();
   expect((await tx`select rolsuper,rolbypassrls,rolcreatedb,rolcreaterole from pg_roles where rolname=current_user`)[0]).toMatchObject({rolsuper:false,rolbypassrls:false,rolcreatedb:false,rolcreaterole:false});
   expect(await visible()).toEqual(all);
   await tx.unsafe('reset role; set local role authenticated');
   await tx`select set_config('request.jwt.claim.sub',${owner},true)`;
   expect(await visible()).toEqual(all);
   await tx`select set_config('request.jwt.claim.sub',${member},true)`;
   await tx`select set_config('request.jwt.claim.role','nm_runtime',true)`;
   expect(await visible()).toEqual(buildOnly);
   expect((await tx`select pg_has_role(current_user,to_regrole('nm_runtime'),'member') backend`)[0]!.backend).toBe(false);
   expect((await tx`select has_table_privilege(current_user,'workspace_finance_model_jobs','select') private_read`)[0]!.private_read).toBe(false);
   await tx.unsafe('reset role');
   await tx`insert into workspace_destination_members(workspace_id,destination,principal_kind,principal_id,added_by) values(${workspace},'marketing','human',${member},${owner})`;
   await tx.unsafe('set local role authenticated');
   expect(await visible()).toEqual(all);
   await tx.unsafe('reset role');
   await tx`delete from workspace_destination_members where workspace_id=${workspace} and destination='marketing' and principal_id=${member}`;
   await tx.unsafe('set local role authenticated');
   expect(await visible()).toEqual(buildOnly);
   await tx`select set_config('request.jwt.claim.sub',${outsider},true)`;
   expect(await visible()).toEqual({channels:[],threads:[]});
   await tx.unsafe('reset role; set local role anon');
   await tx`select set_config('request.jwt.claim.sub','',true)`;
   expect(await visible()).toEqual({channels:[],threads:[]});
   await tx.unsafe('reset role; set local role nm_finance_backend_test');
   expect(await visible()).toEqual(all);
   await tx.unsafe('reset role');
   throw rollback;
  });}catch(e){if(e!==rollback)throw e;}}finally{await sql.end();}
 });
});
