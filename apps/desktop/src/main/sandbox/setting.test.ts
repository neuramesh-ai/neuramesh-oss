// Containment L1b: the per-machine sandbox on/off setting. Run: pnpm exec tsx --test src/main/sandbox/setting.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSandboxSetting, writeSandboxSetting } from './setting';

test('defaults ON, round-trips, and treats a missing or corrupt file as ON (never silently off)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nm-setting-'));
  assert.equal(readSandboxSetting(dir), true, 'missing file → ON');
  writeSandboxSetting(dir, false);
  assert.equal(readSandboxSetting(dir), false, 'persisted off');
  writeSandboxSetting(dir, true);
  assert.equal(readSandboxSetting(dir), true, 'persisted on');
  writeFileSync(join(dir, 'sandbox.json'), 'not json');
  assert.equal(readSandboxSetting(dir), true, 'corrupt file → ON (fail safe, jailed)');
});
