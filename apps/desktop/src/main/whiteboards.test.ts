// Whiteboards (docs/38): the renderer's pure half — row parsing, the two staleness questions,
// and the destination's calendar grouping. Run from apps/desktop:
//   pnpm exec tsx --test src/main/whiteboards.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWbRow, wbNeedsMaterialize, wbSnapshotStale, wbSnapshotSrc, whiteboardGroups, type WbRow } from '../renderer/src/whiteboards';

const raw = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'wb-1',
  channel_id: 'ch-dev',
  channel_slug: 'dev',
  thread_id: null,
  task_id: null,
  title: 'offline sync map',
  scene: null,
  source: null,
  snapshot_svg: '<svg/>',
  snapshot_rev: 3,
  rev: 3,
  archived_at: null,
  created_by_kind: 'human',
  created_by: 'george',
  created_at: '2026-08-05T10:00:00.000Z',
  updated_at: '2026-08-05T11:00:00.000Z',
  ...over,
});

const row = (over: Partial<WbRow> = {}): WbRow => {
  const r = parseWbRow(raw());
  assert.ok(r);
  return { ...r, ...over };
};

test('parseWbRow reads a watch row and stays lenient about garbage', () => {
  const r = parseWbRow(raw({ source: '{"kind":"mermaid","value":"flowchart LR; a-->b"}' }));
  assert.equal(r?.title, 'offline sync map');
  assert.equal(r?.source?.kind, 'mermaid');
  assert.equal(r?.createdByKind, 'human');
  // an agent row reads as agent; anything else clamps to human
  assert.equal(parseWbRow(raw({ created_by_kind: 'agent' }))?.createdByKind, 'agent');
  // a malformed source is null — "needs the desktop to draw it" never becomes a throw
  assert.equal(parseWbRow(raw({ source: 'not json' }))?.source, null);
  assert.equal(parseWbRow(null), null);
  assert.equal(parseWbRow({ id: 'x' }), null); // no channel — not a row
});

test('the two staleness questions', () => {
  assert.equal(wbNeedsMaterialize(row()), false);
  assert.equal(wbNeedsMaterialize(row({ source: { kind: 'mermaid', value: 'flowchart' } })), true);
  // a fresh still pictures the rev it rode in with
  assert.equal(wbSnapshotStale(row()), false);
  // a save that could not export leaves the still behind the scene
  assert.equal(wbSnapshotStale(row({ rev: 4 })), true);
  // no still at all is stale by definition
  assert.equal(wbSnapshotStale(row({ snapshotSvg: null })), true);
});

test('the snapshot renders as a data URI, never markup', () => {
  assert.equal(wbSnapshotSrc(null), null);
  const src = wbSnapshotSrc('<svg><text>a & b</text></svg>');
  assert.ok(src?.startsWith('data:image/svg+xml;utf8,'));
  assert.ok(!src?.includes('<svg')); // encoded, not embeddable as markup
});

test('whiteboardGroups mirrors the session list calendar — local days, injected now, no empty buckets', () => {
  const now = new Date('2026-08-05T15:00:00');
  const at = (iso: string, id: string): WbRow => row({ id, updatedAt: iso });
  const groups = whiteboardGroups(
    [
      at('2026-08-05T09:00:00', 'today'),
      at('2026-08-04T23:59:00', 'yesterday'),
      at('2026-08-01T10:00:00', 'week'),
      at('2026-07-01T10:00:00', 'earlier'),
      at('not a date', 'lost'),
    ],
    now.getTime(),
  );
  assert.deepEqual(
    groups.map((g) => [g.label, g.rows.map((r) => r.id)]),
    [
      ['Today', ['today']],
      ['Yesterday', ['yesterday']],
      ['This week', ['week']],
      ['Earlier', ['earlier', 'lost']], // an unparseable stamp still shows, in Earlier
    ],
  );
  // a single-bucket day renders one group, no empty headers
  assert.deepEqual(whiteboardGroups([at('2026-08-05T09:00:00', 'only')], now.getTime()).map((g) => g.label), ['Today']);
});
