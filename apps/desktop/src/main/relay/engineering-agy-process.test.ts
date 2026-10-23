import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgyProcess } from './engineering-agy-process';
import { agyArgs } from './engineering-agy-args';
import { fakeAgyScript } from './engineering-agy-fake.test-helper';

const script = fakeAgyScript();

function start(o: { mode?: 'plan' | 'accept-edits' | null; conversationId?: string } = {}) {
  const cwd = mkdtempSync(join(tmpdir(), 'nm-agy-proc-'));
  const lines: Array<Record<string, unknown>> = [];
  let exited: { code: number | null; stderr: string } | null = null;
  let onExit: () => void = () => {};
  const done = new Promise<void>((resolve) => { onExit = resolve; });
  const proc = new AgyProcess({
    bin: process.execPath, args: [script, ...agyArgs({ model: 'gemini-3.8-flash-low', mode: o.mode ?? null, conversationId: o.conversationId ?? null })], cwd, env: process.env,
    onLine: (value) => lines.push(value as Record<string, unknown>),
    onExit: (code, _signal, stderr) => { exited = { code, stderr }; onExit(); },
  });
  const until = async (test: () => boolean, ms = 5000) => {
    const end = Date.now() + ms;
    while (!test()) { if (Date.now() > end) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 20)); }
  };
  return { proc, cwd, lines, until, done, exited: () => exited };
}

test('init arrives before any turn, and each user line runs one turn in one conversation', async () => {
  const s = start();
  await s.until(() => s.lines.some((l) => l['event'] === 'init'));
  const conversation = s.lines[0]!['conversation_id'];
  assert.equal(s.proc.send('first'), true);
  assert.equal(s.proc.send('second'), true);
  await s.until(() => s.lines.filter((l) => l['event'] === 'result').length === 2);
  const results = s.lines.filter((l) => l['event'] === 'result').map((l) => l['result'] as Record<string, unknown>);
  assert.deepEqual(results.map((r) => r['conversation_id']), [conversation, conversation]);
  await s.proc.close();
  assert.equal(s.exited()?.code, 0);
  assert.equal(s.proc.alive, false);
  assert.equal(s.proc.send('late'), false, 'a closed process takes no turn');
});

test('a resumed conversation keeps its id, and a missing one starts fresh with a warning', async () => {
  const kept = start({ conversationId: 'keep-1' });
  await kept.until(() => kept.lines.length > 0);
  assert.equal(kept.lines[0]!['conversation_id'], 'keep-1');
  await kept.proc.close();
  const lost = start({ conversationId: 'gone-1' });
  await lost.until(() => lost.lines.length > 0);
  assert.notEqual(lost.lines[0]!['conversation_id'], 'gone-1');
  await lost.proc.close();
  assert.match(lost.exited()?.stderr ?? '', /not found/);
});

test('stop ends a slow turn at once, and a crash reports its stderr', async () => {
  const slow = start();
  await slow.until(() => slow.lines.length > 0);
  slow.proc.send('SLOW please');
  const began = Date.now();
  await slow.proc.stop(500);
  assert.ok(Date.now() - began < 2500, 'stop does not wait for the turn');
  assert.equal(slow.lines.some((l) => l['event'] === 'result'), false);
  const crash = start();
  await crash.until(() => crash.lines.length > 0);
  crash.proc.send('CRASH now');
  await crash.done;
  assert.equal(crash.exited()?.code, 3);
  assert.match(crash.exited()?.stderr ?? '', /AGY_ERROR/);
});

test('accept-edits lets the fake write, the default mode refuses it', async () => {
  const edits = start({ mode: 'accept-edits' });
  await edits.until(() => edits.lines.length > 0);
  edits.proc.send('WRITE made.txt');
  await edits.until(() => edits.lines.some((l) => l['event'] === 'result'));
  assert.equal(existsSync(join(edits.cwd, 'made.txt')), true);
  await edits.proc.close();
  const plain = start();
  await plain.until(() => plain.lines.length > 0);
  plain.proc.send('WRITE refused.txt');
  await plain.until(() => plain.lines.some((l) => l['event'] === 'result'));
  assert.equal(existsSync(join(plain.cwd, 'refused.txt')), false);
  await plain.proc.close();
});
