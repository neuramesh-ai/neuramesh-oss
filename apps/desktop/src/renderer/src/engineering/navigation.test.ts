import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyNavScope, navFlat } from '../navtree';
import { createEngineeringSession, submitEngineeringPrompt, type EngineeringRepo } from './domain';
import { engineeringHistoryRows, engineeringSessionForRequest } from './navigation';

const repo: EngineeringRepo = { id: 'repo-1', name: 'neuramesh', owner: 'acme', branch: 'main', root: null };

test('Engineering sessions become globally routable All threads rows in recency order', () => {
  const older = createEngineeringSession(repo, 'Older session');
  const newer = submitEngineeringPrompt(createEngineeringSession(repo, 'Newest session'), 'Inspect the relay and propose a safe fix');
  older.updatedAt = '2026-08-29T10:00:00.000Z';
  newer.updatedAt = '2026-08-30T10:00:00.000Z';

  const rows = engineeringHistoryRows([older, newer]);
  assert.deepEqual(rows.map((row) => row.title), ['Newest session', 'Older session']);
  assert.equal(rows[0]?.engineeringSessionId, newer.id);
  assert.equal(rows[0]?.threadId, null);
  assert.equal(rows[0]?.channelId, null);
  assert.equal(rows[0]?.engineeringRepo, 'neuramesh');
  assert.ok((rows[0]?.snip.length ?? 0) > 0, 'the most recent transcript message becomes the rail preview');
});

test('Engineering sessions appear in All projects and do not pretend to belong to a project room', () => {
  const rows = engineeringHistoryRows([createEngineeringSession(repo, 'Relay review')]);
  const channels = [{ id: 'channel-1', project_id: 'project-1', slug: 'build' }];
  const projects = [{ id: 'project-1', name: 'Neuramesh' }];
  const all = navFlat({ rows, channels, projects, scope: emptyNavScope(), askKeys: new Set(), liveKeys: new Set() });
  assert.equal(all.rows[0]?.engineeringSessionId, rows[0]?.engineeringSessionId);

  const project = navFlat({
    rows,
    channels,
    projects,
    scope: { projectId: 'project-1', channelId: null },
    askKeys: new Set(),
    liveKeys: new Set(),
  });
  assert.equal(project.rows.length, 0);
});

test('an applied rail request cannot replace a newly created active Engineering thread', () => {
  const older = createEngineeringSession(repo, 'Older rail selection');
  const created = createEngineeringSession(repo, 'New engineering task');

  assert.equal(engineeringSessionForRequest([older], older.id, null)?.id, older.id);
  assert.equal(
    engineeringSessionForRequest([older, created], older.id, older.id),
    null,
    'appending a new session must not re-apply the already handled rail request',
  );
  assert.equal(
    engineeringSessionForRequest([older, created], created.id, older.id)?.id,
    created.id,
    'a genuinely new navigation request still opens its target',
  );
});
