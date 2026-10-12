import { test } from 'vitest';
import assert from 'node:assert/strict';
import { engineeringApprovalCommands } from '../src/engineering/approval-display';
import { applyRemoteEngineeringEvent, resolveRemoteEngineeringApproval } from '../src/engineering/remote';
import { createEngineeringSession } from '../src/engineering/domain';

test('live and restored command approvals display commands without altering the pending request', () => {
  const input = { commands: ['npm test'] };
  const session = applyRemoteEngineeringEvent(createEngineeringSession({ id: 'repo', name: 'app', owner: 'acme', branch: 'main', root: null }), {
    type: 'approval', approvalId: 'command-1', category: 'command', toolName: 'run_commands', input,
  });
  for (const current of [session, JSON.parse(JSON.stringify(session))]) {
    const approval = current.pendingApproval!;
    assert.deepEqual(engineeringApprovalCommands(approval), ['npm test']);
    assert.deepEqual(JSON.parse(approval.command!), input);
    assert.equal(approval.id, 'command-1');
    assert.equal(resolveRemoteEngineeringApproval(current, true).state, 'streaming');
    assert.equal(resolveRemoteEngineeringApproval(current, false).state, 'resumable');
  }
});

test('multiple commands keep their order, quotes, spacing and multiline shell syntax exactly', () => {
  const commands = ["  printf '%s\\n' \"$HOME\"  ", "node <<'EOF'\nconsole.log('<tag> & text');\nEOF", 'npm test', 'npm test'];
  assert.deepEqual(engineeringApprovalCommands({ category: 'command', command: JSON.stringify({ commands }) }), commands);
  assert.deepEqual(engineeringApprovalCommands({ category: 'command', command: commands[1] }), [commands[1]]);
});

test('unknown, incomplete or mixed inputs stay fully visible', () => {
  for (const command of ['{"commands":["npm test"]', '{"commands":[]}', '{"commands":["npm test",42]}', '{"commands":[" "]}', '{"commands":["npm test"],"cwd":"/elsewhere"}', 'null', '42', '["npm test"]']) {
    assert.deepEqual(engineeringApprovalCommands({ category: 'command', command }), [command]);
  }
  assert.deepEqual(engineeringApprovalCommands({ category: 'command' }), []);
});

test('other approval categories retain their original details', () => {
  const command = '{"url":"https://example.com","prompt":"Read docs"}';
  assert.deepEqual(engineeringApprovalCommands({ category: 'web', command }), [command]);
});
