// THE LOGIN VAULT, machine side (architecture §7, decision D1; packages/shared login-vault.ts; nm-api
// machine-vault.ts). A Cloud Run machine keeps its home (/nm/home) in RAM, so every vendor login a
// person makes in the box terminal is lost at the next stop. This file keeps the allowlisted login
// files across stops: the boot writes them back before the box starts (restore), and an agent uploads
// them when they change and once more at the drain (VaultAgent).
//
// WHY POLLING. inotify across the gVisor bind is unmeasured, the files are five and tiny, and the
// runtime availability probe already polls at 5 s. A file is uploaded only after it holds still for one
// poll, so a CLI caught halfway through writing its token is not stored half written.
//
// WHY NO SYMLINK IS FOLLOWED. The login dirs are bound read-write into the box, so a person in the box
// can put a symlink there. This supervisor reads the host file system, where a link could name the
// machine token or the boot credential. A file is read only when it is a regular file whose real path
// is exactly the allowlisted path, and it is opened with O_NOFOLLOW.
//
// One writer: only this process and only at its epoch. nm-api fences every PUT by epoch, so the
// instance a resize is replacing cannot overwrite the vault its successor restored.
import {
  VAULT_CODES, VAULT_FILE_MAX_BYTES, VAULT_LOGIN_FILES, isVaultLoginFile,
  type VaultFile, type VaultRead, type VaultWrite,
} from '@neuramesh/shared';
import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readSync, realpathSync, renameSync, rmSync, writeFileSync, type Stats } from 'node:fs';
import { dirname, join } from 'node:path';
import { EpochFencedError, MachineTokenRejected } from './snapshot';

/** a refusal the machine stops on: the vault is off, or this machine keeps no logins */
export interface VaultRefused { refused: string; error?: string }
export type VaultWriteResult = { generation: number } | { conflict: number } | VaultRefused;

/** nm-api's two routes. 401 throws MachineTokenRejected, 409 STALE_EPOCH throws EpochFencedError */
export interface VaultChannel {
  read(): Promise<VaultRead | VaultRefused>;
  write(body: VaultWrite): Promise<VaultWriteResult>;
}

const STOP_CODES: ReadonlySet<string> = new Set([VAULT_CODES.off, VAULT_CODES.shared, VAULT_CODES.substrate]);

export function apiVaultChannel(o: { apiUrl: string; headers: () => Promise<Record<string, string>>; fetchImpl?: typeof fetch }): VaultChannel {
  const call = o.fetchImpl ?? fetch;
  const answer = async (res: Response, what: string): Promise<Record<string, unknown>> => {
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.status === 401) throw new MachineTokenRejected(`${what}: the machine token was refused`);
    if (res.status === 409 && body['code'] === 'STALE_EPOCH') throw new EpochFencedError(`${what}: a newer epoch owns this machine`);
    return body;
  };
  return {
    async read() {
      const res = await call(`${o.apiUrl}/v1/machines/vault`, { headers: await o.headers(), signal: AbortSignal.timeout(15_000) });
      const body = await answer(res, 'GET /v1/machines/vault');
      if (typeof body['code'] === 'string' && STOP_CODES.has(body['code'])) return { refused: body['code'], error: String(body['error'] ?? '') };
      if (!res.ok) throw new Error(`GET /v1/machines/vault: HTTP ${res.status} ${String(body['code'] ?? '')}`);
      return { generation: Number(body['generation'] ?? 0), files: Array.isArray(body['files']) ? (body['files'] as VaultFile[]) : [] };
    },
    async write(w) {
      const res = await call(`${o.apiUrl}/v1/machines/vault`, {
        method: 'PUT', headers: { 'content-type': 'application/json', ...(await o.headers()) },
        body: JSON.stringify(w), signal: AbortSignal.timeout(15_000),
      });
      const body = await answer(res, 'PUT /v1/machines/vault');
      if (res.status === 409 && body['code'] === VAULT_CODES.conflict) return { conflict: Number(body['generation'] ?? 0) };
      if (typeof body['code'] === 'string' && STOP_CODES.has(body['code'])) return { refused: body['code'], error: String(body['error'] ?? '') };
      if (!res.ok) throw new Error(`PUT /v1/machines/vault: HTTP ${res.status} ${String(body['code'] ?? '')}`);
      return { generation: Number(body['generation']) };
    },
  };
}

/** what the home holds now: the allowlisted regular files, and one hash over all of them */
export interface HomeScan { files: VaultFile[]; fingerprint: string }

export function fingerprintOf(files: ReadonlyArray<VaultFile>): string {
  const h = createHash('sha256');
  for (const f of [...files].sort((a, b) => a.path.localeCompare(b.path))) h.update(`${f.path}\0${f.data}\0`);
  return h.digest('hex');
}

const realHome = (homeDir: string): string => { try { return realpathSync(homeDir); } catch { return homeDir; } };

/** one login file's bytes, or null when it is absent, not a plain file, a link, or too large */
function readLogin(home: string, rel: string, log: (line: string) => void): Buffer | null {
  const abs = join(home, rel);
  let st: Stats;
  try { st = lstatSync(abs); } catch { return null; }
  if (!st.isFile()) { log(`vault: ${rel} is not a plain file, skipped`); return null; }
  // an empty file carries no login: the box binds an empty .gitconfig into every fresh home
  if (st.size === 0) return null;
  let real: string;
  try { real = realpathSync(abs); } catch { return null; }
  if (real !== abs) { log(`vault: ${rel} resolves outside its place, skipped`); return null; }
  if (st.size > VAULT_FILE_MAX_BYTES) { log(`vault: ${rel} is ${st.size} bytes, over the ${VAULT_FILE_MAX_BYTES} cap, skipped`); return null; }
  let fd: number;
  try { fd = openSync(abs, constants.O_RDONLY | constants.O_NOFOLLOW); } catch { return null; }
  try {
    const size = fstatSync(fd).size;
    if (size > VAULT_FILE_MAX_BYTES) return null;
    const buf = Buffer.alloc(size);
    let off = 0;
    while (off < size) { const n = readSync(fd, buf, off, size - off, off); if (n === 0) break; off += n; }
    return buf.subarray(0, off);
  } finally {
    closeSync(fd);
  }
}

export function scanHome(homeDir: string, log: (line: string) => void = () => {}): HomeScan {
  const home = realHome(homeDir);
  const files: VaultFile[] = [];
  for (const rel of VAULT_LOGIN_FILES) {
    const bytes = readLogin(home, rel, log);
    if (bytes) files.push({ path: rel, data: bytes.toString('base64') });
  }
  return { files, fingerprint: fingerprintOf(files) };
}

/** Writes each vault file that is absent here: 0700 dirs, a 0600 file, written aside and renamed.
 *  A file already present with content stays: it is a login made on this incarnation, newer than the
 *  vault's. Returns the paths written. */
export function writeAbsent(homeDir: string, files: ReadonlyArray<VaultFile>, log: (line: string) => void = () => {}): string[] {
  const home = realHome(homeDir);
  const written: string[] = [];
  for (const f of files) {
    if (!isVaultLoginFile(f.path)) continue;
    const abs = join(home, f.path);
    let present: Stats | null = null;
    try { present = lstatSync(abs); } catch { /* absent: write it */ }
    if (present && !(present.isFile() && present.size === 0)) continue;
    if (present) {
      // the empty .gitconfig the box binds as a FILE: write in place, a rename would leave the box
      // bound to the old empty inode
      const fd = openSync(abs, constants.O_WRONLY | constants.O_TRUNC | constants.O_NOFOLLOW);
      try { writeFileSync(fd, Buffer.from(f.data, 'base64')); } finally { closeSync(fd); }
      written.push(f.path);
      continue;
    }
    mkdirSync(dirname(abs), { recursive: true, mode: 0o700 });
    // the parent must be the real allowlisted place: a link in the box must not steer the write
    if (realpathSync(dirname(abs)) !== dirname(abs)) { log(`vault: the folder of ${f.path} resolves outside its place, not restored`); continue; }
    const tmp = `${abs}.nm-vault-${process.pid}`;
    rmSync(tmp, { force: true });
    writeFileSync(tmp, Buffer.from(f.data, 'base64'), { mode: 0o600, flag: 'wx' });
    renameSync(tmp, abs);
    written.push(f.path);
  }
  return written;
}

export interface VaultAgentOptions {
  channel: VaultChannel;
  homeDir: string;
  /** the machine's epoch now (the lifecycle's) */
  epoch: () => number;
  /** a 409 STALE_EPOCH: a newer instance owns the machine */
  onFence: (why: string) => void;
  /** a 401: the token is gone */
  onRejected: (why: string) => void;
  log?: (line: string) => void;
  pollMs?: number;
}

/** how often the agent looks at the login files */
export const VAULT_POLL_MS = 3_000;

export class VaultAgent {
  /** the generation nm-api holds as far as this process knows; null = not read yet */
  private generation: number | null = null;
  /** the fingerprint of what nm-api holds */
  private stored: string | null = null;
  /** the fingerprint the previous poll saw: a change uploads only once it holds still */
  private lastSeen: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy: Promise<void> | null = null;
  private stopped = false;
  private readonly log: (line: string) => void;

  constructor(private readonly o: VaultAgentOptions) {
    this.log = o.log ?? ((line) => console.log(`[vault] ${line}`));
  }

  /** false once nm-api said this machine keeps no logins, or the epoch was fenced */
  get active(): boolean { return !this.stopped; }
  get storedGeneration(): number | null { return this.generation; }

  /** The boot restore: read the vault and write it into the home, before the box starts. A failed
   *  read never fails the boot (the agent reads again on its polls). Only a fence or a refused token
   *  throws, as every other boot step does. */
  async restore(): Promise<{ generation: number | null; restored: string[] }> {
    try {
      const restored = await this.sync();
      return { generation: this.generation, restored };
    } catch (e) {
      if (e instanceof EpochFencedError || e instanceof MachineTokenRejected) { this.stopped = true; throw e; }
      this.log(`restore failed, the agent reads again later: ${e instanceof Error ? e.message : String(e)}`);
      return { generation: null, restored: [] };
    }
  }

  start(): void {
    if (this.timer || this.stopped) return;
    this.timer = setInterval(() => { void this.poll(); }, this.o.pollMs ?? VAULT_POLL_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** one poll: upload when the login files changed and held still since the last poll */
  async poll(): Promise<void> {
    await this.serial(async () => {
      if (this.generation === null) await this.sync();
      if (this.stopped || this.generation === null) return;
      const scan = scanHome(this.o.homeDir, this.log);
      const stable = scan.fingerprint === this.lastSeen;
      this.lastSeen = scan.fingerprint;
      if (scan.fingerprint !== this.stored && stable) await this.upload(scan);
    });
  }

  /** the drain's last word: upload what differs now, still or not */
  async flush(): Promise<void> {
    await this.serial(async () => {
      if (this.generation === null) await this.sync();
      if (this.stopped || this.generation === null) return;
      const scan = scanHome(this.o.homeDir, this.log);
      if (scan.fingerprint !== this.stored) await this.upload(scan);
    });
  }

  /** one call at a time, and every fence or token error goes to the lifecycle, never up */
  private async serial(fn: () => Promise<void>): Promise<void> {
    if (this.stopped) return;
    while (this.busy) await this.busy;
    const run = fn().catch((e: unknown) => this.fail(e));
    this.busy = run;
    try { await run; } finally { if (this.busy === run) this.busy = null; }
  }

  private fail(e: unknown): void {
    const why = e instanceof Error ? e.message : String(e);
    if (e instanceof EpochFencedError) { this.halt(`fenced: ${why}`); this.o.onFence(why); return; }
    if (e instanceof MachineTokenRejected) { this.halt(`token refused: ${why}`); this.o.onRejected(why); return; }
    this.log(`call failed, the next poll tries again: ${why}`);
  }

  private halt(why: string): void {
    this.stopped = true;
    this.stop();
    this.log(`stopped: ${why}`);
  }

  /** read nm-api's vault and write what is absent here. Throws a fence or a refused token */
  private async sync(): Promise<string[]> {
    const read = await this.o.channel.read();
    if ('refused' in read) { this.halt(`${read.refused}${read.error ? ` (${read.error})` : ''}`); return []; }
    const restored = writeAbsent(this.o.homeDir, read.files, this.log);
    this.generation = read.generation;
    this.stored = fingerprintOf(read.files.filter((f) => isVaultLoginFile(f.path)));
    this.log(`read generation ${read.generation}: ${read.files.length} file(s), ${restored.length} restored${restored.length ? ` (${restored.join(', ')})` : ''}`);
    return restored;
  }

  private async upload(scan: HomeScan): Promise<void> {
    // a conflict means nm-api moved past what this process read (a forget, or a lost answer). This
    // process is the only live writer under the epoch fence, so it adopts the head and writes once more
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await this.o.channel.write({ epoch: this.o.epoch(), baseGeneration: this.generation ?? 0, files: scan.files });
      if ('refused' in res) { this.halt(`${res.refused}${res.error ? ` (${res.error})` : ''}`); return; }
      if ('conflict' in res) { this.generation = res.conflict; continue; }
      this.generation = res.generation;
      this.stored = scan.fingerprint;
      this.log(`wrote generation ${res.generation}: ${scan.files.map((f) => f.path).join(', ') || 'no files (signed out)'}`);
      return;
    }
    this.log('the vault kept moving under this write; the next poll tries again');
  }
}

/** NM_VAULT=1 switches the machine side on (nm-api has its own NM_VAULT) */
export const vaultOn = (env: NodeJS.ProcessEnv = process.env): boolean => env['NM_VAULT'] === '1';
