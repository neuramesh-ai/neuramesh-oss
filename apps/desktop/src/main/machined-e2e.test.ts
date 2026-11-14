import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { E2E_MARKER_DIR, runE2eBoxCli, runE2eCodeShell, runE2ePark } from './machined-e2e';

const withDir = async (fn: (dir: string) => Promise<void>) => {
  const dir = mkdtempSync(join(tmpdir(), 'nm-e2e-probe-'));
  try { await fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
};
const witness = (dir: string, file: string) => JSON.parse(readFileSync(join(dir, E2E_MARKER_DIR, file), 'utf8')) as Record<string, unknown>;

test('the probes do nothing unless their flag is set', async () => withDir(async (dir) => {
  let loaded = 0;
  const load = async () => { loaded++; return {}; };
  await runE2eBoxCli({ env: {}, workDir: dir, box: {}, epoch: 1, log: () => {}, load });
  await runE2ePark({ env: { NM_E2E_PARK: '0' }, workDir: dir, registry: {}, epoch: 1, claimed: 0, log: () => {}, load });
  assert.equal(loaded, 0);
  assert.equal(existsSync(join(dir, E2E_MARKER_DIR)), false);
}));

test('boxcli: the probe gets the box and the runtimes; its secret is logged only as a sha256, never raw', async () => withDir(async (dir) => {
  const lines: string[] = [];
  let seen: Record<string, unknown> | null = null;
  // what runBoxCliProbe hands onSecret: the raw synthetic value (e2e-boxcli.ts)
  const raw = `nm-e2e-${'ab'.repeat(12)}`;
  const load = async () => ({
    runBoxCliProbe: async (o: Record<string, unknown> & { onSecret: (s: string) => void }) => { seen = o; o.onSecret(raw); return { ok: true }; },
  });
  await runE2eBoxCli({ env: { NM_E2E_BOXCLI: '1' }, workDir: dir, box: 'BOX', runtimes: { busPort: 1 }, epoch: 3, log: (l) => lines.push(l), load });
  assert.deepEqual({ workDir: seen!['workDir'], box: seen!['box'], runtimes: seen!['runtimes'], epoch: seen!['epoch'] }, { workDir: dir, box: 'BOX', runtimes: { busPort: 1 }, epoch: 3 });
  assert.ok(lines.includes(`E2E_SECRET_SHA=${createHash('sha256').update(raw).digest('hex')}`));
  assert.ok(lines.every((l) => !l.includes(raw)), 'the raw value reaches no log line');
}));

test('a missing or failing probe leaves an ok:false witness with the reason, and never throws', async () => withDir(async (dir) => {
  await runE2eBoxCli({ env: { NM_E2E_BOXCLI: '1' }, workDir: dir, box: {}, epoch: 2, log: () => {}, load: async () => { throw new Error('Cannot find module'); } });
  assert.deepEqual({ ok: witness(dir, 'boxcli.json')['ok'], epoch: witness(dir, 'boxcli.json')['epoch'] }, { ok: false, epoch: 2 });
  assert.match(String(witness(dir, 'boxcli.json')['error']), /did not load: Cannot find module/);
  await runE2ePark({ env: { NM_E2E_PARK: '1' }, workDir: dir, registry: {}, epoch: 4, claimed: 1, log: () => {}, load: async () => ({ runParkProbe: async () => { throw new Error('no parks api'); } }) });
  assert.deepEqual(witness(dir, 'park.json'), { ok: false, epoch: 4, error: 'no parks api' });
  await runE2ePark({ env: { NM_E2E_PARK: '1' }, workDir: dir, registry: {}, epoch: 5, claimed: 0, log: () => {}, load: async () => ({}) });
  assert.match(String(witness(dir, 'park.json')['error']), /has no runParkProbe export/);
}));

test('park: the probe gets the registry, the epoch and the boot claim count', async () => withDir(async (dir) => {
  let seen: Record<string, unknown> | null = null;
  await runE2ePark({ env: { NM_E2E_PARK: '1' }, workDir: dir, registry: 'REG', epoch: 7, claimed: 2, log: () => {}, load: async () => ({ runParkProbe: async (o: Record<string, unknown>) => { seen = o; } }) });
  assert.deepEqual({ registry: seen!['registry'], epoch: seen!['epoch'], claimed: seen!['claimed'], workDir: seen!['workDir'] }, { registry: 'REG', epoch: 7, claimed: 2, workDir: dir });
}));

test('codeshell: off unless NM_E2E_CODESHELL=1; on, the probe gets the selection and the box lane, and a failure leaves an ok:false witness', async () => withDir(async (dir) => {
  let loaded = 0;
  await runE2eCodeShell({ env: {}, workDir: dir, epoch: 1, selection: Promise.resolve({}), boxLane: null, log: () => {}, load: async () => { loaded++; return {}; } });
  assert.equal(loaded, 0);
  let seen: Record<string, unknown> | null = null;
  const selection = Promise.resolve({ lane: 'box' });
  await runE2eCodeShell({ env: { NM_E2E_CODESHELL: '1' }, workDir: dir, epoch: 8, selection, boxLane: 'LANE', log: () => {}, load: async () => ({ runCodeShellProbe: async (o: Record<string, unknown>) => { seen = o; } }) });
  assert.deepEqual({ workDir: seen!['workDir'], epoch: seen!['epoch'], selection: seen!['selection'], boxLane: seen!['boxLane'] }, { workDir: dir, epoch: 8, selection, boxLane: 'LANE' });
  const lines: string[] = [];
  await runE2eCodeShell({ env: { NM_E2E_CODESHELL: '1' }, workDir: dir, epoch: 9, selection, boxLane: null, log: (l) => lines.push(l), load: async () => ({ runCodeShellProbe: async () => { throw new Error('bwrap: setting up uid map: Permission denied'); } }) });
  assert.deepEqual(witness(dir, 'codeshell.json'), { ok: false, epoch: 9, error: 'bwrap: setting up uid map: Permission denied' });
  assert.ok(lines.some((l) => l.startsWith('e2e codeshell: probe failed')));
}));
