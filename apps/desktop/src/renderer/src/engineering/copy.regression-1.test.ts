import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { engineeringShellSession, engineeringSystemText, persistableEngineeringSession, productizeStoredEngineeringSession } from './copy';
import { createEngineeringSession, type EngineeringMessage } from './domain';

// Regression: ISSUE-002 — the implementation harness vendor was exposed throughout Engineering
// Found by /qa on 2026-08-30
// Report: .gstack/qa-reports/qa-report-127-0-0-1-2026-08-30.md
test('product-owned Engineering copy never exposes the implementation harness', () => {
  assert.equal(
    engineeringSystemText('Cline Core and ClineCore failed in CLINE_test. Cline Engineering is unavailable.'),
    'Engineering and Engineering failed in Engineering_test. Engineering is unavailable.',
  );
  assert.equal(engineeringSystemText('Restored Cline checkpoint · run 2'), 'Restored checkpoint · run 2');

  const created = createEngineeringSession({ id: 'r1', name: 'app', owner: 'acme', branch: 'main', root: null });
  const at = new Date().toISOString();
  const messages: EngineeringMessage[] = [
    { id: 'user', role: 'user', body: 'Compare the Cline SDK', createdAt: at },
    { id: 'tool', role: 'tool', body: 'Cline connected', createdAt: at },
    { id: 'warning', role: 'assistant', body: 'Cline encountered an error', tone: 'warning', createdAt: at },
    { id: 'answer', role: 'assistant', body: 'The repository imports Cline intentionally.', createdAt: at },
  ];
  const session = productizeStoredEngineeringSession({
    ...created,
    messages,
    provider: 'cline-native',
    model: 'cline-core',
    pendingApproval: {
      id: 'approval', category: 'edit', title: 'Cline edit', detail: 'editor requested by Cline', continuation: 'apply',
    },
    checkpoints: [{ ...created.checkpoints[0]!, label: 'Before first Cline turn' }],
  });

  assert.equal(session.messages[0]?.body, 'Compare the Cline SDK', 'user-authored text stays exact');
  assert.equal(session.messages[1]?.body, 'Engineering connected');
  assert.equal(session.messages[2]?.body, 'Engineering encountered an error');
  assert.equal(session.messages[3]?.body, 'The repository imports Cline intentionally.', 'normal repository discussion stays exact');
  assert.equal(session.pendingApproval?.title, 'Engineering edit');
  assert.equal(session.pendingApproval?.detail, 'editor requested by Engineering');
  assert.equal(session.checkpoints[0]?.label, 'Before first run');
  assert.equal(session.provider, 'Engineering-native');
  assert.equal(session.model, 'Engineering');
});

test('static Engineering UI surfaces contain no vendor branding', () => {
  const surfaces = [
    join(import.meta.dirname, '../views/EngineeringOS.tsx'),
    join(import.meta.dirname, 'EngineeringModelSelector.tsx'),
    join(import.meta.dirname, 'EngineeringActivity.tsx'),
    join(import.meta.dirname, 'EngineeringEditor.tsx'),
    join(import.meta.dirname, '../App.tsx'),
    join(import.meta.dirname, '../../web/webnm-local.ts'),
  ];
  for (const file of surfaces) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /\bcline\b/i, file);
  }
});

test('the Code model picker keeps the managed starter model opaque', () => {
  const selector = readFileSync(join(import.meta.dirname, 'EngineeringModelSelector.tsx'), 'utf8');
  assert.match(selector, /modelId === STARTER_MODEL \? 'NeuraMesh managed'/);
  assert.match(selector, /projectDeveloperModel\(session\.model, project\?\.model_pack, agents, customPacks\)/);
  assert.match(selector, /<span className="lbl" title=\{triggerLabel\}>\{triggerLabel\}<\/span>/);
  assert.doesNotMatch(selector, /<small>\{modelId\}<\/small>/);
});

test('browser persistence excludes machine-authoritative repository and tool output', () => {
  const created = createEngineeringSession({ id: 'r1', name: 'app', owner: 'acme', branch: 'main', root: null });
  const at = new Date().toISOString();
  const change = { path: 'secret.ts', kind: 'modified' as const, before: 'old secret', after: 'new secret', diff: '-old secret\n+new secret' };
  const persisted = persistableEngineeringSession({
    ...created,
    state: 'awaiting_approval',
    activeActivity: { phase: 'tool', toolName: 'run_commands', startedAt: at },
    messages: [
      ...created.messages,
      { id: 'tool', role: 'tool', body: 'unrestricted command output', createdAt: at },
      { id: 'answer', role: 'assistant', body: 'The requested change is ready.', createdAt: at },
    ],
    pendingApproval: { id: 'approval', category: 'edit', title: 'Apply changes', detail: 'editor requested', changes: [change], continuation: 'apply' },
    proposedChanges: [change],
    changes: [change],
    checkpoints: [{ ...created.checkpoints[0]!, changes: [change] }],
  });

  assert.equal(persisted.state, 'resumable');
  assert.equal(persisted.activeActivity, null);
  assert.equal(persisted.pendingApproval, null);
  assert.deepEqual(persisted.proposedChanges, []);
  assert.deepEqual(persisted.changes, []);
  assert.deepEqual(persisted.checkpoints[0]?.changes, []);
  assert.deepEqual(persisted.messages.map((message) => message.id), [created.messages[0]!.id, 'answer']);
  assert.doesNotMatch(JSON.stringify(persisted), /old secret|new secret|unrestricted command output/);
});

test('workspace shell projection keeps one snippet and no transcript or editor payloads', () => {
  const created = createEngineeringSession({ id: 'r1', name: 'app', owner: 'acme', branch: 'main', root: null });
  const at = new Date().toISOString();
  const projected = engineeringShellSession({
    ...created,
    workPlan: 'large work plan',
    messages: [...created.messages, { id: 'latest', role: 'assistant', body: 'latest answer', createdAt: at }],
  });
  assert.deepEqual(projected.messages.map((message) => message.body), ['latest answer']);
  assert.equal(projected.workPlan, '');
  assert.deepEqual(projected.checkpoints, []);
});
