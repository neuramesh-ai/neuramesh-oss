// Containment L1b — the shared "what agents must not touch" path set. ONE source of truth, emitted in
// the two shapes the runtimes need: glob patterns for the Claude SDK sandbox (managedSettings.sandbox
// .filesystem.denyRead) and absolute subpaths for the agy Seatbelt (sandbox-exec) profile.
//
// It is a DENY-LIST over allow-default, NOT an allow-list — we deny the sensitive paths and leave the
// rest readable, so a forgotten toolchain path (a global npm cache, a language SDK) can never break a
// runtime. That is the whole point of a deny-list here: the failure mode of an allow-list is a broken
// loop, and we are user-zero.
//
// Denied: credential stores (~/.ssh, ~/.aws, …) and NeuraMesh's own private store — app userData, which
// holds the auth session token (session.json / clerk-session.json), the PowerSync replica (all synced
// team data), and chat attachments. NOT denied: the agent's own worktree (allowed back as insurance
// against any nesting), and the RUNTIME's own login dir (~/.claude · ~/.codex · ~/.gemini) — L0 keeps
// HOME real so a subscription CLI reads its login, and the jail must preserve that.
//
// Deliberately NOT denied in v1: sibling worktrees + repo clones under ~/.neuramesh. A repo-backed
// worktree's git points into ~/.neuramesh/repos/<id>/.git, so denying that tree would break the
// agent's own `git status`/`diff`. Cross-worktree isolation is a follow-up that needs the allow-back
// tuned against git-worktree gitdir resolution.
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

export interface FsJail {
  /** glob patterns for claude-agent-sdk managedSettings.sandbox.filesystem.denyRead/denyWrite */
  denyReadGlobs: string[];
  /** absolute paths for the Seatbelt (sandbox-exec) profile's `(deny file* (subpath …))` rules */
  denySubpaths: string[];
  /** the agent's own worktree — allowed back AFTER the denies (nesting insurance; Seatbelt allow-last) */
  allowSubpaths: string[];
  /** writable roots: the worktree + the OS temp dir */
  allowWrite: string[];
}

export interface FsJailInput {
  /** the agent's cwd for this run — repo worktree or scratch/deliverables dir */
  worktree: string;
  /** app.getPath('userData') — the auth session + replica DB + attachments store */
  userDataDir: string;
  /** human-added protected paths (from `fs.read` deny policy rules) — a HOME-relative dotpath
      ('.config/foo') or an absolute path ('/opt/secrets'). Added ON TOP of the structural
      credential-store floor below, so a workspace can jail anything else it wants agents kept out of. */
  extraPaths?: string[];
  home?: string;
  temp?: string;
}

// Credential stores under HOME. `dir:true` = a whole directory tree; `dir:false` = a single file.
const CRED_TARGETS: ReadonlyArray<{ rel: string; dir: boolean }> = [
  { rel: '.ssh', dir: true },
  { rel: '.aws', dir: true },
  { rel: '.gnupg', dir: true },
  { rel: '.kube', dir: true },
  { rel: '.config/gcloud', dir: true },
  { rel: '.docker/config.json', dir: false },
  { rel: '.netrc', dir: false },
];

export function computeFsJail({ worktree, userDataDir, extraPaths = [], home = homedir(), temp = tmpdir() }: FsJailInput): FsJail {
  const denySubpaths: string[] = [];
  const denyReadGlobs: string[] = [];
  const seen = new Set<string>();
  // Absolute-anchored globs are what the kernel actually enforces (syscall paths are canonicalized);
  // the `**/<name>/**` variants are belt-and-suspenders against an alternate/symlinked HOME.
  const add = (abs: string, rel: string | null, dir: boolean): void => {
    if (seen.has(abs)) return;
    seen.add(abs);
    denySubpaths.push(abs);
    if (dir) { denyReadGlobs.push(`${abs}/**`); if (rel) denyReadGlobs.push(`**/${rel}/**`); }
    else { denyReadGlobs.push(abs); if (rel) denyReadGlobs.push(`**/${rel}`); }
  };
  // structural credential-store floor — always denied, never removable (the security invariant)
  for (const c of CRED_TARGETS) add(join(home, c.rel), c.rel, c.dir);
  // + human-added protected paths (deduped against the floor): HOME-relative dotpath or absolute path
  for (const p of extraPaths) add(p.startsWith('/') ? p : join(home, p), p.startsWith('/') ? null : p, true);
  // NeuraMesh's own userData is a STRUCTURAL deny (auth token + replica) — not policy-configurable
  denySubpaths.push(userDataDir);
  denyReadGlobs.push(`${userDataDir}/**`, userDataDir);
  return {
    denyReadGlobs,
    denySubpaths,
    allowSubpaths: [worktree],
    allowWrite: [worktree, temp],
  };
}

// Map an FsJail to the claude-agent-sdk query options that enable its native sandbox (Seatbelt on
// macOS / bubblewrap on Linux). The FS restrictions ride `managedSettings` — the SDK's restrictive-only
// embedding-app lockdown tier, which the model cannot widen — while `sandbox` carries only the enable +
// fail-open + behavior flags. `autoAllowBashIfSandboxed:false` keeps our PreToolUse policy hook
// authoritative (sandbox = the kernel floor; the hook = the ask/deny UX). Network is left to the L1a
// egress proxy; we only keep loopback binding open so that proxy connection isn't strangled.
export interface ClaudeSandboxOptions {
  sandbox: { enabled: true; failIfUnavailable: false; autoAllowBashIfSandboxed: false };
  managedSettings: {
    sandbox: {
      filesystem: { denyRead: string[]; denyWrite: string[]; allowRead: string[]; allowWrite: string[] };
      network: { allowLocalBinding: true };
    };
  };
}
export function claudeSandboxOptions(jail: FsJail): ClaudeSandboxOptions {
  return {
    sandbox: { enabled: true, failIfUnavailable: false, autoAllowBashIfSandboxed: false },
    managedSettings: {
      sandbox: {
        filesystem: {
          denyRead: jail.denyReadGlobs,
          denyWrite: jail.denyReadGlobs,
          allowRead: jail.allowSubpaths,
          allowWrite: jail.allowWrite,
        },
        network: { allowLocalBinding: true },
      },
    },
  };
}
