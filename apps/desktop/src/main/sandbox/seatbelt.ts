// Containment L1b for the agy runtime. agy (Antigravity CLI) has no native sandbox and no PreToolUse
// hook — but we fully own its `spawn`, so we wrap it in macOS Seatbelt via /usr/bin/sandbox-exec. The
// profile is ALLOW-DEFAULT with targeted denies (cred stores + NeuraMesh userData from fsjail), so agy
// keeps working — it can read its own ~/.gemini login, node, its binary — while a reach into the
// sensitive paths is refused at the kernel. Deny is emitted before an allow-back of the worktree, and
// Seatbelt is last-match-wins, so the agent's own workspace wins even if it nests under a denied prefix.
// macOS only; Linux agy stays un-jailed (fail-open) until a bubblewrap wrapper (out of scope).
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

const SANDBOX_EXEC = '/usr/bin/sandbox-exec';
export function sandboxExecAvailable(): boolean {
  return process.platform === 'darwin' && existsSync(SANDBOX_EXEC);
}

// A Seatbelt string literal: double-quoted with `\` and `"` escaped. macOS paths can contain spaces
// (e.g. "~/Library/Application Support/NeuraMesh"); quoting handles those, escaping handles the rest.
function sbpl(p: string): string {
  return `"${p.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

// Generate the SBPL profile: allow everything, deny the sensitive subpaths, then allow the agent's own
// workspace back (last-match-wins insurance against nesting). Absolute paths only — Seatbelt does not
// expand `~` and canonicalizes at enforcement.
export function seatbeltProfile(denySubpaths: readonly string[], allowSubpaths: readonly string[] = []): string {
  const lines = ['(version 1)', '(allow default)'];
  if (denySubpaths.length) {
    lines.push('(deny file-read* file-write*');
    for (const p of denySubpaths) lines.push(`  (subpath ${sbpl(p)})`);
    lines.push(')');
  }
  if (allowSubpaths.length) {
    lines.push('(allow file-read* file-write*');
    for (const p of allowSubpaths) lines.push(`  (subpath ${sbpl(p)})`);
    lines.push(')');
  }
  return lines.join('\n') + '\n';
}

// Resolve symlinks so a deny rule matches the KERNEL's canonical view of a path — Seatbelt canonicalizes
// the accessed path before checking (macOS /var→/private/var, /tmp→/private/tmp, or a symlinked HOME), so
// a rule using the un-resolved path silently misses. Best-effort: realpath the deepest existing ancestor,
// then re-append the missing tail — so a cred dir that doesn't exist on this machine still yields a
// canonical rule (and the sandbox still denies the whole prefix).
export function canonicalPath(p: string): string {
  const tail: string[] = [];
  let head = p;
  for (;;) {
    try { return tail.length ? join(realpathSync(head), ...tail) : realpathSync(head); }
    catch { const parent = dirname(head); if (parent === head) return p; tail.unshift(basename(head)); head = parent; }
  }
}

// Canonicalize the paths, then build the profile. This is the function callers use (seatbeltProfile
// stays pure/string-only for unit tests; the symlink resolution touches the filesystem).
export function buildSeatbeltProfile(denySubpaths: readonly string[], allowSubpaths: readonly string[] = []): string {
  return seatbeltProfile(denySubpaths.map(canonicalPath), allowSubpaths.map(canonicalPath));
}

/** Code commands need a stronger profile than provider CLIs: the worktree may be written, selected
 * toolchains may only be read/executed, and network/process inspection are always unavailable. */
export function strictCodeSeatbeltProfile(
  denySubpaths: readonly string[],
  writableSubpaths: readonly string[],
  readableSubpaths: readonly string[],
): string {
  const lines = ['(version 1)', '(allow default)', '(deny file-write*)'];
  const deny = denySubpaths.map(canonicalPath);
  const writable = writableSubpaths.map(canonicalPath);
  const readable = readableSubpaths.map(canonicalPath);
  if (deny.length) {
    lines.push('(deny file-read* file-write*');
    for (const path of deny) lines.push(`  (subpath ${sbpl(path)})`);
    lines.push(')');
  }
  if (writable.length) {
    lines.push('(allow file-read* file-write*');
    for (const path of writable) lines.push(`  (subpath ${sbpl(path)})`);
    lines.push(')');
  }
  if (readable.length) {
    lines.push('(allow file-read*');
    for (const path of readable) lines.push(`  (subpath ${sbpl(path)})`);
    lines.push(')');
  }
  lines.push(
    '(deny network*)', '(deny process-info*)', '(deny signal (target others))', '(deny appleevent-send)',
    '(deny mach-lookup',
    '  (global-name "com.apple.securityd")',
    '  (global-name "com.apple.securityd.xpc")',
    '  (global-name "com.apple.securityd.general")',
    '  (global-name "com.apple.securityd.system")',
    '  (global-name "com.apple.securityd.systemkeychain")',
    '  (global-name "com.apple.security.XPCKeychainSandboxCheck")',
    '  (global-name "com.apple.secd")',
    '  (global-name "com.apple.pboard")',
    '  (global-name "com.apple.coreservices.launchservicesd")',
    '  (global-name "com.apple.lsd.mapdb")',
    '  (global-name "com.apple.lsd.modifydb")',
    '  (global-name "com.apple.runningboard")',
    ')',
  );
  return `${lines.join('\n')}\n`;
}

// The full argv to spawn: `sandbox-exec -f <profile> <bin> <argv…>`. The sandbox flags PRECEDE the
// binary, so the wrapped command's own argv is untouched — agy still sees exactly `--print <prompt>`
// (its hard constraint: any extra flag derails it into its guide skill).
export function sandboxExecArgv(bin: string, argv: readonly string[], profilePath: string): string[] {
  return [SANDBOX_EXEC, '-f', profilePath, bin, ...argv];
}

// Write a profile to a fresh 0600 temp file; returns its path. cleanupTempProfile removes it (+ its dir).
export function writeTempProfile(profile: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'nm-seatbelt-'));
  const file = join(dir, 'agent.sb');
  writeFileSync(file, profile, { mode: 0o600 });
  return file;
}
export function cleanupTempProfile(profilePath: string): void {
  try { rmSync(dirname(profilePath), { recursive: true, force: true }); } catch { /* best-effort */ }
}
