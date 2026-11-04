import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { unblockNote } from '@neuramesh/shared';
import { executionGuidance } from './execution-guidance';

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('create table messages(id integer primary key, task_id text, author_kind text, body text, created_at integer)');
  let n = 0;
  return {
    close: () => sqlite.close(),
    add(body: string, author = 'human', task = 'task') {
      sqlite.prepare('insert into messages values(?,?,?,?,?)').run(++n, task, author, body, n);
    },
    db: { getAll: async <T>(sql: string, args: unknown[] = []) => sqlite.prepare(sql).all(...args as string[]) as T[] },
  };
}

test('a human alternative survives retry without any reviewer change request', async () => {
  const f = fixture();
  try {
    f.add('Execution hit a wall: vitest not found.', 'agent');
    f.add('Use the existing dependency cache, then run the route tests.');
    f.add(unblockNote(1119));
    const prompt = await executionGuidance(f.db, 'task');
    assert.match(prompt, /vitest not found/);
    assert.match(prompt, /Human:\nUse the existing dependency cache, then run the route tests\./);
    assert.match(prompt, /Adapt the approach using the latest human guidance/);
    assert.doesNotMatch(prompt, /↻ Unblocked/);
  } finally { f.close(); }
});

test('unblock receipts and unrelated task messages cannot crowd out recent guidance', async () => {
  const f = fixture();
  try {
    f.add('Old instructions');
    f.add('Auto-review of #1119: changes requested: keep the API stable.', 'agent');
    f.add('Try the smaller route fix first.');
    f.add('Use the local fixture for validation.');
    f.add('Keep the PR unmerged.');
    for (let n = 0; n < 8; n++) f.add(unblockNote(1119));
    f.add('Irrelevant task instructions', 'human', 'other');
    f.add('Untrusted agent suggestion', 'agent');
    const prompt = await executionGuidance(f.db, 'task', 'The dependency is now available.');
    assert.match(prompt, /The dependency is now available/);
    assert.match(prompt, /Review feedback:\nAuto-review/);
    assert.ok(prompt.indexOf('smaller route') < prompt.indexOf('local fixture'));
    assert.ok(prompt.indexOf('local fixture') < prompt.indexOf('Keep the PR unmerged'));
    assert.doesNotMatch(prompt, /Old instructions|Irrelevant|Untrusted|↻ Unblocked/);
    assert.match(prompt, /do not claim approval from a suggestion/);
  } finally { f.close(); }
});

test('failure context uses the latest failure; empty guidance stays empty and reads cannot silently fail', async () => {
  const f = fixture();
  try {
    assert.equal(await executionGuidance(f.db, 'task'), '');
    f.add('Execution hit a wall: first failure.', 'agent');
    f.add('Execution hit a wall: most recent failure.', 'agent');
    const prompt = await executionGuidance(f.db, 'task');
    assert.match(prompt, /most recent failure/);
    assert.doesNotMatch(prompt, /first failure/);
    f.close();
    await assert.rejects(executionGuidance(f.db, 'task'));
  } finally { /* closed above to exercise an unavailable replica */ }
});

test('oversized guidance is visibly bounded', async () => {
  const f = fixture();
  try {
    f.add('x'.repeat(30000));
    const prompt = await executionGuidance(f.db, 'task');
    assert.ok(prompt.length < 2000);
    assert.match(prompt, /\[…\]/);
  } finally { f.close(); }
});
