// the orb a run's step wears (docs/33, the thinking orb): the step words are the simple present since
// 2026-10-05, and a step a stored run kept from before still reads the old way, so both pick one orb.
// run from apps/desktop:  pnpm exec tsx --test src/renderer/src/views/orbstate.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toolVerb } from '@neuramesh/shared';
import { orbStateFor } from './SessionList';

test('the reply and a draft compose, a subagent weaves, and the floor breathes', () => {
  assert.equal(orbStateFor('writes the reply'), 'composing');
  assert.equal(orbStateFor('drafts the posts'), 'composing');
  assert.equal(orbStateFor('composing…'), 'composing');
  assert.equal(orbStateFor('starts a subagent'), 'weaving');
  assert.equal(orbStateFor('thinking…'), 'breathing');
});

test('the shared step words keep their orb', () => {
  const verb = (summary: string, kind = 'tool') => toolVerb({ kind, phase: kind === 'tool' ? 'call' : null, summary })!;
  assert.equal(orbStateFor(verb('', 'turn').verb), 'composing');
  const read = verb('Read src/pages/pricing/PricingPage.tsx');
  assert.equal(orbStateFor(read.verb, read.cat), 'working');
  const search = verb('WebSearch annual pricing');
  assert.equal(orbStateFor(search.verb, search.cat), 'searching');
  assert.equal(orbStateFor(verb('spawn marketer · three drafts').verb), 'weaving');
});
