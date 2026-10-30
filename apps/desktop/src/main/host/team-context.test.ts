import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentHomeTranscript } from './team-context';
import type { TeamContext } from '@neuramesh/shared';
const context = (compact: boolean): TeamContext => ({ home: { id:'home',project_id:'project' } as TeamContext['home'], summary:'Keep the budget at $500.', revision:1,
  messages:[{ id:'old',body:'Open task #42; artifact plan.md.',author_kind:'human',author_id:'u',created_at:'' },{ id:'new',body:'Continue the plan.',author_kind:'human',author_id:'u',created_at:'' }], compactThrough:compact?'old':null });
test('compaction commits before replacing context, then uses the latest tail', async () => {
  let compacted=false;
  const result=await agentHomeTranscript({ read:async()=>context(!compacted), summarize:async(_s,input)=>{ assert.match(input,/\$500/);assert.match(input,/#42/);assert.doesNotMatch(input,/Continue the plan/);return 'Keep budget $500 and task #42.'; },compact:async(rev,id,summary)=>{assert.equal(rev,1);assert.equal(id,'old');assert.match(summary,/#42/);compacted=true;},status:()=>{} });
  assert.equal(compacted,true);assert.match(result!,/Continue the plan/);
});
test('failed summaries do not advance the cursor or claim success', async()=>{
  let writes=0;
  await assert.rejects(agentHomeTranscript({read:async()=>context(true),summarize:async()=>'',compact:async()=>{writes++;},status:()=>{}}),/could not be validated/);
  assert.equal(writes,0);
});
