import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { teamChatTools } from './chattools-team';
import type { ChatToolCtx } from './chattools';
const source='11111111-1111-4111-8111-111111111111', target='22222222-2222-4222-8222-222222222222';
test('team tools decode HTTP responses and scope history to the requesting home', async () => {
  const reads:string[]=[];
  const tools=teamChatTools({z,tool,text:(text:string)=>({content:[{type:'text',text}]}),agent:{id:'rex',role:'orchestrator'},ch:{workspace_id:'ws'},threadId:source,
    apiGet:async(path:string)=>{reads.push(path);return Response.json(path.startsWith('/v1/team/context')?{home:{project_id:'project'}}:path.startsWith('/v1/team/history')?{messages:[{body:'A real saved message'}]}:{homes:[{id:target,title:'Iris'}]});}
  } as unknown as ChatToolCtx);
  const listed=await tools[0].handler({},{});
  assert.match(JSON.stringify(listed),/Iris/);
  const history=await tools[1].handler({threadId:target,before:undefined},{});
  assert.match(JSON.stringify(history),/real saved message/);
  assert.ok(reads.some(path=>path.includes(`sourceThreadId=${source}`)));
  await assert.rejects(tools[1].handler({threadId:source,before:undefined},{}),/this project/);
});
