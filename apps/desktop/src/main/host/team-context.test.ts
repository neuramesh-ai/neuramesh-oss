import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentHomeTranscript } from './team-context';
import type { TeamContext } from '@neuramesh/shared';
const context = (compact: boolean): TeamContext => ({ home: { id:'home',project_id:'project' } as TeamContext['home'], summary:'Keep the budget at $500.', revision:1,
  messages:[{ id:'old',body:'Open task #42; artifact plan.md.',author_kind:'human',author_id:'u',created_at:'' },{ id:'new',body:'Continue the plan.',author_kind:'human',author_id:'u',created_at:'' }], compactThrough:compact?'old':null });
test('compaction commits before replacing context, then uses the latest tail', async () => {
  let compacted=false;
  const result=await agentHomeTranscript({ read:async()=>context(!compacted), summarize:async(_s,input)=>{ assert.match(input,/\$500/);assert.match(input,/#42/);assert.doesNotMatch(input,/Continue the plan/);return 'Keep budget $500 and task #42.'; },compact:async(rev,id,summary)=>{assert.equal(rev,1);assert.equal(id,'old');assert.match(summary,/#42/);compacted=true;},status:()=>{} }, true);
  assert.equal(compacted,true);assert.match(result!,/Continue the plan/);
});
test('failed summaries do not advance the cursor or claim success', async()=>{
  let writes=0;
  await assert.rejects(agentHomeTranscript({read:async()=>context(true),summarize:async()=>'',compact:async()=>{writes++;},status:()=>{}}, true),/could not be validated/);
  assert.equal(writes,0);
});

test('an oversized summary gets one condensation attempt before the cursor moves', async () => {
  let saved = false;
  let calls = 0;
  await agentHomeTranscript({
    read: async () => context(!saved), status: () => {},
    summarize: async (_system, input) => {
      if (++calls === 1) return 'x'.repeat(17000);
      assert.match(input, /Condense this draft/);
      return 'Keep task #42 and the agreed budget.';
    },
    compact: async (_rev, _through, summary) => { assert.match(summary, /#42/); saved = true; },
  }, true);
  assert.equal(calls, 2);
  assert.ok(saved);
});

test('progress identifies each real segment and only announces saving after generation', async () => {
  const stages: string[] = [];
  let saved = false;
  const initial = context(true);
  initial.messages[0]!.body = 'x'.repeat(65000);
  await agentHomeTranscript({
    read: async () => saved ? context(false) : initial,
    status: text => stages.push(text),
    summarize: async () => { stages.push('provider'); return 'Working summary'; },
    compact: async () => { stages.push('commit'); saved = true; },
  }, true);
  assert.equal(stages.length, 6);
  assert.match(stages[0]!, /1 of 2/);
  assert.match(stages[2]!, /2 of 2/);
  assert.match(stages[4]!, /Saving/);
  assert.deepEqual([stages[1], stages[3], stages[5]], ['provider', 'provider', 'commit']);
});

test('a normal turn restores the saved summary and latest request even if an older server offers compaction', async () => {
  const result = await agentHomeTranscript({
    read: async () => context(true), status: () => assert.fail('unexpected compaction progress'),
    summarize: async () => assert.fail('unexpected summary call'),
    compact: async () => assert.fail('unexpected snapshot'),
  }, false);
  assert.match(result!, /Keep the budget at \$500/);
  assert.match(result!, /Continue the plan/);
});
