import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import type { ChatToolCtx } from './chattools';
import { codingChatTools } from './chattools-coding';

test('cloud handoffs require a usable repository attached to the requesting project', async t => {
  const previous = process.env.NM_MACHINE_KIND;
  process.env.NM_MACHINE_KIND = 'runner';
  const db = new DatabaseSync(':memory:');
  t.after(() => {
    db.close();
    if (previous === undefined) delete process.env.NM_MACHINE_KIND;
    else process.env.NM_MACHINE_KIND = previous;
  });
  db.exec(`create table repos(id,workspace_id,clone_url,local_path);
    create table project_repos(project_id,repo_id);
    create table threads(id,workspace_id,project_id);
    insert into threads values('home','ws','project');
    insert into repos values('local','ws','','/missing-qa-workstation/checkout'),
      ('remote','ws','https://example.test/org/repo.git',null),
      ('other','ws','https://example.test/elsewhere/repo.git',null);
    insert into project_repos values('project','local'),('project','remote'),('elsewhere','other');`);
  const commands: unknown[] = [];
  const [create] = codingChatTools({
    z, tool, db: {getAll: async (sql: string, args: string[]) => db.prepare(sql).all(...args)},
    agent:{id:'parent',role:'orchestrator'},ch:{id:'channel',workspace_id:'ws'},threadId:'home',
    text:(text:string) => ({content:[{type:'text',text}]}),
    post: async (_path:string, _actor:unknown, command:unknown) => { commands.push(command); return Response.json({created:true}); },
  } as unknown as ChatToolCtx);
  const send = (repoId:string) => create!.handler({repoId,requestId:'request',taskId:undefined,taskNumber:undefined,prepareRelease:undefined,agentId:undefined,title:'Fix a bug',description:'Fix the bug.',kind:'bug',baseRef:'main',
    approach:'Repair the handler.',acceptance:['Tests pass'],roleContext:'You are a senior engineer.',references:[],validation:['npm test'],visualEvidence:false},{});
  await assert.rejects(send('local'), /no remote accessible/);
  await assert.rejects(send('other'), /attached to this project/);
  assert.equal(commands.length,0);
  await send('remote');
  assert.deepEqual((commands[0] as {repo:unknown}).repo,{id:'remote',baseRef:'main'});
});
