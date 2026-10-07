// the person's word on a done unit (acceptword.ts). since 2026-10-05 every reply on a done unit wakes
// the orchestrator, which holds accept_task, so the gate reads the words: an instruction to merge or
// accept passes, and a question, a "not yet" or a card's click never does.
// run from packages/shared:
//   pnpm test acceptword
import { describe, expect, it } from 'vitest';
import { isAcceptWord, isCardOrMarker } from '../src/acceptword';

describe('the merge word', () => {
  it.each([
    'merge it',
    'Merge it.',
    'merge',
    'rex, merge it',
    '@rex merge it',
    'rex merge it',
    'please merge',
    'Looks good. Merge it.',
    'LGTM, ship it!',
    'Yes, merge it',
    'ok merge',
    'go ahead and merge it',
    'accept',
    'Accept it.',
    'I accept it.',
    'can you merge it?',
    'rex, could you please land it?',
    'you can merge it now',
    'Ship it 🚀',
    'merge it, thanks',
    'Great work, accept the task',
    'approve and merge',
    'MERGE IT',
  ])('passes: %s', (body) => {
    expect(isAcceptWord(body)).toBe(true);
  });

  it.each([
    'does this include the mobile fix?',
    'should we merge?',
    'can we merge tomorrow?',
    'Why did you merge it?',
    'don’t merge yet',
    'do not merge',
    'wait, I want to check one thing before we merge',
    'there is a merge conflict',
    'the merge failed on CI',
    'git merge says it is up to date',
    'not ready to ship',
    'hold off on the merge',
    'merge it later',
    'merge it if the copy is right',
    'I will merge it',
    'I’ll merge it',
    'thanks!',
    'LGTM',
    'approve',
    'merged?',
    '> Say merge in this thread to land the PR.',
    // a card's answer and a marker are a click and a record, never the person's word
    '**Approve #1064 — Merge the annual price toggle?** → Approve #1064',
    '**#1064 passed review — Ship the annual price toggle** → Request changes',
    '‹github:connected:acme/site›',
  ])('refuses: %s', (body) => {
    expect(isAcceptWord(body)).toBe(false);
  });
});

describe('what a client posts for the person', () => {
  it('is a card answer or a marker line, and a typed message is neither', () => {
    expect(isCardOrMarker('**Approve #12 — Fix the drawer?** → Approve #12')).toBe(true);
    expect(isCardOrMarker('**Add @plume to #marketing?** -> Add @plume')).toBe(true);
    expect(isCardOrMarker('‹gen-image:abc›')).toBe(true);
    expect(isCardOrMarker('merge it')).toBe(false);
    expect(isCardOrMarker('**merge it** please')).toBe(false);
  });
});
