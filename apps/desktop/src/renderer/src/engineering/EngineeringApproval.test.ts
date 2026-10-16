import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { before, test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { applyRemoteEngineeringEvent, createEngineeringSession } from '@neuramesh/shared';

// Render the real card in Node; CSS module names have no bearing on its text or controls.
const require = createRequire(import.meta.url);
require.extensions['.css'] = (module) => { module.exports = { default: new Proxy({}, { get: (_, key) => key }) }; };
let ApprovalCard: typeof import('./EngineeringApproval')['ApprovalCard'];
before(async () => { ({ ApprovalCard } = await import('./EngineeringApproval')); });

const pending = (commands: string[], name?: string) => applyRemoteEngineeringEvent({
  ...createEngineeringSession({ id: 'fixture', name: 'app', owner: 'local', root: null, branch: 'main' }),
  ...(name ? { agent: { id: 'selected-agent', name, role: 'developer' } } : {}),
}, { type: 'approval', approvalId: 'approval', category: 'command', toolName: 'run_commands', input: { commands } });
const draw = (commands: string[], name?: string) => renderToStaticMarkup(createElement(ApprovalCard, { session: pending(commands, name), onResolve() {} }));
const commandText = (html: string) => [...html.matchAll(/<code\b[^>]*>([\s\S]*?)<\/code>/g)].map((m) => m[1]!
  .replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));

test('the command names the selected agent, including custom names, with the transcript fallback for old sessions', () => {
  for (const name of ['rex', 'patch', 'Release reviewer']) {
    const html = draw(['npm test'], name);
    assert.ok(html.includes(`Requested by ${name}`));
    assert.doesNotMatch(html, /requested by Engineering|run_commands/i);
  }
  assert.match(draw(['npm test']), /Requested by rex/);
  assert.match(draw(['npm test'], '<Rex & friends>'), /Requested by &lt;Rex &amp; friends&gt;/);
});

test('shell highlighting preserves every command byte, newline and command boundary', () => {
  const commands = ["set -eu\ncd 'folder with spaces'\n\n\tprintf '%s\\n' \"$HOME\" | cat\n", 'npm test && node --test test/*.test.mjs'];
  const html = draw(commands, 'rex');
  assert.deepEqual(commandText(html), commands);
  assert.match(html, /class="tk-k">set<\/span>/);
  assert.match(html, /class="tk-s">'folder with spaces'<\/span>/);
  assert.match(html, /Command 1 of 2/);
  assert.match(html, /Command 2 of 2/);
  assert.match(html, /role="region" aria-label="Commands awaiting approval" tabindex="0"/);
  assert.match(html, />Decline<\/button>/);
  assert.match(html, />Approve once<\/button>/);
});

test('HTML-looking shell input stays inert and fully visible', () => {
  const command = "cat <<'EOF'\n<img src=x onerror=alert(1)>\n<script>alert('no')</script>\nEOF";
  const html = draw([command], 'rex');
  assert.deepEqual(commandText(html), [command]);
  assert.doesNotMatch(html, /<img|<script/);
  assert.match(html, /Shell command/);
});
