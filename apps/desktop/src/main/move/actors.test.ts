// The local human becomes the cloud user, column by column. Run from apps/desktop:
//   pnpm exec tsx --test src/main/move/actors.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXPORT_REFS, EXPORT_TABLES } from '@neuramesh/shared';
import { HUMAN_ACTOR_COLUMNS, rewriteHumanActors } from './actors';

const FROM = 'cccccccc-0000-4000-8000-000000000003';
const TO = 'dddddddd-0000-4000-8000-000000000004';
const REX = '11111111-0000-4000-8000-000000000003';

test('every actor column the shared format declares is covered, and nothing else is', () => {
  for (const t of EXPORT_TABLES) {
    const declared = EXPORT_REFS[t].filter((r) => r.to === 'actor').map((r) => r.column).sort();
    // artifacts.promoted_by is agents only (docs/export-format.md), so it is not a human column
    const ours = (HUMAN_ACTOR_COLUMNS[t] ?? []).map((c) => c.column).sort();
    assert.deepEqual(ours, declared, t);
  }
});

test('tasks: creator and assignee move when their kind is human, an agent in the same column stays', () => {
  const [a, b] = rewriteHumanActors('tasks', [
    { id: 't1', creator_kind: 'human', creator_id: FROM, assignee_kind: 'agent', assignee_id: REX },
    { id: 't2', creator_kind: 'agent', creator_id: REX, assignee_kind: 'human', assignee_id: FROM },
  ], FROM, TO);
  assert.deepEqual(a, { id: 't1', creator_kind: 'human', creator_id: TO, assignee_kind: 'agent', assignee_id: REX });
  assert.deepEqual(b, { id: 't2', creator_kind: 'agent', creator_id: REX, assignee_kind: 'human', assignee_id: TO });
});

test('messages, channels, agent_channels, artifacts: the created_by and author columns move with kind human', () => {
  assert.equal(rewriteHumanActors('messages', [{ author_kind: 'human', author_id: FROM }], FROM, TO)[0]!['author_id'], TO);
  assert.equal(rewriteHumanActors('messages', [{ author_kind: 'agent', author_id: FROM }], FROM, TO)[0]!['author_id'], FROM, 'an agent row whose id happens to match is not a human');
  assert.equal(rewriteHumanActors('channels', [{ created_by_kind: 'human', created_by: FROM }], FROM, TO)[0]!['created_by'], TO);
  assert.equal(rewriteHumanActors('agent_channels', [{ created_by_kind: 'human', created_by: FROM }], FROM, TO)[0]!['created_by'], TO);
  assert.equal(rewriteHumanActors('agent_channels', [{ created_by_kind: 'agent', created_by: REX }], FROM, TO)[0]!['created_by'], REX);
  const art = rewriteHumanActors('artifacts', [{ created_by_kind: 'human', created_by: FROM, promoted_by: FROM }], FROM, TO)[0]!;
  assert.equal(art['created_by'], TO);
  assert.equal(art['promoted_by'], FROM, 'promoted_by is agents only and is left as it is');
});

test('threads.created_by is the kind:id form: the human address moves, an agent address stays', () => {
  const rows = rewriteHumanActors('threads', [{ created_by: `human:${FROM}` }, { created_by: `agent:${REX}` }, { created_by: null }], FROM, TO);
  assert.deepEqual(rows.map((r) => r['created_by']), [`human:${TO}`, `agent:${REX}`, null]);
});

test('tables without a human column, an empty from, or from equal to to: the rows come back as they are', () => {
  const rows = [{ id: 'p', name: 'Default' }];
  assert.deepEqual(rewriteHumanActors('projects', rows, FROM, TO), rows);
  assert.deepEqual(rewriteHumanActors('messages', [{ author_kind: 'human', author_id: FROM }], '', TO), [{ author_kind: 'human', author_id: FROM }]);
  assert.deepEqual(rewriteHumanActors('messages', [{ author_kind: 'human', author_id: FROM }], FROM, FROM), [{ author_kind: 'human', author_id: FROM }]);
  // rows that do not change are the same objects, not copies
  const same = [{ author_kind: 'agent', author_id: REX }];
  assert.equal(rewriteHumanActors('messages', same, FROM, TO)[0], same[0]);
});
