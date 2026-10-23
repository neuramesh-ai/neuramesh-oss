import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const code = ts.transpileModule(readFileSync(new URL('./electronlazy.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function loadElectron(load: () => unknown) {
  const exports: { electron?: () => unknown } = {};
  runInNewContext(code, { exports, require: (id: string) => {
    assert.equal(id, 'electron');
    return load();
  } });
  return exports.electron!;
}

test('plain Node with an installed Electron binary has no window API', () => {
  let calls = 0;
  const electron = loadElectron(() => { calls++; return '/cached/electron/dist/electron'; });
  assert.equal(electron(), null);
  assert.equal(electron(), null);
  assert.equal(calls, 1);
});

test('a missing Electron binary remains a supported headless runtime', () => {
  const electron = loadElectron(() => { throw new Error('Electron failed to install correctly'); });
  assert.equal(electron(), null);
});

test('the real main-process API remains available to desktop callers', () => {
  const main = { BrowserWindow: { getAllWindows: () => [] } };
  const electron = loadElectron(() => main);
  assert.equal(electron(), main);
});
