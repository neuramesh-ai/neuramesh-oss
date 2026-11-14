// The intake scorer's rules (lib/intake-score.mjs) and the reference build rule (evals/intake/reference-rule.mjs).
// Run: node --test scripts/e2e-cloudrun/lib/intake-score.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { fill, judge, score, scoreRule, TARGETS } from './intake-score.mjs';
import { intakeRule } from '../../../evals/intake/reference-rule.mjs';

const CASES = JSON.parse(readFileSync(new URL('../../../evals/intake/cases.json', import.meta.url), 'utf8')).cases;
const c = (over) => ({ id: 'x', category: 'coding-greenfield', text: 't', expect: { kind: 'coding', workspace: 'scratch' }, ...over });

describe('the cases file', () => {
  test('about 50 cases, unique ids, every category the brief names, every expect valid', () => {
    assert.ok(CASES.length >= 45 && CASES.length <= 60, `${CASES.length} cases`);
    assert.equal(new Set(CASES.map((x) => x.id)).size, CASES.length);
    const cats = new Set(CASES.map((x) => x.category));
    for (const k of ['coding-greenfield', 'coding-repo', 'question', 'content', 'research', 'board', 'ambiguous']) assert.ok(cats.has(k), k);
    for (const x of CASES) {
      assert.ok(['chat', 'question', 'coding', 'content', 'research', 'board'].includes(x.expect.kind), x.id);
      assert.ok(['none', 'scratch', 'repo'].includes(x.expect.workspace), x.id);
      assert.equal(x.category === 'coding-repo', x.text.includes('{repo}'), `${x.id}: a repo case names {repo}, and only a repo case`);
    }
  });
});

describe('judge', () => {
  test('clear coding needs the kind AND the workspace', () => {
    assert.equal(judge(c({}), { kind: 'coding', workspace: 'scratch' }).ok, true);
    assert.equal(judge(c({}), { kind: 'coding', workspace: 'repo' }).ok, false);
    assert.equal(judge(c({}), { kind: 'chat', workspace: 'none' }).ok, false);
    assert.equal(judge(c({ category: 'coding-repo', expect: { kind: 'coding', workspace: 'repo' } }), { kind: 'coding', workspace: 'repo' }).ok, true);
  });

  test('an accepted kind is right for a question, and a coding route is flagged', () => {
    const q = c({ category: 'question', expect: { kind: 'question', workspace: 'none' }, accept: ['chat'] });
    assert.equal(judge(q, { kind: 'chat', workspace: 'none' }).ok, true);
    assert.deepEqual([judge(q, { kind: 'coding', workspace: 'scratch' }).ok, judge(q, { kind: 'coding', workspace: 'scratch' }).codingRoute], [false, true]);
    // a non-coding kind with a workspace is wrong: a plain answer needs none
    assert.equal(judge(q, { kind: 'question', workspace: 'scratch' }).ok, false);
  });

  test('no decision is missing: wrong, and not a coding route', () => {
    assert.deepEqual(judge(c({}), null), { ok: false, kindOk: false, workspaceOk: false, missing: true, codingRoute: false });
  });
});

describe('score', () => {
  const cases = [
    c({ id: 'a' }), c({ id: 'b' }), c({ id: 'r', category: 'coding-repo', expect: { kind: 'coding', workspace: 'repo' } }),
    c({ id: 'q', category: 'question', expect: { kind: 'question', workspace: 'none' } }),
    c({ id: 'p', category: 'content', expect: { kind: 'content', workspace: 'none' } }),
  ];
  test('all right: both gates pass', () => {
    const s = score(cases, { a: { kind: 'coding', workspace: 'scratch' }, b: { kind: 'coding', workspace: 'scratch' }, r: { kind: 'coding', workspace: 'repo' }, q: { kind: 'question', workspace: 'none' }, p: { kind: 'content', workspace: 'none' } });
    assert.equal(s.pass, true);
    assert.equal(s.gates.clearCoding.value, 1);
    assert.equal(s.failures.length, 0);
  });

  test('one coding miss in three is under 95%: the gate fails and names the case', () => {
    const s = score(cases, { a: { kind: 'coding', workspace: 'scratch' }, b: { kind: 'chat', workspace: 'none' }, r: { kind: 'coding', workspace: 'repo' }, q: { kind: 'question', workspace: 'none' } });
    assert.equal(s.gates.clearCoding.pass, false);
    assert.ok(Math.abs(s.gates.clearCoding.value - 2 / 3) < 1e-9);
    assert.deepEqual(s.failures.map((f) => f.id).sort(), ['b', 'p']);
    assert.equal(s.byCategory.content.missing, 1);
  });

  test('a single question routed to coding fails the run', () => {
    const s = score(cases, { a: { kind: 'coding', workspace: 'scratch' }, b: { kind: 'coding', workspace: 'scratch' }, r: { kind: 'coding', workspace: 'repo' }, q: { kind: 'coding', workspace: 'scratch' } });
    assert.equal(s.gates.questionCodingRoutes.value, 1);
    assert.equal(s.pass, false);
    assert.equal(TARGETS.questionCodingRoutes, 0);
  });

  test('the rule gate: no false coding route anywhere outside coding, recall reported', () => {
    const r = scoreRule(cases, { a: { kind: 'coding', workspace: 'scratch' }, r: { kind: 'coding', workspace: 'repo' } });
    assert.equal(r.pass, true);
    assert.ok(Math.abs(r.rule.codingRecall - 2 / 3) < 1e-9);
    assert.deepEqual(scoreRule(cases, { p: { kind: 'coding', workspace: 'scratch' } }).rule.falseCodingRoutes, ['p']);
  });

  test('fill puts the repository name in', () => {
    assert.equal(fill('add a dark mode toggle to {repo}', 'acme-web'), 'add a dark mode toggle to acme-web');
  });
});

describe('the reference rule on the labelled cases', () => {
  const repos = [{ id: 'r1', name: 'acme-web' }];
  const results = Object.fromEntries(CASES.map((x) => [x.id, intakeRule(fill(x.text, 'acme-web'), { repos }) ?? { kind: 'chat', workspace: 'none' }]));
  const r = scoreRule(CASES, results);
  test('never routes a question, a content ask, a research ask or board work to coding', () => {
    assert.deepEqual(r.rule.falseCodingRoutes, []);
  });
  test('catches most clear build asks, and names the repository when the ask does', () => {
    assert.ok(r.rule.codingRecall >= 0.8, `recall ${r.rule.codingRecall}`);
    assert.deepEqual(intakeRule('add a dark mode toggle to acme-web', { repos }), { kind: 'coding', workspace: 'repo', repoId: 'r1' });
    assert.deepEqual(intakeRule('build a palindrome html app that checks if a string is a palindrome'), { kind: 'coding', workspace: 'scratch' });
    assert.equal(intakeRule('what is a palindrome?'), null);
    assert.equal(intakeRule('write a short launch post for our app'), null);
  });
});
