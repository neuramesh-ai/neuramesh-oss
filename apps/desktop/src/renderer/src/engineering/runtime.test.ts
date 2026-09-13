import test from 'node:test';
import assert from 'node:assert/strict';
import { OPEN_ENGINEERING_POLICY, RECOMMENDED_ENGINEERING_PERMISSIONS } from './domain';
import { buildClineToolPolicies, clineToolCategory } from './runtime';

test('Cline tool classification covers the extension families and rejects unknown native tools', () => {
  assert.equal(clineToolCategory('read_file'), 'read');
  assert.equal(clineToolCategory('apply_patch'), 'edit');
  assert.equal(clineToolCategory('execute_command'), 'command');
  assert.equal(clineToolCategory('web_search'), 'web');
  assert.equal(clineToolCategory('github__create_pull_request'), 'mcp');
  assert.equal(clineToolCategory('new_unreviewed_native_tool'), null);
});

test('the generated Cline manifest is deny-by-default and Plan cannot mutate', () => {
  const tools = ['read_file', 'apply_patch', 'execute_command', 'web_search', 'github__get_issue', 'new_unreviewed_native_tool'];
  const policies = buildClineToolPolicies(tools, 'plan', RECOMMENDED_ENGINEERING_PERMISSIONS, OPEN_ENGINEERING_POLICY);
  assert.deepEqual(policies['*'], { enabled: false, autoApprove: false });
  assert.deepEqual(policies.read_file, { enabled: true, autoApprove: true });
  assert.deepEqual(policies.apply_patch, { enabled: false, autoApprove: false });
  assert.deepEqual(policies.execute_command, { enabled: false, autoApprove: false });
  assert.deepEqual(policies.web_search, { enabled: true, autoApprove: false });
  assert.deepEqual(policies.github__get_issue, { enabled: true, autoApprove: false });
  assert.deepEqual(policies.new_unreviewed_native_tool, { enabled: false, autoApprove: false });
});

test('workspace policy still caps an Act session preference', () => {
  const policies = buildClineToolPolicies(
    ['apply_patch', 'execute_command'],
    'act',
    { ...RECOMMENDED_ENGINEERING_PERMISSIONS, edit: true, command: true },
    { ...OPEN_ENGINEERING_POLICY, command: false },
  );
  assert.deepEqual(policies.apply_patch, { enabled: true, autoApprove: true });
  assert.deepEqual(policies.execute_command, { enabled: false, autoApprove: false });
});
