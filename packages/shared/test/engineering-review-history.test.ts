import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createEngineeringSession, type EngineeringChange, type EngineeringSession } from '../src/engineering/domain';
import { applyRemoteEngineeringEvent as event, beginRemoteEngineeringPrompt, resolveRemoteEngineeringApproval } from '../src/engineering/remote';
import { engineeringReviewMessages } from '../src/engineering/review-history';
import { persistableEngineeringSession, productizeStoredEngineeringSession, engineeringShellSession } from '../src/engineering/copy';
import { failRemoteEngineeringTransport } from '../src/engineering/transport-state';
const repo = { id: 'r', name: 'test', owner: 'test', branch: 'main', root: null };
const fresh = (): EngineeringSession => ({ ...createEngineeringSession(repo), mode: 'act' as const });
const change = (after = 'two\n'): EngineeringChange => ({ path: 'one.ts', kind: 'modified', before: 'one\n', after, diff: `--- a/one.ts\n+++ b/one.ts\n@@ -1 +1 @@\n-one\n+${after}` });
const proposal = (s: EngineeringSession, id = 'a', c = change()) => event(s, { type: 'approval', approvalId: id, toolName: 'apply_patch', category: 'edit', changes: [c] });
const tool = (s: EngineeringSession, failure = false) => event(s, { type: 'agent_event', event: { type: 'agent_event', payload: { event: { type: 'content_end', contentType: 'tool', toolName: 'apply_patch', ...(failure ? { error: 'disk full' } : {}) } } } });
const reviews = (s: EngineeringSession) => engineeringReviewMessages(s).flatMap((m) => m.review ? [m.review] : []);

test('a proposed file batch is copied once, then remains in its original position after approval and application', () => {
  const c = change();
  let s = proposal(fresh(), 'a', c);
  const id = s.messages.at(-1)!.id;
  c.after = 'mutated external value';
  assert.equal(reviews(s)[0]!.changes[0]!.after, 'two\n');
  s = proposal(s, 'a');
  assert.equal(reviews(s).length, 1, 'duplicate approval does not append');
  s = resolveRemoteEngineeringApproval(s, true);
  assert.equal(reviews(s)[0]!.status, 'approved', 'approval is not a successful write');
  s = tool(s);
  assert.equal(reviews(s)[0]!.status, 'applied');
  assert.equal(s.messages.findIndex((m) => m.id === id), 1);
  assert.equal(s.pendingApproval, null);
});

test('later turns and aggregate workspace refreshes do not overwrite earlier file snapshots', () => {
  let s = tool(resolveRemoteEngineeringApproval(proposal(fresh()), true));
  s = event(s, { type: 'ended', reason: 'completed' });
  s = beginRemoteEngineeringPrompt(s, 'Now change it again');
  s = proposal(s, 'b', { ...change('three\n'), before: 'two\n' });
  s = tool(resolveRemoteEngineeringApproval(s, true));
  s = event(s, { type: 'changes', changes: [change('latest aggregate\n')] });
  assert.deepEqual(reviews(s).map((r) => [r.id, r.status, r.changes[0]!.after]), [['a', 'applied', 'two\n'], ['b', 'applied', 'three\n']]);
  assert.ok(s.messages.findIndex((m) => m.review?.id === 'a') < s.messages.findIndex((m) => m.body === 'Now change it again'));
});

test('declined and failed proposals remain reviewable without claiming applied changes', () => {
  let s = resolveRemoteEngineeringApproval(proposal(fresh()), false);
  assert.equal(reviews(s)[0]!.status, 'declined');
  assert.equal(s.changes.length, 0);
  s = tool(resolveRemoteEngineeringApproval(proposal(s, 'b'), true), true);
  assert.deepEqual(reviews(s).map((r) => r.status), ['declined', 'failed']);
  assert.equal(s.changes.length, 0);
});

test('reload preserves exact approved history and makes unfinished approval non-actionable', () => {
  let s = tool(resolveRemoteEngineeringApproval(proposal(fresh()), true));
  s = proposal(s, 'b', change('three\n'));
  const loaded = productizeStoredEngineeringSession(JSON.parse(JSON.stringify(persistableEngineeringSession(s))));
  assert.equal(loaded.pendingApproval, null);
  assert.equal(loaded.state, 'resumable');
  assert.deepEqual(reviews(loaded).map((r) => [r.id, r.status, r.changes[0]!.after]), [['a', 'applied', 'two\n'], ['b', 'interrupted', 'three\n']]);
  const shell = engineeringShellSession(s);
  assert.ok(shell.messages.every((m) => !m.review));
});

test('disconnect and terminal error preserve an unconfirmed outcome instead of success', () => {
  const s = resolveRemoteEngineeringApproval(proposal(fresh()), true);
  for (const ended of [failRemoteEngineeringTransport(s, 'network lost'), event(s, { type: 'error', message: 'connection lost' }), event(s, { type: 'ended', reason: 'interrupted' })]) {
    assert.equal(reviews(ended)[0]!.status, 'interrupted');
    assert.equal(ended.pendingApproval, null);
  }
});

test('approval decisions from the host update the matching card and cannot regress an applied receipt', () => {
  const s = event(proposal(fresh()), { type: 'approval_resolved', approvalId: 'a', approved: true });
  assert.equal(s.pendingApproval, null);
  assert.equal(reviews(s)[0]!.status, 'approved');
  const applied = tool(s);
  assert.equal(reviews(event(applied, { type: 'approval_resolved', approvalId: 'a', approved: true }))[0]!.status, 'applied');
});

test('auto-approved edits record one permanent card for each completed tool', () => {
  let s = fresh();
  for (const text of ['two', 'three']) {
    s = event(s, { type: 'agent_event', event: { type: 'agent_event', payload: { event: { type: 'content_start', contentType: 'tool', toolName: 'editor', input: { path: 'one.ts', old_text: 'one', new_text: text } } } } });
    s = event(s, { type: 'agent_event', event: { type: 'agent_event', payload: { event: { type: 'content_end', contentType: 'tool', toolName: 'editor' } } } });
  }
  assert.equal(reviews(s).length, 2);
  assert.deepEqual(reviews(s).map((r) => r.status), ['applied', 'applied']);
});

test('legacy approvals recover one card without manufacturing prior change batches', () => {
  const s = fresh();
  s.changes = [change()];
  const messages = engineeringReviewMessages(s);
  assert.equal(messages.at(-1)?.review?.status, 'recorded');
  assert.deepEqual(engineeringReviewMessages({ ...s, messages }), messages);
});

test('command approvals never create a file review card', () => {
  const s = event(fresh(), { type: 'approval', approvalId: 'command', category: 'command', toolName: 'run_commands', input: { command: 'node --test' } });
  assert.equal(reviews(s).length, 0);
  assert.equal(s.pendingApproval?.category, 'command');
});


test('a new turn cannot carry an unconfirmed edit into the next batch', () => {
  const interrupted = failRemoteEngineeringTransport(resolveRemoteEngineeringApproval(proposal(fresh()), true), 'disconnected');
  const next = beginRemoteEngineeringPrompt(interrupted, 'Inspect the file before doing anything else');
  assert.deepEqual(next.proposedChanges, []);
  assert.equal(next.pendingApproval, null);
  assert.equal(reviews(next)[0]!.status, 'interrupted');
  assert.equal(reviews(tool(next)).length, 1);
});
