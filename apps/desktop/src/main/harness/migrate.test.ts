// Brain migration (docs/harness/01 §8). Run: pnpm exec tsx --test src/main/harness/migrate.test.ts
//
// This code MOVES USER DATA, so the tests are about the ways it could destroy some: a lost WAL, a
// half-copy that removed the original, a re-run that double-migrates, and a session file riding along
// into something designed to be exported.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planMigration, migrateBrain, alreadyMigrated, resolveStatePath, resolveIdentityPath, identityFiles, adoptLegacyDir, planChatAdoption, legacyChatDirName, SQLITE_SIBLINGS } from './migrate';
import { legacyChatWorkspaceDir } from '../chatmode';

function fixture(): { userData: string; brain: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'nm-migrate-'));
  const userData = join(root, 'userData');
  const brain = join(root, 'brain');
  mkdirSync(userData, { recursive: true });
  mkdirSync(brain, { recursive: true });
  // a replica with a WAL holding committed-but-unflushed rows, as the real one had (4 MB of it)
  writeFileSync(join(userData, 'neuramesh.db'), 'REPLICA-MAIN');
  writeFileSync(join(userData, 'neuramesh.db-wal'), 'REPLICA-WAL-COMMITTED-ROWS');
  writeFileSync(join(userData, 'neuramesh.db-shm'), 'SHM');
  writeFileSync(join(userData, 'agent-logs.db'), 'ACTIVITY');
  writeFileSync(join(userData, 'agent-logs.db-wal'), 'ACTIVITY-WAL');
  writeFileSync(join(userData, 'replica.json'), '{"workspaceId":"ws-1"}');
  mkdirSync(join(userData, 'attachments', 'nested'), { recursive: true });
  writeFileSync(join(userData, 'attachments', 'a.png'), 'PNG');
  writeFileSync(join(userData, 'attachments', 'nested', 'b.png'), 'PNG2');
  // credentials that must NEVER travel
  writeFileSync(join(userData, 'clerk-session.json'), '{"session":"secret"}');
  writeFileSync(join(userData, 'session.json'), '{"session":"secret"}');
  // legacy top-level dirs that belong in cache/
  mkdirSync(join(brain, 'worktrees', 'nm-1'), { recursive: true });
  writeFileSync(join(brain, 'worktrees', 'nm-1', 'file.ts'), 'code');
  mkdirSync(join(brain, 'repos', 'r1'), { recursive: true });
  writeFileSync(join(brain, 'repos', 'r1', 'x'), 'clone');
  return { userData, brain, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('the plan moves state, identity and attachments — and NEVER a session', () => {
  const f = fixture();
  try {
    const { steps } = planMigration(f.userData, f.brain);
    const what = steps.map((s) => s.what);
    assert.ok(what.includes('replica'));
    assert.ok(what.includes('activity log'));
    assert.ok(what.includes('workspace identity'));
    assert.ok(what.includes('attachments'));
    assert.ok(what.includes('worktrees') && what.includes('repo clones'));
    // doctrine §5.4 — a brain is designed to be exported; a session in it would carry an
    // authenticated identity to another machine
    for (const s of steps) {
      assert.ok(!s.from.includes('session'), `${s.from} must never be migrated`);
      assert.ok(!s.to.includes('session'));
    }
  } finally { f.cleanup(); }
});

test('WAL and SHM travel with their database — or committed rows vanish', () => {
  const f = fixture();
  try {
    const r = migrateBrain(f.userData, f.brain);
    assert.equal(r.ok, true, JSON.stringify(r.failed));
    assert.equal(readFileSync(join(f.brain, 'state', 'replica.db'), 'utf8'), 'REPLICA-MAIN');
    assert.equal(readFileSync(join(f.brain, 'state', 'replica.db-wal'), 'utf8'), 'REPLICA-WAL-COMMITTED-ROWS',
      'the WAL holds committed transactions not yet in the main file');
    assert.ok(existsSync(join(f.brain, 'state', 'replica.db-shm')));
    assert.equal(readFileSync(join(f.brain, 'state', 'activity.db-wal'), 'utf8'), 'ACTIVITY-WAL');
    // and the originals are gone only AFTER the copy verified
    for (const s of SQLITE_SIBLINGS) assert.ok(!existsSync(join(f.userData, `neuramesh.db${s}`)));
  } finally { f.cleanup(); }
});

test('a nested attachments tree survives intact', () => {
  const f = fixture();
  try {
    migrateBrain(f.userData, f.brain);
    assert.equal(readFileSync(join(f.brain, 'attachments', 'a.png'), 'utf8'), 'PNG');
    assert.equal(readFileSync(join(f.brain, 'attachments', 'nested', 'b.png'), 'utf8'), 'PNG2');
    assert.ok(!existsSync(join(f.userData, 'attachments')));
  } finally { f.cleanup(); }
});

test('worktrees and clones land in cache/ — the tier that never gets exported', () => {
  const f = fixture();
  try {
    migrateBrain(f.userData, f.brain);
    assert.equal(readFileSync(join(f.brain, 'cache', 'worktrees', 'nm-1', 'file.ts'), 'utf8'), 'code');
    assert.ok(existsSync(join(f.brain, 'cache', 'repos', 'r1', 'x')));
    assert.ok(!existsSync(join(f.brain, 'worktrees')), 'the legacy top-level dir is gone');
  } finally { f.cleanup(); }
});

test('sessions are still in userData afterwards — untouched, by design', () => {
  const f = fixture();
  try {
    migrateBrain(f.userData, f.brain);
    assert.equal(readFileSync(join(f.userData, 'clerk-session.json'), 'utf8'), '{"session":"secret"}');
    assert.ok(existsSync(join(f.userData, 'session.json')));
    assert.ok(!existsSync(join(f.brain, 'identity', 'clerk-session.json')));
  } finally { f.cleanup(); }
});

test('the success marker is written ONLY when every step landed', () => {
  const f = fixture();
  try {
    assert.equal(alreadyMigrated(f.brain), false);
    const r = migrateBrain(f.userData, f.brain);
    assert.equal(r.ok, true);
    assert.equal(alreadyMigrated(f.brain), true);
    const manifest = JSON.parse(readFileSync(join(f.brain, 'brain.json'), 'utf8')) as { schemaVersion: number; migratedAt: string };
    assert.ok(manifest.migratedAt, 'a partial migration must be detectable by this being absent');
    assert.ok(manifest.schemaVersion >= 1);
  } finally { f.cleanup(); }
});

test('IDEMPOTENT — a second run moves nothing and reports what it skipped', () => {
  const f = fixture();
  try {
    const first = migrateBrain(f.userData, f.brain);
    assert.ok(first.moved.length > 0);
    const second = migrateBrain(f.userData, f.brain);
    assert.equal(second.ok, true);
    assert.deepEqual(second.moved, [], 'nothing moves twice');
    assert.equal(readFileSync(join(f.brain, 'state', 'replica.db'), 'utf8'), 'REPLICA-MAIN', 'and the destination is not clobbered');
  } finally { f.cleanup(); }
});

test('a resumed run finishes what an interrupted one started', () => {
  const f = fixture();
  try {
    // simulate an interruption: the replica made it, nothing else did
    mkdirSync(join(f.brain, 'state'), { recursive: true });
    writeFileSync(join(f.brain, 'state', 'replica.db'), 'REPLICA-MAIN');
    const plan = planMigration(f.userData, f.brain);
    assert.ok(plan.skipped.includes('replica'), 'the done step is skipped, not redone');
    const r = migrateBrain(f.userData, f.brain);
    assert.equal(r.ok, true);
    assert.ok(existsSync(join(f.brain, 'state', 'activity.db')), 'the rest completes');
  } finally { f.cleanup(); }
});

test('FAILURE IS SAFE — a step that cannot copy leaves its original and blocks the marker', () => {
  const f = fixture();
  try {
    // make the destination parent unwritable so the attachments copy fails
    mkdirSync(join(f.brain, 'attachments'), { recursive: true });
    rmSync(join(f.brain, 'attachments'), { recursive: true, force: true });
    const blocked = join(f.brain, 'attachments');
    writeFileSync(blocked, 'NOT-A-DIR'); // a FILE where a dir must go → copy must fail
    const r = migrateBrain(f.userData, f.brain);
    assert.equal(r.ok, false);
    assert.ok(r.failed.some((x) => x.what === 'attachments'));
    assert.ok(existsSync(join(f.userData, 'attachments', 'a.png')), 'the original survives a failed copy');
    assert.equal(alreadyMigrated(f.brain), false, 'and the marker is withheld, so the next launch retries');
    // the steps that DID work still landed — one failure must not block the replica
    assert.ok(existsSync(join(f.brain, 'state', 'replica.db')));
  } finally { f.cleanup(); }
});

test('dryRun plans without touching anything', () => {
  const f = fixture();
  try {
    const r = migrateBrain(f.userData, f.brain, { dryRun: true });
    assert.ok(r.moved.length > 0);
    assert.ok(existsSync(join(f.userData, 'neuramesh.db')), 'nothing moved');
    assert.ok(!existsSync(join(f.brain, 'state', 'replica.db')));
    assert.equal(alreadyMigrated(f.brain), false);
  } finally { f.cleanup(); }
});

test('a fresh install has nothing to migrate and is marked done', () => {
  const root = mkdtempSync(join(tmpdir(), 'nm-fresh-'));
  try {
    const r = migrateBrain(join(root, 'userData'), join(root, 'brain'));
    assert.equal(r.ok, true);
    assert.deepEqual(r.moved, []);
    assert.equal(alreadyMigrated(join(root, 'brain')), true, 'a fresh brain is not re-planned every boot');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('resolveStatePath keeps an un-migrated profile bootable — failure is non-fatal', () => {
  const f = fixture();
  try {
    // before migration: the legacy file wins
    assert.equal(resolveStatePath('replica', f.userData, f.brain), join(f.userData, 'neuramesh.db'));
    assert.equal(resolveStatePath('activity', f.userData, f.brain), join(f.userData, 'agent-logs.db'));
    migrateBrain(f.userData, f.brain);
    // after: the new one
    assert.equal(resolveStatePath('replica', f.userData, f.brain), join(f.brain, 'state', 'replica.db'));
  } finally { f.cleanup(); }
});

test('neither present → the new path, so a first run creates it in the right place', () => {
  const root = mkdtempSync(join(tmpdir(), 'nm-none-'));
  try {
    assert.equal(resolveStatePath('replica', join(root, 'u'), join(root, 'b')), join(root, 'b', 'state', 'replica.db'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ── The identity marker + sign-out wipe (the bug the migration introduced) ────────────────────
test('the identity marker resolves to the migrated path once it exists', () => {
  const f = fixture();
  try {
    assert.equal(resolveIdentityPath(f.userData, f.brain), join(f.userData, 'replica.json'), 'un-migrated: legacy');
    migrateBrain(f.userData, f.brain);
    assert.equal(resolveIdentityPath(f.userData, f.brain), join(f.brain, 'identity', 'workspaces.json'),
      'migrated: the new path — otherwise the app recreates the legacy copy and there are two markers');
  } finally { f.cleanup(); }
});

test('SIGN-OUT wipes the replica wherever it lives — before AND after migration', () => {
  // The wipe list was hardcoded to the old userData names, so after migrating, signing out silently
  // left the previous identity's synced rows on disk for the next sign-in to read.
  const f = fixture();
  try {
    const before = identityFiles(f.userData, f.brain);
    assert.ok(before.some((p) => p.endsWith(join('state', 'replica.db'))), 'covers the migrated replica');
    assert.ok(before.some((p) => p.endsWith('neuramesh.db')), 'and the legacy one');
    assert.ok(before.some((p) => p.endsWith('replica.db-wal')), 'WAL too — it holds committed rows');
    assert.ok(before.some((p) => p.endsWith(join('identity', 'workspaces.json'))));

    migrateBrain(f.userData, f.brain);
    const { rmSync: rm } = require('node:fs') as typeof import('node:fs');
    for (const p of identityFiles(f.userData, f.brain)) rm(p, { force: true });
    assert.ok(!existsSync(join(f.brain, 'state', 'replica.db')), 'the migrated replica is gone');
    assert.ok(!existsSync(join(f.brain, 'state', 'replica.db-wal')));
    assert.ok(!existsSync(join(f.brain, 'identity', 'workspaces.json')));
    // and the things sign-out must NOT touch are still there
    assert.ok(existsSync(join(f.brain, 'state', 'activity.db')), 'the activity log is machine history, not identity');
    assert.ok(existsSync(join(f.userData, 'clerk-session.json')), 'clerkLogout owns the session, not this list');
  } finally { f.cleanup(); }
});

// ── Lazy per-conversation adoption (docs/harness/01 §8, the chats/ → subjects/ merge) ─────────
// Not a planMigration step, and the reason is arithmetic: the legacy name kept 12 characters of the
// de-hyphenated thread id and the brain slug keeps 16, so the mapping is one-way. The caller that
// opens a workspace holds the exact id; a bulk sweep would have to guess.

function dirs(): { from: string; to: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'nm-adopt-'));
  return { from: join(root, 'chats', 'nm-abc123'), to: join(root, 'subjects', 'thread-abc123def456', 'workspace'), cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('a legacy conversation directory is adopted, verified, then removed', () => {
  const d = dirs();
  try {
    mkdirSync(join(d.from, 'nested'), { recursive: true });
    writeFileSync(join(d.from, 'report.md'), 'the draft');
    writeFileSync(join(d.from, 'nested', 'notes.md'), 'deeper');

    assert.equal(adoptLegacyDir(d.from, d.to), 'adopted');
    assert.equal(readFileSync(join(d.to, 'report.md'), 'utf8'), 'the draft');
    assert.equal(readFileSync(join(d.to, 'nested', 'notes.md'), 'utf8'), 'deeper', 'subdirectories travel too');
    assert.ok(!existsSync(d.from), 'the original is removed only after the copy verified');
  } finally { d.cleanup(); }
});

test('adoption is idempotent and never merges two histories', () => {
  const d = dirs();
  try {
    // nothing to adopt
    assert.equal(adoptLegacyDir(d.from, d.to), 'nothing');

    // a destination that already has content WINS — a conversation whose files are half from each
    // place is worse than one that kept the newer set
    mkdirSync(d.to, { recursive: true });
    writeFileSync(join(d.to, 'current.md'), 'the live one');
    mkdirSync(d.from, { recursive: true });
    writeFileSync(join(d.from, 'stale.md'), 'the old one');

    assert.equal(adoptLegacyDir(d.from, d.to), 'kept-existing');
    assert.ok(!existsSync(join(d.to, 'stale.md')), 'the legacy copy was not merged in');
    assert.ok(existsSync(join(d.from, 'stale.md')), 'and it was not destroyed either');
  } finally { d.cleanup(); }
});

test('an empty destination does not block adoption', () => {
  // mkdir-then-adopt is the real call order, so an existing-but-empty dir must not read as "kept"
  const d = dirs();
  try {
    mkdirSync(d.to, { recursive: true });
    mkdirSync(d.from, { recursive: true });
    writeFileSync(join(d.from, 'draft.md'), 'x');
    assert.equal(adoptLegacyDir(d.from, d.to), 'adopted');
    assert.ok(existsSync(join(d.to, 'draft.md')));
  } finally { d.cleanup(); }
});

test('a file where the legacy directory should be is not adopted', () => {
  const d = dirs();
  try {
    mkdirSync(join(d.from, '..'), { recursive: true });
    writeFileSync(d.from, 'not a directory');
    assert.equal(adoptLegacyDir(d.from, d.to), 'nothing');
    assert.ok(existsSync(d.from), 'and it is left alone');
  } finally { d.cleanup(); }
});

// ── The orphan sweep: matching what is on disk to what the replica knows ──────────────────────
// Lazy adoption only reaches a conversation somebody reopens. The sweep needs the thread ids to
// invert the 12-character name, which is why it runs in the daemon and not in the boot migration.

test('the two spellings of the legacy name agree', () => {
  // migrate.ts spells this itself rather than importing the chat layer, so the pairing is pinned
  // here — a divergence between them is what produced the whole two-homes bug in the first place
  const t = '7d4f1a2b-9c3e-4a5b-8d6f-1e2c3b4a5d6e';
  assert.ok(legacyChatWorkspaceDir('/home/g', t).endsWith(legacyChatDirName(t)));
});

test('every legacy dir is matched back to the thread that owns it', () => {
  const ids = ['7d4f1a2b-9c3e-4a5b-8d6f-1e2c3b4a5d6e', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'];
  const dirs = ids.map(legacyChatDirName);
  const { matched, unmatched } = planChatAdoption(dirs, ids);
  assert.deepEqual(matched.map((m) => m.threadId), ids);
  assert.deepEqual(unmatched, []);
});

test('a directory with no matching thread is reported, never deleted', () => {
  // it is either a thread that has not synced yet or something we did not write — neither is ours
  // to remove, and a silent delete of a user's files is the one unrecoverable outcome here
  const id = '7d4f1a2b-9c3e-4a5b-8d6f-1e2c3b4a5d6e';
  const { matched, unmatched } = planChatAdoption([legacyChatDirName(id), 'nm-deadbeef1234', 'not-ours'], [id]);
  assert.deepEqual(matched.map((m) => m.dir), [legacyChatDirName(id)]);
  assert.deepEqual(unmatched, ['nm-deadbeef1234', 'not-ours']);
});

test('a thread with no legacy directory is simply absent from the plan', () => {
  const { matched, unmatched } = planChatAdoption([], ['7d4f1a2b-9c3e-4a5b-8d6f-1e2c3b4a5d6e']);
  assert.deepEqual(matched, []);
  assert.deepEqual(unmatched, []);
});

test('a name two threads could both own is left alone, not guessed', () => {
  // The legacy name keeps 12 hex characters, so ids sharing that prefix produce ONE directory name.
  // 48 bits makes it vanishingly unlikely with real uuids — but the failure mode if it does happen
  // is handing one conversation's files to another, which is not a thing to leave to chance.
  const a = '7d4f1a2b-9c3e-4a5b-8d6f-1e2c3b4a5d6e';
  const b = '7d4f1a2b-9c3e-0000-0000-000000000000'; // same first 12 hex chars
  assert.equal(legacyChatDirName(a), legacyChatDirName(b), 'the collision is real, not hypothetical');

  const { matched, ambiguous, unmatched } = planChatAdoption([legacyChatDirName(a)], [a, b]);
  assert.deepEqual(matched, [], 'neither thread wins it');
  assert.deepEqual(ambiguous, [legacyChatDirName(a)]);
  assert.deepEqual(unmatched, []);
});

test('distinct thread ids still map one-to-one', () => {
  const a = '7d4f1a2b-9c3e-4a5b-8d6f-1e2c3b4a5d6e';
  const b = 'ffffffff-0000-4a5b-8d6f-1e2c3b4a5d6e';
  const { matched, ambiguous } = planChatAdoption([legacyChatDirName(a), legacyChatDirName(b)], [a, b]);
  assert.equal(matched.length, 2);
  assert.deepEqual(ambiguous, []);
  assert.notEqual(matched[0]!.threadId, matched[1]!.threadId);
});
