// THE WORKER'S TOOL SERVER BUILDS WITHOUT ELECTRON. A cloud machine runs the daemon under plain
// node, where the electron package's index throws at require. nmtools imported the renderer (and
// with it Electron) up front, so every task turn on a cloud machine died before its first tool
// call (k3d, 2026-09-26). The renderer now loads only inside the screenshot tool.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nmToolServer } from './nmtools';

test('the tool server builds on a machine without Electron, and never loads the renderer to do it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nmtools-'));
  let loads = 0;
  try {
    const server = await nmToolServer({
      dir,
      beatRun: null,
      loadRender: async () => { loads++; throw new Error('Electron failed to install correctly, please delete node_modules/electron and try installing again'); },
    });
    assert.ok(server, 'the server exists');
    assert.equal(loads, 0, 'building it loaded no renderer');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
