// The GitHub card reads its own decision row (PR #694 review, finding 18 and the untracked-card low). Its face came
// only from its own resolve calls, so a grant on another surface left it on 'Waits for GitHub', an answered card
// went back to waiting when the App later lost access, and a card no resume tracks said the work continues.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { needDecisionQuestion, parseNeed } from '@neuramesh/shared';
import { answersResolver } from '../answers';
import { Md } from '../md/Md';
import { githubFace } from './DependencyCard';

const after = 'rex continues here when GitHub is connected.';
const waits = 'Nothing ran yet. Connect GitHub, then ask again.';

test('a card the resume answered shows connected, even when its own resolve says the App lost access', () => {
  assert.deepEqual(githubFace('Connected acme/app', null, after), { connected: 'acme/app', foot: 'The work continues below.' });
});

test('the row leads the card\'s own resolve', () => {
  assert.deepEqual(githubFace('Connected acme/app', 'acme/other', after), { connected: 'acme/app', foot: 'The work continues below.' });
});

test('a card with no decision row connects by its own resolve and never says the work continues', () => {
  assert.deepEqual(githubFace(undefined, 'acme/app', undefined), { connected: 'acme/app', foot: null });
  assert.deepEqual(githubFace(undefined, '', after), { connected: '', foot: null });
});

test('a waiting card keeps its own words, and a dismissed row promises no resume', () => {
  assert.deepEqual(githubFace(undefined, null, after), { connected: null, foot: after });
  assert.deepEqual(githubFace(undefined, null, undefined), { connected: null, foot: waits });
  assert.deepEqual(githubFace('dismissed', null, after), { connected: null, foot: waits });
});

test('the thread\'s answers carry the card\'s row under the question the server minted', () => {
  const body = 'I need to read the code.\n\n```nmneed\n{"channel":"c-1","ask":"Release notes","why":"The app cannot read acme/app.","connect":["github"]}\n```';
  const need = parseNeed(body)!;
  const row = { message_id: 'm-1', question: needDecisionQuestion(need)!, status: 'answered', answer: 'Connected acme/app' };
  const answers = answersResolver([{ id: 'm-1', author_kind: 'agent', body }], [row])('m-1');
  assert.equal(githubFace(answers.get(needDecisionQuestion(need) ?? ''), null, need.after).connected, 'acme/app');
});

// the plumbing: Md hands each GitHub card the thread's answers (ThreadMessage, and the coding thread's prelude)
const card = 'I need to read the code.\n\n```nmneed\n{"channel":"c-1","ask":"Release notes","why":"The app cannot read acme/app.","connect":["github"],"after":"rex continues here when GitHub is connected."}\n```';
const asked = needDecisionQuestion(parseNeed(card)!)!;
const draw = (answers: Map<string, string>) => renderToStaticMarkup(h(Md, { text: card, answers }));

test('Md hands the card its row: a row the resume answered draws the connected face', () => {
  const html = draw(new Map([[asked, 'Connected acme/app']]));
  assert.match(html, /✓ GitHub is connected/);
  assert.match(html, /<b>acme\/app<\/b>/);
  assert.match(html, /The work continues below\./);
  assert.doesNotMatch(html, /Waits for GitHub/);
});

test('Md with no answered row: the card waits, with its own foot', () => {
  const html = draw(new Map());
  assert.match(html, /⚠ Waits for GitHub/);
  assert.match(html, /rex continues here when GitHub is connected\./);
  assert.doesNotMatch(html, /The work continues below/);
});
