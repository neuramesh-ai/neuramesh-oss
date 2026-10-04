// The version floor that keeps a seated model from being silently swapped. Run:
//   node --import tsx --test apps/desktop/src/main/runtime/cliversion.test.ts
//
// Why this exists: Codex rejects a model whose binary predates it ("requires a newer version of
// Codex"), and runResilient answers that failure by retrying with `model: undefined`, which is a
// SILENT downgrade to the account default. The 2026-07 catalog pass excluded gpt-5.6-luna for
// exactly this reason. The floor upgrades the CLI instead, so a model the human seated is the
// model that runs, or the turn fails loudly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { cliFloor, versionBelow } from './cli';

test('the machine version this repo was written on is below the Astra floor', () => {
  // codex-cli 0.145.0 cannot serve gpt-6-astra; 0.153.0 is the first that can
  assert.equal(versionBelow('0.145.0', '0.153.0'), true);
  assert.equal(versionBelow('0.140.0', '0.153.0'), true);
});

test('the floor and anything above it pass', () => {
  assert.equal(versionBelow('0.153.0', '0.153.0'), false);
  assert.equal(versionBelow('0.153.4', '0.153.0'), false);
  assert.equal(versionBelow('1.0.0', '0.153.0'), false);
});

test('compares segments numerically, not as strings', () => {
  // the bug a lexicographic compare would introduce: "0.9.0" > "0.153.0" as text
  assert.equal(versionBelow('0.9.0', '0.153.0'), true);
  assert.equal(versionBelow('0.153.10', '0.153.4'), false);
  assert.equal(versionBelow('0.153.4', '0.153.10'), true);
});

test('a missing or extra segment is treated as zero', () => {
  assert.equal(versionBelow('0.153', '0.153.0'), false);
  assert.equal(versionBelow('0.152', '0.153.0'), true);
  assert.equal(versionBelow('0.153.0.1', '0.153.0'), false);
});

test('a prerelease suffix does not make a new version look old', () => {
  // `codex --version` prints e.g. "codex-cli 0.153.4"; the parser takes the dotted number
  assert.equal(versionBelow('0.153.4-beta.1', '0.153.0'), false);
});

// The upgrade has to move the install PATH actually resolves. Codex ships a standalone installer
// whose binary lands in ~/.local/bin, which sits AHEAD of npm's prefix on PATH, so `npm i -g`
// there installs a second copy nothing will run: the re-probe still sees the old version and the
// human is told to run a command that cannot fix their machine. Found live, on this machine.
test('an install outside npm prefix is not npm-managed', async () => {
  const { isNpmManagedAt } = await import('./cli');
  assert.equal(isNpmManagedAt('/home/x/.local/bin/codex', '/home/x/.nvm/versions/node/v22.0.0'), false);
  assert.equal(isNpmManagedAt('/home/x/.nvm/versions/node/v22.0.0/bin/codex', '/home/x/.nvm/versions/node/v22.0.0'), true);
});

test('an unreadable npm prefix never claims the binary', async () => {
  const { isNpmManagedAt } = await import('./cli');
  assert.equal(isNpmManagedAt('/home/x/.local/bin/codex', ''), false);
});

// the machine image installs codex when it builds, and a pin under the floor sends every GPT turn
// on a cloud machine through an upgrade first (npm, on a layer the next restart throws away). the
// pin sat at 0.146.1 from #324 while the floor moved to 0.153.0. infra/ stays in the private
// repository (scripts/public-tree.sh), so the public tree skips this.
const machineDockerfile = new URL('../../../../../infra/images/machine/Dockerfile', import.meta.url);
test('the machine image installs a codex at or above the floor', { skip: !existsSync(machineDockerfile) && 'infra/ is not in this tree' }, () => {
  const pin = /@openai\/codex@(\d+\.\d+\.\d+)/.exec(readFileSync(machineDockerfile, 'utf8'))?.[1];
  const floor = cliFloor('codex');
  assert.ok(pin, 'the image pins a codex version');
  assert.ok(floor, 'codex has a floor');
  assert.equal(versionBelow(pin, floor), false, `the image installs codex ${pin}, below the floor ${floor}`);
});
