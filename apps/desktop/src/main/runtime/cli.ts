// CLI provisioning for non-Claude runtimes. Creating or running a codex/gemini
// agent ENSURES that runtime's coding CLI is on PATH. For an npm-distributed CLI
// (codex) we install it (npm -g) when missing, streaming progress, rather than
// failing (founder directive); for a native-install CLI (agy, pkg='') we can't run
// its installer for the user, so we surface the install steps instead. The CLIs are
// the agentic coding loop's engine (they do the worktree file-edit/bash loop
// natively, like claude-code); the raw SDKs handle non-agentic turns.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { LogFn } from '../agentlog';

// pkg='' = a native-install CLI we can't provision for the user (agy) — surface install steps.
// Google's `gemini` CLI was deprecated 2026-06-18; its successor is Antigravity's `agy` (Google
// account OAuth, no API key), which now drives the Google runtime's worker/reason loop.
// minVersion: the CLI is UPGRADED, not just installed, when the machine's copy is older. Codex
// rejects a model its binary predates ("requires a newer version of Codex"), and runResilient
// answers that by retrying with model: undefined — a SILENT downgrade to the account default, so
// a task the human seated on the flagship quietly runs on something else. gpt-6-astra needs
// codex-cli 0.153.0, so the floor moves with the catalog (packages/shared/src/model-packs.ts).
const CLI: Record<string, { bin: string; pkg: string; minVersion?: string }> = {
  codex: { bin: 'codex', pkg: '@openai/codex', minVersion: '0.153.0' },
  gemini: { bin: 'agy', pkg: '' },
};

/** numeric-segment compare: '0.145.0' < '0.153.0' < '0.153.4'. Non-numeric suffixes are ignored. */
export function versionBelow(have: string, want: string): boolean {
  const parts = (v: string): number[] => v.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const a = parts(have);
  const b = parts(want);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x < y;
  }
  return false;
}

/** `<bin> --version` → the first dotted number on the line, or null when it cannot be read. */
export function cliVersion(bin: string): Promise<string | null> {
  return new Promise((res) => {
    const p = spawn(bin, ['--version']);
    let out = '';
    p.stdout.on('data', (d) => { out += String(d); });
    p.stderr.on('data', (d) => { out += String(d); });
    p.on('close', () => res(/(\d+\.\d+\.\d+)/.exec(out)?.[1] ?? null));
    p.on('error', () => res(null));
  });
}

// install dirs a Finder-launched app's minimal PATH may miss (agy lands in ~/.local/bin).
const EXTRA_BIN_DIRS = [join(homedir(), '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin'];
const inExtraDirs = (bin: string): string | null => {
  for (const d of EXTRA_BIN_DIRS) { const f = join(d, bin); if (existsSync(f)) return f; }
  return null;
};

// resolve a binary on PATH (which/where), falling back to known install dirs; null if absent.
export function which(bin: string): Promise<string | null> {
  return new Promise((res) => {
    const p = spawn(process.platform === 'win32' ? 'where' : 'which', [bin]);
    let out = '';
    p.stdout.on('data', (d) => { out += String(d); });
    p.on('close', (code) => res((code === 0 && out.trim() ? out.trim().split('\n')[0] : null) ?? inExtraDirs(bin)));
    p.on('error', () => res(inExtraDirs(bin)));
  });
}

// one install per CLI at a time, even under concurrent agent creates/runs
const installing = new Map<string, Promise<string>>();

// ensure the runtime's CLI is available, installing it once if missing.
export async function ensureCli(runtime: string, log?: LogFn): Promise<string> {
  const spec = CLI[runtime];
  if (!spec) throw new Error(`no coding CLI is mapped for the "${runtime}" runtime`);
  const found = await which(spec.bin);
  if (found) {
    if (!spec.minVersion || !spec.pkg) return found;
    const have = await cliVersion(found);
    // An unreadable version is not evidence of anything, so we leave a working CLI alone.
    if (!have || !versionBelow(have, spec.minVersion)) return found;
    log?.({ kind: 'exec', phase: 'started', summary: `${runtime} CLI ${have} is older than ${spec.minVersion} — upgrading…` });
    console.log(`runtime_cli upgrading ${spec.bin} ${have} → >=${spec.minVersion} (at ${found})`);
    // Upgrade the install we ACTUALLY resolved. Codex ships a standalone installer whose binary
    // lands in ~/.local/bin, which is ahead of npm's prefix on PATH — so `npm i -g` there installs
    // a second copy PATH never reaches, the re-probe still sees the old version, and the human is
    // told to run a command that cannot fix their machine. Ask the binary to update itself first
    // and fall back to npm only for an npm-managed install.
    const selfUpdated = await selfUpdate(spec.bin);
    if (!selfUpdated && (await isNpmManaged(found))) await npmInstallGlobal(`${spec.pkg}@latest`);
    const after = await which(spec.bin);
    const now = after ? await cliVersion(after) : null;
    if (!after || (now && versionBelow(now, spec.minVersion))) {
      throw new Error(`the "${spec.bin}" CLI at ${after ?? found} is ${now ?? have}, but this model needs ${spec.minVersion} or newer. Upgrade THAT install and retry — \`${spec.bin} update\` for a standalone install, or \`npm i -g ${spec.pkg}@latest\` if you installed it with npm.`);
    }
    log?.({ kind: 'exec', phase: 'started', summary: `${runtime} CLI ready (${now ?? 'upgraded'})` });
    return after;
  }
  if (!spec.pkg) {
    // native-install CLI (agy): we can't run its curl|bash installer for the user — tell them how.
    throw new Error(`the "${spec.bin}" CLI (Google Antigravity) isn't installed. Install it from https://antigravity.google/docs/cli-install and sign in with your Google account, then retry.`);
  }
  let job = installing.get(runtime);
  if (!job) {
    job = (async () => {
      log?.({ kind: 'exec', phase: 'started', summary: `${runtime} CLI not found — installing ${spec.pkg} (npm -g)…` });
      console.log(`runtime_cli installing ${spec.pkg} for runtime=${runtime}`);
      await npmInstallGlobal(spec.pkg);
      const p = await which(spec.bin);
      if (!p) throw new Error(`installed ${spec.pkg} but "${spec.bin}" is still not on PATH — install it manually: npm i -g ${spec.pkg}`);
      log?.({ kind: 'exec', phase: 'started', summary: `${runtime} CLI ready (${p})` });
      return p;
    })().finally(() => installing.delete(runtime));
    installing.set(runtime, job);
  }
  return job;
}

/** pure half of isNpmManaged, so the rule can be tested without spawning npm */
export function isNpmManagedAt(binPath: string, npmPrefix: string): boolean {
  return !!npmPrefix && binPath.startsWith(npmPrefix);
}

/** is this binary inside npm's global prefix? only then can `npm i -g` move it */
async function isNpmManaged(binPath: string): Promise<boolean> {
  const prefix = await new Promise<string>((res) => {
    const p = spawn('npm', ['config', 'get', 'prefix']);
    let out = '';
    p.stdout.on('data', (d) => { out += String(d); });
    p.on('close', () => res(out.trim()));
    p.on('error', () => res(''));
  });
  return isNpmManagedAt(binPath, prefix);
}

/** `<bin> update` — the standalone installers' own upgrade path. Best effort. */
function selfUpdate(bin: string): Promise<boolean> {
  return new Promise((res) => {
    const p = spawn(bin, ['update'], { env: process.env });
    p.on('close', (code) => res(code === 0));
    p.on('error', () => res(false));
  });
}

function npmInstallGlobal(pkg: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn('npm', ['install', '-g', pkg], { env: process.env });
    let err = '';
    p.stderr.on('data', (d) => { err += String(d); });
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`npm i -g ${pkg} failed (exit ${code}): ${err.slice(-300)}`))));
    p.on('error', (e) => reject(new Error(`could not run npm to install ${pkg} — is Node/npm on PATH? ${e.message}`)));
  });
}

// is the runtime's CLI present? (no install) — used to surface status in the UI.
export function cliInstalled(runtime: string): Promise<boolean> {
  const spec = CLI[runtime];
  return spec ? which(spec.bin).then((p) => !!p) : Promise.resolve(false);
}
