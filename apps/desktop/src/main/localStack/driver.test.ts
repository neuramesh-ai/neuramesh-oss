// The stack state machine: every transition the first-run card renders, the blocking rule, the
// version gate.   pnpm exec tsx --test src/main/localStack/driver.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aboutMb, blocks, initialState, reduce, stackBehind, type StackEvent, type StackState } from './driver';

const run = (events: StackEvent[], from: StackState = initialState()): StackState => events.reduce(reduce, from);
const probe = (o: Partial<{ engine: 'docker-desktop' | 'orbstack' | 'colima' | 'other' | null; running: boolean }>) =>
  ({ type: 'probed', probe: { engine: o.engine ?? null, running: o.running ?? false, dockerBin: null, socket: null } }) as StackEvent;

test('a probe routes: running → starting, stopped → engine-starting, none → the picker with Colima preselected', () => {
  assert.deepEqual(run([probe({ engine: 'orbstack', running: true })]), { phase: 'starting', services: [] });
  assert.deepEqual(run([probe({ engine: 'docker-desktop', running: false })]), { phase: 'engine-starting', engine: 'docker-desktop' });
  assert.deepEqual(run([probe({})]), { phase: 'no-engine', picked: 'colima' });
  // before the probe answers the state is probing, which blocks but draws as the splash: the
  // picker flashed for the two seconds Docker Desktop took to answer (the demo recording, 2026-09-13)
  assert.deepEqual(initialState(), { phase: 'probing' });
  assert.equal(blocks(initialState(), false), true);
  assert.equal(blocks(initialState(), true), true);
});

test('the pick only moves the radio on the picker, and a re-scan keeps the pick', () => {
  const picked = run([probe({}), { type: 'pick', runtime: 'orbstack' }]);
  assert.deepEqual(picked, { phase: 'no-engine', picked: 'orbstack' });
  assert.deepEqual(run([probe({})], picked), { phase: 'no-engine', picked: 'orbstack' });
  assert.deepEqual(run([{ type: 'pick', runtime: 'orbstack' }], { phase: 'starting', services: [] }), { phase: 'starting', services: [] });
});

test('the install lane: rows appear, bytes fill them, the VM row turns, then the engine is probed running', () => {
  let s = run([probe({}), { type: 'install.begin', runtime: 'colima', items: ['Colima', 'Lima', 'Docker CLI', 'Compose'] }]);
  assert.equal(s.phase, 'installing');
  s = run([{ type: 'install.progress', name: 'Colima', bytes: 5, total: 10 }, { type: 'install.progress', name: 'Lima', bytes: 10, total: 10 }], s);
  assert.equal(s.phase, 'installing');
  if (s.phase !== 'installing') throw new Error('unreachable');
  assert.deepEqual(s.items.map((i) => [i.name, i.bytes, i.total, i.done]), [['Colima', 5, 10, false], ['Lima', 10, 10, true], ['Docker CLI', 0, null, false], ['Compose', 0, null, false]]);
  assert.equal(s.vm, 'pending');
  s = run([{ type: 'install.vm', vm: 'starting' }], s);
  assert.equal((s as { vm: string }).vm, 'starting');
  s = run([probe({ engine: 'colima', running: true })], s);
  assert.equal(s.phase, 'starting');
});

test('the first pull is Download, a later tag change is Update, and both fill per image then finish', () => {
  const dl = run([{ type: 'pull.begin', items: ['Postgres', 'PowerSync', 'NeuraMesh API'], version: '0.132.0', update: false }]);
  assert.equal(dl.phase, 'downloading');
  const up = run([{ type: 'pull.begin', items: ['NeuraMesh API'], version: '0.133.0', update: true }]);
  assert.deepEqual(up, { phase: 'updating', version: '0.133.0', items: [{ name: 'NeuraMesh API', bytes: 0, total: null, done: false }] });
  const mid = run([{ type: 'pull.progress', name: 'PowerSync', bytes: 100, total: 286 }, { type: 'pull.done', name: 'Postgres' }], dl);
  if (mid.phase !== 'downloading') throw new Error('unreachable');
  assert.deepEqual(mid.items[0], { name: 'Postgres', bytes: 0, total: null, done: true });
  assert.deepEqual(mid.items[1], { name: 'PowerSync', bytes: 100, total: 286, done: false });
  assert.equal(aboutMb(mid.items), null, 'no number until every total is known');
  const known = run([{ type: 'pull.progress', name: 'Postgres', bytes: 412e6, total: 412e6 }, { type: 'pull.progress', name: 'PowerSync', bytes: 0, total: 286e6 }, { type: 'pull.progress', name: 'NeuraMesh API', bytes: 0, total: 198e6 }], dl);
  if (known.phase !== 'downloading') throw new Error('unreachable');
  assert.equal(aboutMb(known.items), 896);
});

test('up lists the services queued, each poll moves one along the boot order, ready ends it', () => {
  let s = run([{ type: 'up', services: ['Postgres', 'NeuraMesh API', 'PowerSync'] }]);
  assert.deepEqual(s, { phase: 'starting', services: [{ name: 'Postgres', status: 'queued', restarts: 0 }, { name: 'NeuraMesh API', status: 'queued', restarts: 0 }, { name: 'PowerSync', status: 'queued', restarts: 0 }] });
  s = run([{ type: 'service', service: 'Postgres', status: 'ready' }, { type: 'service', service: 'NeuraMesh API', status: 'starting' }], s);
  assert.deepEqual((s as { services: Array<{ status: string }> }).services.map((x) => x.status), ['ready', 'starting', 'queued']);
  // a crash loop is a status with a count, drawn as the row's one word
  s = run([{ type: 'service', service: 'NeuraMesh API', status: 'ready' }, { type: 'service', service: 'PowerSync', status: 'stopped', restarts: 3 }], s);
  assert.deepEqual((s as { services: Array<{ status: string; restarts: number }> }).services[2], { name: 'PowerSync', status: 'stopped', restarts: 3 });
  s = run([{ type: 'ready', version: '0.132.0', engine: 'colima' }], s);
  assert.deepEqual(s, { phase: 'ready', version: '0.132.0', engine: 'colima' });
  // a probe after ready does not regress the shell
  assert.equal(run([probe({ engine: 'colima', running: true })], s).phase, 'ready');
});

test('an error remembers where it came from, a second error keeps the first origin, and a diagnosis rides only when given', () => {
  const e = run([{ type: 'up', services: ['Postgres'] }, { type: 'error', message: 'compose up failed' }]);
  assert.deepEqual(e, { phase: 'error', message: 'compose up failed', from: 'starting' });
  assert.deepEqual(run([{ type: 'error', message: 'again' }], e), { phase: 'error', message: 'again', from: 'starting' });
  assert.deepEqual(run([{ type: 'error', message: 'PowerSync stopped 3 times.', detail: 'postgres query failed', remedy: 'Try again starts a fresh PowerSync container.' }], e),
    { phase: 'error', message: 'PowerSync stopped 3 times.', detail: 'postgres query failed', remedy: 'Try again starts a fresh PowerSync container.', from: 'starting' });
});

test('blocks: the picker, the installs, the pulls and an error take the screen; the two waits do not on a warm boot (F9)', () => {
  assert.equal(blocks({ phase: 'no-engine', picked: 'colima' }, true), true);
  assert.equal(blocks({ phase: 'installing', runtime: 'colima', items: [], vm: 'pending' }, true), true);
  assert.equal(blocks({ phase: 'downloading', items: [] }, true), true);
  assert.equal(blocks({ phase: 'updating', version: '1', items: [] }, true), true);
  assert.equal(blocks({ phase: 'error', message: 'x', from: 'starting' }, true), true);
  assert.equal(blocks({ phase: 'engine-starting', engine: 'colima' }, false), true);
  assert.equal(blocks({ phase: 'engine-starting', engine: 'colima' }, true), false);
  assert.equal(blocks({ phase: 'starting', services: [] }, false), true);
  assert.equal(blocks({ phase: 'starting', services: [] }, true), false);
  assert.equal(blocks({ phase: 'ready', version: '1', engine: 'colima' }, false), false);
});

test('the version gate refuses a stack behind the app, and an unreadable one', () => {
  assert.equal(stackBehind('0.131.9', '0.132.0'), true);
  assert.equal(stackBehind('0.132.0', '0.132.0'), false);
  assert.equal(stackBehind('0.133.0', '0.132.0'), false, 'a newer stack is not behind');
  assert.equal(stackBehind(null, '0.132.0'), true);
  assert.equal(stackBehind('', '0.132.0'), true);
  assert.equal(stackBehind('0.132.0-beta', '0.132.0'), false);
});
