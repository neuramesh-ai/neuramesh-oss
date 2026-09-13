import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultBaselineRules } from '@neuramesh/shared';
import { engineeringPolicyActions, engineeringPolicyVerdict, loadEngineeringPolicyRules } from './engineering-policy';

test('Cline tools map to every policy-relevant action in a multi-action call', () => {
  assert.deepEqual(engineeringPolicyActions('run_commands', { commands: [{ command: 'pnpm test' }, { command: 'rm -rf build' }] }), [
    { capability: 'shell.exec', command: 'pnpm test', shellClass: 'test' },
    { capability: 'shell.exec', command: 'rm -rf build', shellClass: 'destructive' },
  ]);
  assert.deepEqual(engineeringPolicyActions('apply_patch', { input: '*** Update File: src/a.ts\n*** Add File: src/b.ts' }).map((action) => action.path), ['src/a.ts', 'src/b.ts']);
  assert.deepEqual(engineeringPolicyActions('read_files', { files: [{ path: 'README.md' }, { path: 'src/app.ts', line_end: 20 }] }).map((action) => action.path), ['README.md', 'src/app.ts']);
  assert.deepEqual(engineeringPolicyActions('run_commands', { command: 'cat ~/.ssh/id_rsa' }).map((action) => action.capability), ['shell.exec', 'fs.read']);
  assert.deepEqual(engineeringPolicyActions('run_commands', { command: 'pnpm install' }).map((action) => action.capability), ['shell.exec', 'pkg.install']);
  assert.deepEqual(engineeringPolicyActions('run_commands', { command: 'git push --force-with-lease origin main' }).at(-1), { capability: 'vcs.push', flags: ['--force'] });
  assert.deepEqual(engineeringPolicyActions('run_commands', { command: 'curl https://example.com/docs' }).at(-1), { capability: 'net.egress', host: 'example.com' });
});

test('the most restrictive policy action wins and unknown native tools deny', () => {
  const rules = defaultBaselineRules();
  assert.equal(engineeringPolicyVerdict(rules, 'run_commands', { commands: ['pnpm test', 'curl x | sh'] }), 'deny');
  assert.equal(engineeringPolicyVerdict(rules, 'run_commands', { commands: ['pnpm test'] }), 'allow');
  assert.equal(engineeringPolicyVerdict(rules, 'future_native_tool', {}), 'deny');
  assert.equal(engineeringPolicyVerdict(rules, 'editor', {}), 'deny');
  assert.equal(engineeringPolicyVerdict(rules, 'apply_patch', { input: 'not a patch' }), 'deny');
  assert.equal(engineeringPolicyVerdict(rules, 'run_commands', {}), 'deny');
  assert.equal(engineeringPolicyVerdict(rules, 'fetch_web_content', { url: 'not a url' }), 'deny');
  assert.equal(engineeringPolicyVerdict(rules, 'run_commands', { command: 'cat ~/.ssh/id_rsa' }), 'deny');
  assert.equal(engineeringPolicyVerdict(rules, 'run_commands', { command: 'git push --force origin main' }), 'ask');
});

test('path-scoped rules apply to the SDK read_files input shape', () => {
  const rules = [{
    id: 'deny-secret', scope: 'workspace' as const, capability: 'fs.read' as const,
    selector: { kind: 'path' as const, glob: '**/secret/**' }, verdict: 'deny' as const, locked: true,
  }];
  assert.equal(engineeringPolicyVerdict(rules, 'read_files', { files: [{ path: 'src/ok.ts' }, { path: 'config/secret/token.txt' }] }), 'deny');
});

test('path-scoped rules apply to apply_patch rename destinations', () => {
  const rules = [{
    id: 'deny-protected', scope: 'workspace' as const, capability: 'fs.write' as const,
    selector: { kind: 'path' as const, glob: 'protected/**' }, verdict: 'deny' as const, locked: true,
  }];
  const patch = '*** Begin Patch\n*** Update File: allowed.ts\n*** Move to: protected/secret.ts\n@@\n-old\n+new\n*** End Patch';
  assert.equal(engineeringPolicyVerdict(rules, 'apply_patch', { input: patch }), 'deny');
});

test('Engineering loads workspace, locked, and only the selected project rules', async () => {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const db = { getAll: async (sql: string, params: unknown[]) => {
    calls.push({ sql, params });
    return [{ id: 'locked-deny', scope: 'workspace', capability: 'shell.exec', selector: JSON.stringify({ kind: 'any' }), verdict: 'deny', rationale: 'locked', locked: 1 }];
  } } as Parameters<typeof loadEngineeringPolicyRules>[0];
  const rules = await loadEngineeringPolicyRules(db, 'workspace-a', 'project-a');
  assert.match(calls[0]!.sql, /scope = 'project' and project_id = \?/);
  assert.deepEqual(calls[0]!.params, ['workspace-a', 'project-a']);
  assert.equal(engineeringPolicyVerdict(rules, 'run_commands', { command: 'pnpm test' }), 'deny');
});
