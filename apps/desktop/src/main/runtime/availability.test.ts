import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { geminiLogin } from './detect';
import { watchRuntimeAvailability } from './availability';

test('a login written while the terminal stays open publishes, and logout removes it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'nm-availability-'));
  const auth = join(dir, 'antigravity-oauth-token');
  const reports: string[][] = [];
  const watcher = watchRuntimeAvailability({
    initial: [],
    probe: async () => geminiLogin(await readFile(auth, 'utf8').catch(() => '')).usable ? ['gemini'] : [],
    publish: async (r) => { reports.push(r); return true; },
    pollMs: 10,
  });
  try {
    await writeFile(auth, JSON.stringify({ auth_method: 'consumer', token: { refresh_token: 'fixture-only' } }));
    // No terminal-close callback or manual refresh: the same timer the daemon uses detects it.
    await waitFor(() => reports.length === 1);
    assert.deepEqual(reports[0], ['gemini']);
    await rm(auth);
    await waitFor(() => reports.length === 2);
    assert.deepEqual(reports[1], []);
  } finally { watcher.stop(); await rm(dir, { recursive: true, force: true }); }
});

test('failed writes retry, failed reads preserve status, and ordering does not republish', async () => {
  let value = ['codex', 'gemini'];
  let broken = false;
  let accepted = false;
  const reports: string[][] = [];
  const watcher = watchRuntimeAvailability({
    initial: ['codex'], pollMs: 60_000,
    probe: async () => { if (broken) throw new Error('unreadable'); return value; },
    publish: async (r) => { reports.push(r); return accepted; },
  });
  try {
    await watcher.refresh();
    accepted = true;
    await watcher.refresh();
    assert.equal(reports.length, 2);
    value = ['gemini', 'codex', 'gemini'];
    await watcher.refresh();
    broken = true;
    await watcher.refresh();
    assert.deepEqual(watcher.current(), ['codex', 'gemini']);
    assert.equal(reports.length, 2);
  } finally { watcher.stop(); }
});

test('overlapping checks share a probe and shutdown prevents a late publish', async () => {
  let resolve!: (r: string[]) => void;
  let probes = 0;
  let writes = 0;
  const watcher = watchRuntimeAvailability({
    initial: [], pollMs: 60_000,
    probe: () => { probes++; return new Promise((r) => { resolve = r; }); },
    publish: async () => { writes++; return true; },
  });
  const a = watcher.refresh();
  const b = watcher.refresh();
  assert.equal(probes, 1);
  watcher.stop();
  resolve(['claude-code']);
  await Promise.all([a, b]);
  assert.equal(writes, 0);
});

async function waitFor(done: () => boolean) {
  const deadline = Date.now() + 2_000;
  while (!done() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
  assert.ok(done(), 'runtime change did not publish');
}
