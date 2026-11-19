import assert from 'node:assert/strict';
import test from 'node:test';
import { registerFollowupTarget, getFollowupTarget, withChatSteering } from './thread-followups';

test('steering waits for the previous provider to stop, carries its progress forward, and stays in the same thread', async () => {
  const thread='active', seen: string[]=[];
  let active=0, maxActive=0;
  const turn=withChatSteering(thread,'Prepare a pilot plan.',async (prompt, controller, progress) => {
    active++; maxActive=Math.max(active,maxActive); seen.push(prompt);
    try {
      if (seen.length>1) return 'revised plan';
      progress('The readme and source were inspected.');
      await new Promise<void>(resolve => controller.signal.addEventListener('abort', () => setTimeout(resolve, 10), {once:true}));
      throw controller.signal.reason;
    } finally { active--; }
  });
  assert.equal(getFollowupTarget('other'),undefined);
  assert.equal(await getFollowupTarget(thread)!.apply('Use COBALT instead.', 'm1', true, []),true);
  assert.equal(await turn,'revised plan');
  assert.equal(maxActive,1);
  assert.match(seen[1]!,/Prepare a pilot plan\.[\s\S]*readme and source[\s\S]*Use COBALT/);
  assert.equal(getFollowupTarget(thread),undefined);
});

test('closing one registration preserves the other active session and unregisters on failure', async () => {
  const thread='two sessions', target={busy:()=>false,apply:async()=>true};
  const close=registerFollowupTarget(thread,target);
  await assert.rejects(withChatSteering(thread,'test',async () => {throw new Error('provider unavailable');}),/provider unavailable/);
  assert.equal(getFollowupTarget(thread),target);
  close();
  assert.equal(getFollowupTarget(thread),undefined);
});
