// The move's words pass the STE check, and the door rule. Run from apps/desktop:
//   pnpm exec tsx --test src/renderer/src/shell/move-copy.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmtBytes, MOVE_COPY, moveDoorFor } from './move-copy';

/** every string the copy object can produce, with sample arguments for the functions */
function everyString(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (typeof v === 'function') out.push(String((v as (...a: unknown[]) => unknown)('Acme Robotics', 34, 'x', 'Flowe')));
  else if (v && typeof v === 'object') for (const x of Object.values(v)) everyString(x, out);
  return out;
}

test('MOVE_COPY: no em dash, no semicolon, in any sentence (CLAUDE.md #11)', () => {
  const all = everyString(MOVE_COPY);
  all.push(MOVE_COPY.refusal.PLAN_LIMIT({ allocationBytes: 50 * 1024 ** 3, usedBytes: 49 * 1024 ** 3, totalBytes: 2 * 1024 ** 3 }), MOVE_COPY.refusal.PLAN_LIMIT(undefined), MOVE_COPY.refusal.FAILED(undefined), MOVE_COPY.moved.sub(3, 34, '1.2 GB', 'Flowe'), MOVE_COPY.stopped(3, 9));
  assert.ok(all.length > 30);
  for (const s of all) {
    assert.ok(!s.includes('—'), `em dash in ${JSON.stringify(s)}`);
    assert.ok(!s.includes(';'), `semicolon in ${JSON.stringify(s)}`);
  }
  // the artboards' words, verbatim
  assert.equal(MOVE_COPY.title('Acme Robotics'), 'Migrate Acme Robotics to Cloud');
  assert.equal(MOVE_COPY.moved.sub(3, 34, '1.2 GB', 'Flowe'), '3 projects, 34 threads, and 1.2 GB are in Flowe. The local copy stays on this Mac as a backup.');
  assert.equal(MOVE_COPY.moved.open('Flowe'), 'Open in Flowe');
  assert.equal(MOVE_COPY.staysLine, 'Keys and sign-ins · files on disk · the local copy, as a backup');
});

test('the refusals name their numbers and their table', () => {
  assert.equal(MOVE_COPY.refusal.PLAN_LIMIT({ allocationBytes: 50 * 1024 ** 3, usedBytes: 49 * 1024 ** 3, totalBytes: 2 * 1024 ** 3 }), 'This plan has 1 GB left of 50 GB, and the migration needs 2 GB.');
  assert.equal(MOVE_COPY.refusal.IMPORT_ORDER('tasks'), 'The migration stopped at tasks. Choose Migrate to Cloud to continue.');
});

test('fmtBytes: one decimal above the unit, none below it, never negative', () => {
  assert.equal(fmtBytes(0), '0 B');
  assert.equal(fmtBytes(512), '512 B');
  assert.equal(fmtBytes(12 * 1024), '12 KB');
  assert.equal(fmtBytes(1.2 * 1024 ** 3), '1.2 GB');
  assert.equal(fmtBytes(10 * 1024 ** 3), '10 GB');
  assert.equal(fmtBytes(-5), '0 B');
});

const local = { kind: 'local', workspaces: [{ plan: 'free' }] } as const;
const cloudPro = { kind: 'cloud', workspaces: [{ plan: 'free' }, { plan: 'cloud' }] } as const;
const cloudFree = { kind: 'cloud', workspaces: [{ plan: 'free' }] } as const;
type Card = Parameters<typeof moveDoorFor>[0] extends ReadonlyArray<infer T> | null ? T : never;
const cards = (...c: Array<Record<string, unknown>>) => c as unknown as Card[];

test('moveDoorFor: the move needs a local workspace and a Pro cloud workspace, else the Upgrade sheet, else no door', () => {
  assert.equal(moveDoorFor(null), 'none');
  assert.equal(moveDoorFor(cards(cloudPro)), 'none', 'no local workspace, nothing to move');
  assert.equal(moveDoorFor(cards(local)), 'upgrade', 'no cloud connection');
  assert.equal(moveDoorFor(cards(local, cloudFree)), 'upgrade', 'a cloud connection on Free');
  assert.equal(moveDoorFor(cards(local, cloudPro)), 'move');
  assert.equal(moveDoorFor(cards(local, cloudFree), 'cloud'), 'move', 'the shell already knows the plan flipped');
  assert.equal(moveDoorFor(cards({ ...local, moved: { movedAt: 'x' } }, cloudPro)), 'none', 'a moved workspace shows its row, not a second door');
});
