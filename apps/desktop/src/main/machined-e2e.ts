// THE END-TO-END TEST'S WORK-DIR WITNESS (scripts/e2e-cloudrun/README.md). With NM_E2E_MARKER=1 a
// Cloud Run machine appends one line per boot to `<work>/.nm-e2e/boots.log`, AFTER the boot restored
// the work dir and before any turn runs. The file lives in the work dir, so every drain snapshots it
// and every restore brings it back: a snapshot that lists epoch N-1 next to epoch N is proof that the
// work dir crossed that resize or that sleep, read by the driver from the snapshot itself without
// asking an agent anything. Unset (every real machine), nothing is written.
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const E2E_MARKER_DIR = '.nm-e2e';
export const E2E_BOOTS_FILE = 'boots.log';

export const e2eMarkerOn = (env: Record<string, string | undefined>): boolean => env['NM_E2E_MARKER'] === '1';

/** THE BOOT-LOOP PROBE (scripts/e2e-cloudrun/boot-guards.mjs). The boot throws after its grant, before
 *  it reports running, so Cloud Run restarts it into a new epoch: the failure nm-api's crash-loop
 *  breaker counts. On for one machine when the grant carries `e2e.bootThrow` (nm-api sends it only with
 *  NM_E2E_ROUTES=1, from a per-machine switch) AND this machine is a sandbox one (NM_E2E_MARKER=1). On
 *  for every boot with NM_E2E_BOOT_THROW=1, for a local run. A real machine has neither */
export const e2eBootThrowOn = (env: Record<string, string | undefined>, grant: { e2eBootThrow?: boolean }): boolean =>
  env['NM_E2E_BOOT_THROW'] === '1' || (grant.e2eBootThrow === true && e2eMarkerOn(env));

/** one line `epoch=<n> at=<iso> size=<class>`; returns every epoch the file now holds, oldest first */
export function recordBootMarker(workDir: string, boot: { epoch: number; sizeClass: string | null }, now: Date = new Date()): number[] {
  const dir = join(workDir, E2E_MARKER_DIR);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, E2E_BOOTS_FILE);
  appendFileSync(file, `epoch=${boot.epoch} at=${now.toISOString()} size=${boot.sizeClass ?? 'unknown'}\n`);
  return parseBootMarker(readFileSync(file, 'utf8'));
}

export function parseBootMarker(text: string): number[] {
  return [...text.matchAll(/^epoch=(\d+) /gm)].map((m) => Number(m[1]));
}

// ── THE TWO PROBE WITNESSES (NM_E2E_BOXCLI=1, NM_E2E_PARK=1) ─────────────────────────────────────
// Their bodies live with their owners: cloudrun/e2e-boxcli.ts (runBoxCliProbe: an in-box CLI, the
// secret mount, the metadata server blocked, the tool bus auth; writes <work>/.nm-e2e/boxcli.json) and
// cloudrun/e2e-park.ts (runParkProbe({workDir, registry, epoch, log}): opens one approval park, and on
// the boot that claims its resolution appends `parkId=… resolution=… claimedEpoch=n openedEpoch=m` to
// parks.log; park.json holds {parkId, key, openedEpoch, resumedAt?}). The park probe's first run waits
// NM_PARK_HOT_MS before it parks, so neither probe is awaited on the boot path. This file only switches them on, at the boot points machined.ts names, and
// loads them by a computed specifier so a build without them still compiles and boots: a missing or
// failing probe writes its witness file with `ok: false` and the reason, which the driver prints.
export const E2E_BOXCLI_FILE = 'boxcli.json';
export const E2E_PARK_FILE = 'park.json';
export const e2eBoxCliOn = (env: Record<string, string | undefined>): boolean => env['NM_E2E_BOXCLI'] === '1';
export const e2eParkOn = (env: Record<string, string | undefined>): boolean => env['NM_E2E_PARK'] === '1';
// …and the third (NM_E2E_CODESHELL=1): cloudrun/e2e-codeshell.ts (runCodeShellProbe: the Code shell
// executor once per lane, the supervisor's Bubblewrap and the box's, on a scratch worktree; writes
// <work>/.nm-e2e/codeshell.json and one `e2e codeshell:` line)
export const E2E_CODESHELL_FILE = 'codeshell.json';
export const e2eCodeShellOn = (env: Record<string, string | undefined>): boolean => env['NM_E2E_CODESHELL'] === '1';

type ProbeName = 'e2e-boxcli' | 'e2e-park' | 'e2e-codeshell';
type ProbeLoader = (name: ProbeName) => Promise<Record<string, unknown>>;
/** tsx (the machine image's runner) resolves the extensionless form; the .ts form covers a strict ESM resolver */
const loadProbe: ProbeLoader = async (name) => {
  let first: unknown;
  for (const spec of [`./cloudrun/${name}`, new URL(`./cloudrun/${name}.ts`, import.meta.url).href]) {
    try { return (await import(spec)) as Record<string, unknown>; } catch (e) { first ??= e; }
  }
  throw first instanceof Error ? first : new Error(String(first));
};

function writeWitness(workDir: string, file: string, body: Record<string, unknown>): void {
  const dir = join(workDir, E2E_MARKER_DIR);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, file), `${JSON.stringify(body, null, 2)}\n`);
}

/** the probe's function, or a reason it cannot run; never throws */
async function probeFn(load: ProbeLoader, name: ProbeName, fn: string): Promise<((o: never) => Promise<unknown>) | string> {
  try {
    const mod = await load(name);
    return typeof mod[fn] === 'function' ? (mod[fn] as (o: never) => Promise<unknown>) : `cloudrun/${name}.ts has no ${fn} export`;
  } catch (e) {
    return `cloudrun/${name}.ts did not load: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`;
  }
}

export interface BoxCliProbeArgs {
  env: Record<string, string | undefined>;
  workDir: string;
  /** lifecycle.boxManager */
  box: unknown;
  /** what startBoxRuntimes answered (bus port, relay port, wrappers), for the bus-auth check */
  runtimes?: unknown;
  epoch: number;
  log: (line: string) => void;
  load?: ProbeLoader;
}

/** after startBoxRuntimes succeeded. The secret's sha256 goes to the log as E2E_SECRET_SHA=<hex>, the
 *  line the operator greps for in Cloud Logging; the secret itself never leaves the probe. The probe's
 *  onSecret hands over the RAW value (e2e-boxcli.ts), so it is hashed here: the first full e2e run
 *  logged the value itself under this name, which the leak scan (scripts/e2e-cloudrun/leak-scan.sh) found */
export async function runE2eBoxCli(a: BoxCliProbeArgs): Promise<void> {
  if (!e2eBoxCliOn(a.env)) return;
  const fn = await probeFn(a.load ?? loadProbe, 'e2e-boxcli', 'runBoxCliProbe');
  if (typeof fn === 'string') { a.log(`e2e boxcli: ${fn}`); writeWitness(a.workDir, E2E_BOXCLI_FILE, { ok: false, epoch: a.epoch, error: fn }); return; }
  try {
    const out = await fn({ workDir: a.workDir, box: a.box, runtimes: a.runtimes, epoch: a.epoch, log: a.log, onSecret: (value: string) => a.log(`E2E_SECRET_SHA=${createHash('sha256').update(value).digest('hex')}`) } as never);
    a.log(`e2e boxcli: probe finished ${JSON.stringify(out ?? null).slice(0, 300)}`);
  } catch (e) {
    const error = e instanceof Error ? e.message.slice(0, 500) : String(e);
    a.log(`e2e boxcli: probe failed: ${error}`);
    writeWitness(a.workDir, E2E_BOXCLI_FILE, { ok: false, epoch: a.epoch, error });
  }
}

export interface ParkProbeArgs {
  env: Record<string, string | undefined>;
  workDir: string;
  /** the ParkRegistry (cloudrun/parks.ts `parks()`), after its boot claim of resolved parks */
  registry: unknown;
  epoch: number;
  /** how many resolved parks the boot claim took */
  claimed: number;
  log: (line: string) => void;
  load?: ProbeLoader;
}

/** after the boot claim of resolved parks (machined.ts) */
export async function runE2ePark(a: ParkProbeArgs): Promise<void> {
  if (!e2eParkOn(a.env)) return;
  const fn = await probeFn(a.load ?? loadProbe, 'e2e-park', 'runParkProbe');
  if (typeof fn === 'string') { a.log(`e2e park: ${fn}`); writeWitness(a.workDir, E2E_PARK_FILE, { ok: false, epoch: a.epoch, error: fn }); return; }
  try {
    const out = await fn({ workDir: a.workDir, registry: a.registry, epoch: a.epoch, claimed: a.claimed, log: a.log } as never);
    a.log(`e2e park: probe finished ${JSON.stringify(out ?? null).slice(0, 300)}`);
  } catch (e) {
    const error = e instanceof Error ? e.message.slice(0, 500) : String(e);
    a.log(`e2e park: probe failed: ${error}`);
    writeWitness(a.workDir, E2E_PARK_FILE, { ok: false, epoch: a.epoch, error });
  }
}

export interface CodeShellProbeArgs {
  env: Record<string, string | undefined>;
  workDir: string;
  epoch: number;
  /** the boot's Code shell choice (cloudrun/code-shell.ts prepareCodeShell) */
  selection: Promise<unknown>;
  /** the box lane, or null when the box did not start */
  boxLane: unknown;
  log: (line: string) => void;
  load?: ProbeLoader;
}

/** after the Code shell lanes are prepared (machined.ts); waits for their self-checks */
export async function runE2eCodeShell(a: CodeShellProbeArgs): Promise<void> {
  if (!e2eCodeShellOn(a.env)) return;
  const fn = await probeFn(a.load ?? loadProbe, 'e2e-codeshell', 'runCodeShellProbe');
  if (typeof fn === 'string') { a.log(`e2e codeshell: ${fn}`); writeWitness(a.workDir, E2E_CODESHELL_FILE, { ok: false, epoch: a.epoch, error: fn }); return; }
  try {
    await fn({ workDir: a.workDir, epoch: a.epoch, selection: a.selection, boxLane: a.boxLane, log: a.log } as never);
  } catch (e) {
    const error = e instanceof Error ? e.message.slice(0, 500) : String(e);
    a.log(`e2e codeshell: probe failed: ${error}`);
    writeWitness(a.workDir, E2E_CODESHELL_FILE, { ok: false, epoch: a.epoch, error });
  }
}
