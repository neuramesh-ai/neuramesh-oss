// Brain migration (docs/harness/01 §8) — consolidating local state onto ONE root.
//
// Before: state was split across Electron's `userData` (the replica, the activity log, attachments,
// the identity marker) and `~/.neuramesh` (worktrees, deliverables, chats, repos). Nothing owned
// "local state", so it could not be backed up, moved, or found by a non-Electron process — which is
// what blocks the headless harness (docs/harness/09) outright.
//
// After: `~/.neuramesh` is the root, tiered by durability so it can be exported (§4).
//
// ── The rules, and why each one is load-bearing ────────────────────────────────────────────────
//  1. COPY, verify, then remove. Never move. A move that fails halfway has destroyed the original;
//     a copy that fails halfway has cost only disk.
//  2. Idempotent. Every step re-checks its own destination, so an interrupted run resumes instead of
//     double-migrating or bailing.
//  3. `brain.json.migratedAt` is written ONLY on full success. A partial migration is therefore
//     detectable and retried, rather than mistaken for a finished one.
//  4. App-closed. Moving a live SQLite replica corrupts it (the NM_USERDATA lesson), so this runs
//     before sync opens anything.
//  5. Failure is NON-FATAL. The app keeps running on the old paths and says so. A migration that
//     bricks a boot is worse than one that waits for the next release.
//
// Run: pnpm exec tsx --test src/main/harness/migrate.test.ts
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BRAIN_SCHEMA_VERSION } from './brain';

export interface MigrationStep {
  /** what moved, for the log and the tests */
  what: string;
  from: string;
  to: string;
  kind: 'sqlite' | 'file' | 'dir';
}

export interface MigrationPlan {
  steps: MigrationStep[];
  /** already done (destination present) — reported, not silently skipped */
  skipped: string[];
}

/**
 * SQLite databases travel with their `-wal` and `-shm` siblings.
 *
 * A WAL holds COMMITTED transactions that are not yet in the main file. Copying `x.db` alone from a
 * database with a 4 MB WAL silently loses everything in it — which for the replica is the newest
 * synced rows and for the activity log is the most recent runs. Both were exactly that size when this
 * was written, so this is not a hypothetical.
 */
export const SQLITE_SIBLINGS = ['', '-wal', '-shm'];

/**
 * What moves where. Pure, so the plan can be asserted without touching a disk.
 *
 * Sessions are deliberately ABSENT: `clerk-session.json` / `session.json` stay machine-bound, because
 * the brain is designed to be exported and a brain carrying a live session would silently carry an
 * authenticated identity to another machine (docs/harness/01 §4.4, doctrine §5.4).
 */
export function planMigration(userData: string, brain: string): MigrationPlan {
  const candidates: MigrationStep[] = [
    { what: 'replica', from: join(userData, 'neuramesh.db'), to: join(brain, 'state', 'replica.db'), kind: 'sqlite' },
    { what: 'activity log', from: join(userData, 'agent-logs.db'), to: join(brain, 'state', 'activity.db'), kind: 'sqlite' },
    { what: 'workspace identity', from: join(userData, 'replica.json'), to: join(brain, 'identity', 'workspaces.json'), kind: 'file' },
    { what: 'attachments', from: join(userData, 'attachments'), to: join(brain, 'attachments'), kind: 'dir' },
    // legacy top-level dirs → their tier. Worktrees and clones are Tier C: absolute-path bound to a
    // repo, so they BREAK if an export carried them (§4.3) — `cache/` is what keeps them out.
    { what: 'worktrees', from: join(brain, 'worktrees'), to: join(brain, 'cache', 'worktrees'), kind: 'dir' },
    { what: 'repo clones', from: join(brain, 'repos'), to: join(brain, 'cache', 'repos'), kind: 'dir' },
    { what: 'design scratch', from: join(brain, 'design'), to: join(brain, 'cache', 'design'), kind: 'dir' },
    { what: 'plan scratch', from: join(brain, 'plan'), to: join(brain, 'cache', 'plan'), kind: 'dir' },
  ];
  const steps: MigrationStep[] = [];
  const skipped: string[] = [];
  for (const c of candidates) {
    if (!existsSync(c.from)) continue; // nothing to move
    // "already migrated" must mean the destination is the RIGHT KIND of thing. A bare existsSync
    // treats a stray file where a directory belongs as done, which would silently strand the original
    // forever with no warning — found by the failure-path test, which could not produce a failure.
    if (migratedAlready(c)) { skipped.push(c.what); continue; }
    steps.push(c);
  }
  return { steps, skipped };
}

/** Is this step's destination genuinely in place — present AND of the expected type? */
function migratedAlready(step: MigrationStep): boolean {
  if (!existsSync(step.to)) return false;
  try {
    const st = statSync(step.to);
    return step.kind === 'dir' ? st.isDirectory() : st.isFile();
  } catch {
    return false;
  }
}

export interface MigrationResult {
  ok: boolean;
  moved: string[];
  skipped: string[];
  failed: Array<{ what: string; error: string }>;
}

/** Has this brain already been migrated? Reads the marker written only on full success. */
export function alreadyMigrated(brain: string): boolean {
  try {
    return !!(JSON.parse(readFileSync(join(brain, 'brain.json'), 'utf8')) as { migratedAt?: string }).migratedAt;
  } catch {
    return false;
  }
}

function copyDir(from: string, to: string): void {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from)) {
    const src = join(from, entry);
    const dst = join(to, entry);
    if (statSync(src).isDirectory()) copyDir(src, dst);
    else copyFileSync(src, dst);
  }
}

function sameSize(a: string, b: string): boolean {
  try { return statSync(a).size === statSync(b).size; } catch { return false; }
}

/** Every file under a dir, relative — the verification set for a directory copy. */
function fileList(root: string, prefix = ''): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root)) {
    const p = join(root, entry);
    if (statSync(p).isDirectory()) out.push(...fileList(p, join(prefix, entry)));
    else out.push(join(prefix, entry));
  }
  return out;
}

/**
 * Run the migration.
 *
 * `dryRun` plans and verifies nothing is destroyed — used by the test and available as an ops check.
 * A step that fails leaves its ORIGINAL intact and is reported; the rest still proceed, because a
 * failed attachments copy should not block the replica from moving.
 */
export function migrateBrain(userData: string, brain: string, opts: { dryRun?: boolean; log?: (line: string) => void } = {}): MigrationResult {
  const { steps, skipped } = planMigration(userData, brain);
  const result: MigrationResult = { ok: true, moved: [], skipped, failed: [] };
  if (!steps.length) {
    opts.log?.(skipped.length ? `brain migration: nothing to do (${skipped.length} already migrated)` : 'brain migration: nothing to do');
    if (!opts.dryRun) stampMigrated(brain);
    return result;
  }
  opts.log?.(`brain migration: ${steps.length} item(s) to move → ${brain}`);

  for (const step of steps) {
    try {
      if (opts.dryRun) { result.moved.push(step.what); continue; }
      mkdirSync(join(step.to, '..'), { recursive: true });
      if (step.kind === 'sqlite') {
        // the db AND its WAL/SHM, or committed rows are lost (see SQLITE_SIBLINGS)
        for (const suffix of SQLITE_SIBLINGS) {
          const from = `${step.from}${suffix}`;
          if (existsSync(from)) copyFileSync(from, `${step.to}${suffix}`);
        }
        if (!sameSize(step.from, step.to)) throw new Error('copy verification failed (size mismatch)');
        for (const suffix of SQLITE_SIBLINGS) rmSync(`${step.from}${suffix}`, { force: true });
      } else if (step.kind === 'file') {
        copyFileSync(step.from, step.to);
        if (!sameSize(step.from, step.to)) throw new Error('copy verification failed (size mismatch)');
        rmSync(step.from, { force: true });
      } else {
        copyDir(step.from, step.to);
        const before = fileList(step.from).sort();
        const after = fileList(step.to).sort();
        if (before.length !== after.length) throw new Error(`copy verification failed (${before.length} files in, ${after.length} out)`);
        rmSync(step.from, { recursive: true, force: true });
      }
      result.moved.push(step.what);
      opts.log?.(`  ✓ ${step.what}`);
    } catch (err) {
      // the ORIGINAL is still there — that is the whole point of copy-then-remove
      const error = err instanceof Error ? err.message : 'copy failed';
      result.failed.push({ what: step.what, error });
      result.ok = false;
      opts.log?.(`  ✗ ${step.what}: ${error} — the original is untouched`);
    }
  }

  if (result.ok && !opts.dryRun) stampMigrated(brain);
  else if (!result.ok) opts.log?.('brain migration incomplete — the app keeps using the old paths and will retry next launch');
  return result;
}

/**
 * Adopt one legacy directory into its new home, lazily, at first use.
 *
 * Why this is not a `planMigration` step. A conversation's files lived at `chats/nm-<12 chars of the
 * de-hyphenated thread id>` and belong at `subjects/thread-<16 chars>/workspace/` — and **16 chars
 * cannot be recovered from 12**. A bulk sweep would have to guess which thread each legacy directory
 * belonged to; the caller that opens a workspace already holds the exact thread id, so the mapping is
 * done where it is knowable rather than inferred where it is not.
 *
 * Same three rules as the bulk migration: copy, verify, then remove; idempotent (a destination that
 * already exists wins and the legacy copy is left alone rather than merged blindly); and failure is
 * non-fatal — the turn runs on a fresh empty workspace rather than not running.
 */
export function adoptLegacyDir(from: string, to: string, log?: (line: string) => void): 'adopted' | 'nothing' | 'kept-existing' | 'failed' {
  try {
    if (!existsSync(from) || !statSync(from).isDirectory()) return 'nothing';
    // a destination with content already won — merging two histories silently is how you get a
    // conversation whose files are half from each
    if (existsSync(to) && readdirSync(to).length > 0) return 'kept-existing';
    copyDir(from, to);
    const before = fileList(from).sort();
    const after = fileList(to).sort();
    if (before.length !== after.length) throw new Error(`copy verification failed (${before.length} in, ${after.length} out)`);
    rmSync(from, { recursive: true, force: true });
    log?.(`brain: adopted ${before.length} file(s) from ${from} → ${to}`);
    return 'adopted';
  } catch (err) {
    // the ORIGINAL is still there; the turn proceeds on the new (empty) directory
    log?.(`brain: could not adopt ${from}: ${err instanceof Error ? err.message : 'copy failed'} — the original is untouched`);
    return 'failed';
  }
}

/**
 * The legacy conversation name, as `chatWorkspaceDir` used to spell it.
 *
 * Duplicated from `chatmode.ts` deliberately: this module must not import the chat layer to run a
 * migration, and the brain's own rule is that a path spelled in two places gets moved in one. The
 * pairing is pinned by a test that asserts both spellings agree.
 */
export const legacyChatDirName = (threadId: string): string => `nm-${threadId.replace(/-/g, '').slice(0, 12)}`;

/**
 * Match every orphaned `chats/` directory to the thread that owns it.
 *
 * Lazy adoption (§8.1) only reaches a conversation somebody reopens, so a room's older threads keep
 * their pre-merge directory indefinitely — harmless, since nothing reads it, but it means `chats/`
 * never empties and the two-homes shape survives on disk for anyone looking at it later.
 *
 * The 12→16 mapping is one-way, so this needs the thread ids — which the DAEMON has and the boot
 * migration does not (it runs before the replica is open, because moving a live SQLite file corrupts
 * it). Hence a sweep rather than a migration step. Pure, so the matching is testable without a disk:
 * callers pass what is on disk and what the replica knows.
 *
 * A directory with no matching thread is REPORTED rather than deleted — an unrecognised directory is
 * either a thread that has not synced yet or something we did not write, and neither is ours to
 * remove.
 *
 * So is an AMBIGUOUS one. The legacy name keeps 12 hex characters, so two threads whose ids share
 * that prefix produce the same directory name — 48 bits, so vanishingly unlikely with real uuids,
 * but "unlikely" is not "impossible" and the failure mode is silently handing one conversation's
 * files to another. A name that matches more than one thread is left alone and named.
 */
export function planChatAdoption(
  legacyDirs: readonly string[],
  threadIds: readonly string[],
): { matched: Array<{ dir: string; threadId: string }>; unmatched: string[]; ambiguous: string[] } {
  const byName = new Map<string, string[]>();
  for (const id of threadIds) {
    const name = legacyChatDirName(id);
    byName.set(name, [...(byName.get(name) ?? []), id]);
  }
  const matched: Array<{ dir: string; threadId: string }> = [];
  const unmatched: string[] = [];
  const ambiguous: string[] = [];
  for (const dir of legacyDirs) {
    const ids = byName.get(dir) ?? [];
    if (ids.length === 1) matched.push({ dir, threadId: ids[0]! });
    else if (ids.length > 1) ambiguous.push(dir);
    else unmatched.push(dir);
  }
  return { matched, unmatched, ambiguous };
}

/** Write the success marker. Only reached when every step landed. */
function stampMigrated(brain: string): void {
  try {
    mkdirSync(brain, { recursive: true });
    const p = join(brain, 'brain.json');
    const cur = existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>) : {};
    writeFileSync(p, JSON.stringify({ ...cur, schemaVersion: BRAIN_SCHEMA_VERSION, migratedAt: new Date().toISOString() }, null, 2));
  } catch { /* a missing marker only costs a re-plan next boot, which is idempotent */ }
}

/**
 * Where the app should read each database, honouring a migration that has not run (or failed).
 *
 * This is what makes failure non-fatal: the caller asks for a path rather than assuming one, so an
 * un-migrated or half-migrated profile still boots — on the old files.
 */
export function resolveStatePath(name: 'replica' | 'activity', userData: string, brain: string): string {
  const migrated = name === 'replica' ? join(brain, 'state', 'replica.db') : join(brain, 'state', 'activity.db');
  if (existsSync(migrated)) return migrated;
  const legacy = name === 'replica' ? join(userData, 'neuramesh.db') : join(userData, 'agent-logs.db');
  return existsSync(legacy) ? legacy : migrated; // neither exists → the new path, freshly created
}

/**
 * The workspace-identity marker's path, post-migration with a legacy fallback.
 *
 * Same resolve-don't-assume rule as `resolveStatePath`: an un-migrated profile keeps reading
 * `userData/replica.json`, and a migrated one reads `identity/workspaces.json`. Without this the
 * migration moved the marker and the app promptly recreated it at the old path, leaving TWO identity
 * markers and no single answer to "which workspace is this replica".
 */
export function resolveIdentityPath(userData: string, brain: string): string {
  const migrated = join(brain, 'identity', 'workspaces.json');
  if (existsSync(migrated)) return migrated;
  const legacy = join(userData, 'replica.json');
  return existsSync(legacy) ? legacy : migrated;
}

/**
 * Every local file that belongs to the signed-in identity, wherever it currently lives.
 *
 * Sign-out MUST remove all of it: the replica holds the previous identity's synced rows, and leaving
 * it for the next sign-in to read is the wedge `index.ts` already warned about. The migration moved
 * these files and the sign-out path kept deleting the OLD names — so after migrating, signing out
 * silently stopped wiping anything. This is the single list both paths agree through.
 */
export function identityFiles(userData: string, brain: string): string[] {
  const out: string[] = [];
  for (const suffix of SQLITE_SIBLINGS) {
    out.push(join(brain, 'state', `replica.db${suffix}`));
    out.push(join(userData, `neuramesh.db${suffix}`)); // legacy, for an un-migrated profile
  }
  out.push(join(brain, 'identity', 'workspaces.json'));
  out.push(join(userData, 'replica.json'));
  return out;
}
