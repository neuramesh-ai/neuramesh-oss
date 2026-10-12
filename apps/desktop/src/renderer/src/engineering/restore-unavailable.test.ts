// a recorded coding thread can open with no machine to run it (#716). a restore must move files on that
// machine, so Restore waits for one. it never falls back to the local reducer, which rewrote the
// transcript while no file changed. the hq twin is apps/hq/src/engineering/restore-unavailable.test.ts.
// run from apps/desktop:  pnpm exec tsx --test src/renderer/src/engineering/restore-unavailable.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { registerHooks } from 'node:module';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createEngineeringSession } from './domain';

// the desktop package compiles tests to commonjs, so the panel loads inside a test, not at the top
async function codePanel() {
  // node has no stylesheet loader: keep the panel's css imports out of this logic check
  const styles = registerHooks({ load(url, context, next) {
    return url.endsWith('.css') ? { format: 'module', source: 'export default {};', shortCircuit: true } : next(url, context);
  } });
  try { return (await import('../thread/CodeFace')).CodePanel; } finally { styles.deregister(); }
}

const session = createEngineeringSession({ id: 'thread-1', name: 'app', owner: 'acme', branch: 'main', root: null });
const draw = async (restoreUnavailable: boolean): Promise<string> => renderToStaticMarkup(h(await codePanel(), {
  session, tab: 'checkpoints', onTab: () => {}, onSession: () => {}, selectedPath: null, onSelectPath: () => {}, restoreUnavailable,
}));
const restoreButton = (html: string): string => /<button[^>]*>Restore<\/button>/.exec(html)?.[0] ?? '';

test('with no machine, Restore is disabled and says why', async () => {
  const button = restoreButton(await draw(true));
  assert.ok(button, 'the checkpoints tab draws a Restore button');
  assert.match(button, /disabled=""/);
  assert.match(button, /title="Connect a machine to restore the files\."/);
});

test('with a machine, Restore stays enabled and carries no reason', async () => {
  const button = restoreButton(await draw(false));
  assert.ok(button);
  assert.doesNotMatch(button, /disabled/);
  assert.doesNotMatch(button, /title=/);
});

test('the coding thread marks Restore unavailable whenever no machine runs it, outside the harness', () => {
  const thread = readFileSync(join(import.meta.dirname, '../views/CodingThread.tsx'), 'utf8');
  assert.match(thread, /restoreUnavailable=\{!harness && !canExecute\}/);
});
