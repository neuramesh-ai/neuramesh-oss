// The house-style sentinel (docs/design/agent-comm-rules-2026-08) — the selector-audit
// lesson applied to prompts: this test ENUMERATES every system-prompt composer, plants a
// sentinel custom rule, and asserts the sentinel reaches each composer's output. A composer
// that forgets the block fails here; a new composer belongs in this list or it ships
// voiceless. Run from apps/desktop:  pnpm exec tsx --test src/main/housestyle.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { __setHouseStyleForTest, houseStyle, styled } from './housestyle';
import { chatSystemPrompt, codingSystemPrompt } from './runtime/adapter';
import { chatSystemPrompt as chatModeSystemPrompt } from './chatmode';

const SENTINEL = 'Sentinel-rule: the quarterly gong must ring.';

test('the block itself: defaults ON, opt-out empties it', () => {
  __setHouseStyleForTest(null);
  const b = houseStyle()!;
  assert.match(b, /supersedes/);
  assert.match(b, /em dashes/);
  assert.match(b, /STE-100/);
  __setHouseStyleForTest({ ste100: false, noEmdash: false });
  assert.equal(houseStyle(), null);
  assert.equal(styled('sys'), 'sys'); // all-off appends nothing
});

test('EVERY composer carries the sentinel — the list is the contract', () => {
  __setHouseStyleForTest({ custom: [SENTINEL] });
  const composed: Record<string, string> = {
    'adapter.chatSystemPrompt (board chat, all runtimes)': chatSystemPrompt('rex', 'dev', null),
    'adapter.codingSystemPrompt (worker + legs, all runtimes)': codingSystemPrompt('patch', true, null),
    'chatmode.chatSystemPrompt (docs/34 chat threads)': chatModeSystemPrompt({ name: 'rex', role: 'orchestrator', brief: null } as never, 'dev', { canUseTools: false }),
    // the orchestrator turn and the marketing bootstrap wrap their composed prompt in
    // styled() at the call site — pinned here via the wrapper they share:
    'styled() (orchestratorturn systemPrompt · bootstrap system · distill)': styled('any system'),
  };
  for (const [name, out] of Object.entries(composed)) {
    assert.ok(out.includes(SENTINEL), `${name} lost the house-style block`);
    assert.ok(out.trimEnd().endsWith(SENTINEL.slice(-20)) || out.indexOf(SENTINEL) > out.length / 2,
      `${name} must append the block LAST — last position is what makes "supersedes" real`);
  }
});
