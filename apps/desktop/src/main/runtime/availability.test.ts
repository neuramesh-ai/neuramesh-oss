import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { geminiLogin } from './detect';
import { watchRuntimeAvailability } from './availability';

for (const auth_method of ['consumer', 'gcp']) test(`${auth_method} login while the terminal stays open publishes, and logout removes it`, async () => {
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
    await writeFile(auth, JSON.stringify({ auth_method, token: { refresh_token: 'fixture-only' } }));
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

// A Cloud Run machine never registers, so its runtimes reach machines.runtimes only through a
// publish. Before publishInitial the first write was the 30 s beat, and r6's e2e epochs drained
// in 10 to 14 s: the machine logged "runtimes gemini" and the row (and hq) kept '[]'.
test('publishInitial writes the boot-time runtimes at once, before any poll or beat', async () => {
  const reports: string[][] = [];
  const watcher = watchRuntimeAvailability({
    initial: ['gemini'], pollMs: 60_000, publishInitial: true,
    probe: async () => ['gemini'],
    publish: async (r) => { reports.push(r); return true; },
  });
  try {
    await waitFor(() => reports.length === 1);
    assert.deepEqual(reports[0], ['gemini']);
    // accepted: the same value is not published again
    await watcher.refresh();
    assert.equal(reports.length, 1);
  } finally { watcher.stop(); }
});

test('a refused boot-time write retries on the next check, even when nothing changed', async () => {
  let accepted = false;
  const reports: string[][] = [];
  const watcher = watchRuntimeAvailability({
    initial: [], pollMs: 60_000, publishInitial: true,
    probe: async () => [],
    publish: async (r) => { reports.push(r); return accepted; },
  });
  try {
    await waitFor(() => reports.length === 1);
    await new Promise((r) => setTimeout(r, 0)); // let the boot-time write settle before the check
    accepted = true;
    await watcher.refresh();
    assert.equal(reports.length, 2, 'an empty list is a fact too: the row must learn it');
    await watcher.refresh();
    assert.equal(reports.length, 2);
  } finally { watcher.stop(); }
});

test('without publishInitial the initial list counts as already on the row (the desktop registers it)', async () => {
  const reports: string[][] = [];
  const watcher = watchRuntimeAvailability({
    initial: ['codex'], pollMs: 60_000,
    probe: async () => ['codex'],
    publish: async (r) => { reports.push(r); return true; },
  });
  try {
    await watcher.refresh();
    assert.equal(reports.length, 0);
  } finally { watcher.stop(); }
});

test('the Cloud Run machine daemon publishes its boot-time runtimes', () => {
  const src = readFileSync(join(import.meta.dirname, '..', 'machined.ts'), 'utf8');
  assert.match(src, /watchRuntimeAvailability\(\{[^}]*publishInitial: true/);
});

async function waitFor(done: () => boolean) {
  const deadline = Date.now() + 2_000;
  while (!done() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
  assert.ok(done(), 'runtime change did not publish');
}
