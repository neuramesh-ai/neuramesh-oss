// THE STACK'S FILES: the compose file the app renders into ~/.neuramesh/local and the .env beside
// it (review F7, F8). Rendered, never typed — the person never sees a compose command.
//
// The env file holds EXACTLY seven keys. Two are secrets minted once and reused on every later
// boot (the sync key and the admin token); one is the sha256 of the `nmh_` human bearer, whose
// secret lives in the keychain and never touches this file; the rest are the version, the
// folder and the two loopback ports. `NM_IMAGE_TAG` is the app's own version, so a new desktop
// pulls the stack that matches it — a changed tag since the last boot is the Update state.
import { createHash, randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { nmBinDir } from './engine';

export const ENV_KEYS = ['NM_IMAGE_TAG', 'NM_LOCAL_DIR', 'NM_SYNC_KEY', 'NM_ADMIN_TOKEN', 'NM_LOCAL_HUMAN_TOKEN_HASH', 'NM_API_PORT', 'NM_POWERSYNC_PORT'] as const;
export type EnvKey = (typeof ENV_KEYS)[number];
export type StackEnv = Record<EnvKey, string>;

export const PROJECT_NAME = 'neuramesh-local';

/** `<brainRoot>/local` (~/.neuramesh/local by default), or wherever NM_LOCAL_DIR points */
export const localDir = (env: NodeJS.ProcessEnv, root: string): string => env['NM_LOCAL_DIR']?.trim() || join(root, 'local');

export const sha256Hex = (s: string): string => createHash('sha256').update(s).digest('hex');

/** the three secrets the stack needs, minted once per install */
export function mintSecrets(random: (n: number) => Buffer = randomBytes): { syncKey: string; adminToken: string; humanBearer: string } {
  return {
    syncKey: random(32).toString('base64url'),
    adminToken: random(24).toString('hex'),
    humanBearer: `nmh_${random(24).toString('hex')}`,
  };
}

export const isHumanBearer = (s: string | null | undefined): s is string => !!s && /^nmh_[0-9a-f]{48}$/.test(s);

/** KEY=value lines, the seven keys only, in table order — anything else in a hand-edited file is dropped */
export function parseEnv(raw: string | null | undefined): Partial<StackEnv> {
  const out: Partial<StackEnv> = {};
  for (const line of (raw ?? '').split('\n')) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (m && (ENV_KEYS as readonly string[]).includes(m[1]!)) out[m[1] as EnvKey] = m[2]!;
  }
  return out;
}

export function renderEnv(env: StackEnv): string {
  return ENV_KEYS.map((k) => `${k}=${env[k]}`).join('\n') + '\n';
}

export interface EnvPlan {
  env: StackEnv;
  /** the pinned image moved since the last boot — `pull` before `up` (the Update state) */
  tagChanged: boolean;
  /** no env existed — the first run (the Download state, not Update) */
  firstRun: boolean;
  /** the file must be (re)written */
  changed: boolean;
}

/**
 * Decide the env for this boot. Idempotent: secrets already in the file are kept, the version
 * and folder are refreshed, the bearer hash follows the keychain (a re-minted bearer after a lost
 * keychain lands here and the container restarts with it). `bearer` is the SECRET from the
 * keychain — only its hash is written.
 */
export function planEnv(input: { existing: Partial<StackEnv>; version: string; dir: string; bearer: string; ports?: { api: number; powersync: number }; random?: (n: number) => Buffer }): EnvPlan {
  const { existing } = input;
  const ports = input.ports ?? { api: 8788, powersync: 58081 };
  const minted = mintSecrets(input.random);
  const env: StackEnv = {
    NM_IMAGE_TAG: input.version,
    NM_LOCAL_DIR: input.dir,
    NM_SYNC_KEY: existing.NM_SYNC_KEY || minted.syncKey,
    NM_ADMIN_TOKEN: existing.NM_ADMIN_TOKEN || minted.adminToken,
    NM_LOCAL_HUMAN_TOKEN_HASH: sha256Hex(input.bearer),
    NM_API_PORT: String(ports.api),
    NM_POWERSYNC_PORT: String(ports.powersync),
  };
  const firstRun = !existing.NM_IMAGE_TAG;
  const changed = ENV_KEYS.some((k) => existing[k] !== env[k]);
  return { env, tagChanged: !firstRun && existing.NM_IMAGE_TAG !== input.version, firstRun, changed };
}

/** the compose services in BOOT order (each `depends_on` the one above it), which is the order
 *  the card lists them: the chain reads top to bottom as the containers come up (2026-09-18: it
 *  used to list PowerSync second, and PowerSync is the last to start, so a person watched the
 *  middle row wait for a container that was never asked to start) */
export const SERVICES: ReadonlyArray<{ service: string; label: string }> = [
  { service: 'pg', label: 'Postgres' },
  { service: 'control-api', label: 'NeuraMesh API' },
  { service: 'powersync', label: 'PowerSync' },
];

/** `${VAR}`, `${VAR:-default}` and `${VAR:?message}` — the three forms the compose file uses */
export function substitute(text: string, env: Record<string, string | undefined>): string {
  return text.replace(/\$\{([A-Z_][A-Z0-9_]*)(?::([-?])([^}]*))?\}/g, (_m, name: string, op: string | undefined, arg: string | undefined) => {
    const v = env[name];
    if (v) return v;
    if (op === '-') return arg ?? '';
    if (op === '?') throw new Error(`${name} is not set: ${arg ?? ''}`);
    return '';
  });
}

/** the images the compose file names, per service — what `docker pull` is asked for, one at a time */
export function composeImages(yamlText: string, env: Record<string, string | undefined>): Array<{ service: string; label: string; image: string }> {
  const out: Array<{ service: string; label: string; image: string }> = [];
  let service: string | null = null;
  for (const line of yamlText.split('\n')) {
    const svc = /^ {2}([a-z][a-z0-9-]*):\s*$/.exec(line);
    if (svc) { service = svc[1]!; continue; }
    // the whole value: `${NM_IMAGE_TAG:?set NM_IMAGE_TAG to …}` carries spaces inside the braces
    const img = /^ {4}image:\s*(.+?)\s*$/.exec(line);
    if (img && service) {
      const label = SERVICES.find((s) => s.service === service)?.label ?? service;
      out.push({ service, label, image: substitute(img[1]!, env) });
    }
  }
  return out;
}

/**
 * How the driver runs compose. The app's own bin dir (the Colima install lane) holds a standalone
 * `docker-compose`, because the static CLI has no plugin; an engine that came with its own CLI
 * has the plugin, so `docker compose`. Every call names the project and the env file, from the
 * stack's own folder — never `down -v`, which nothing here can produce.
 */
export function composeCommand(opts: { dockerBin: string; root: string; dir: string; hasStandalone: boolean }, args: string[]): { bin: string; args: string[]; cwd: string } {
  const common = ['--project-name', PROJECT_NAME, '--project-directory', opts.dir, '--env-file', join(opts.dir, '.env'), '-f', join(opts.dir, 'docker-compose.yaml')];
  if (args[0] === 'down' && args.includes('-v')) throw new Error('compose down -v is never run — the data folder is the person\'s (review F8)');
  return opts.hasStandalone
    ? { bin: join(nmBinDir(opts.root), 'docker-compose'), args: [...common, ...args], cwd: opts.dir }
    : { bin: opts.dockerBin, args: ['compose', ...common, ...args], cwd: opts.dir };
}

/** a `docker pull` line — `<layer>: Downloading [==>  ]  12.3MB/45.6MB` — as bytes */
export function parsePullLine(line: string): { layer: string; status: 'downloading' | 'extracting' | 'complete' | 'exists' | 'other'; current: number; total: number } | null {
  const m = /^([0-9a-f]{12}):\s+(.+?)\s*$/.exec(line.trim());
  if (!m) return null;
  const layer = m[1]!;
  const rest = m[2]!;
  const prog = /^(Downloading|Extracting)\s+\[[^\]]*\]\s+([\d.]+)\s*([kMG]?B)\/([\d.]+)\s*([kMG]?B)/.exec(rest);
  if (prog) return { layer, status: prog[1] === 'Downloading' ? 'downloading' : 'extracting', current: toBytes(prog[2]!, prog[3]!), total: toBytes(prog[4]!, prog[5]!) };
  if (/^(Pull complete|Download complete|Verifying Checksum)/.test(rest)) return { layer, status: 'complete', current: 0, total: 0 };
  if (/^Already exists/.test(rest)) return { layer, status: 'exists', current: 0, total: 0 };
  return { layer, status: 'other', current: 0, total: 0 };
}

const UNIT: Record<string, number> = { B: 1, kB: 1e3, MB: 1e6, GB: 1e9 };
const toBytes = (n: string, unit: string): number => Math.round(parseFloat(n) * (UNIT[unit] ?? 1));

/** the bars: per-layer totals summed into one image's bytes and total */
export class PullProgress {
  private layers = new Map<string, { current: number; total: number }>();
  feed(line: string): void {
    const p = parsePullLine(line);
    if (!p) return;
    if (p.status === 'downloading') this.layers.set(p.layer, { current: p.current, total: p.total });
    else if (p.status === 'complete') { const l = this.layers.get(p.layer); if (l) l.current = l.total; }
  }
  get bytes(): number { let n = 0; for (const l of this.layers.values()) n += l.current; return n; }
  get total(): number { let n = 0; for (const l of this.layers.values()) n += l.total; return n; }
}
