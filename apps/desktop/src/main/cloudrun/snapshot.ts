// Work dir and box snapshots to GCS, and the dependency cache (README.md, invariant 7). A TS port of
// infra/cloudrun-probe/snapshot/nm-snapshot.js, which ran on Cloud Run: `tar | zstd` streamed to a
// GCS resumable session through a signed URL, and back. The machine holds no bucket IAM: nm-api
// signs one object at a time for the machine its bearer names, and fences by epoch.
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Readable, Transform, Writable, type TransformCallback } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { pipeline } from 'node:stream/promises';
import * as zlib from 'node:zlib';
import type { BoxManager } from './box';

/** GCS takes every resumable chunk but the last in multiples of 256 KiB */
export const QUANTUM = 256 * 1024;
export const CHUNK = 128 * QUANTUM;

export * from './snapshot-sign';
import { TAR_MIN_BYTES, EpochFencedError, MachineTokenRejected, type SnapshotKind, type SnapshotSigner, type ListedSnapshot } from './snapshot-sign';

/** What to send of `pending` buffered bytes at `offset`: everything when final, else the largest
 *  256 KiB multiple. The total stays `*` until the final chunk names it. */
export function chunkPlan(pending: number, offset: number, final: boolean): { sendLen: number; range: string } {
  const sendLen = final ? pending : pending - (pending % QUANTUM);
  const total = final ? String(offset + sendLen) : '*';
  const range = sendLen ? `bytes ${offset}-${offset + sendLen - 1}/${total}` : `bytes */${total}`;
  return { sendLen, range };
}

/** Writable that sends CHUNK-sized parts to a GCS resumable session. */
export class ResumableSink extends Writable {
  private parts: Buffer[] = [];
  private pending = 0;
  private offset = 0;

  constructor(private readonly url: string, private readonly call: typeof fetch = fetch, private readonly chunk = CHUNK) {
    super({ highWaterMark: chunk });
    if (chunk <= 0 || chunk % QUANTUM !== 0) throw new Error('The upload chunk must be a multiple of 256 KiB.');
  }

  get sent(): number { return this.offset; }

  private async flushChunk(final: boolean): Promise<void> {
    const data = Buffer.concat(this.parts, this.pending);
    const { sendLen, range } = chunkPlan(data.length, this.offset, final);
    const part = data.subarray(0, sendLen);
    const res = await this.call(this.url, { method: 'PUT', headers: { 'content-range': range }, body: new Uint8Array(part) });
    const ok = final ? res.status === 200 || res.status === 201 : res.status === 308;
    if (!ok) throw new Error(`upload ${range}: HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 300)}`);
    this.offset += part.length;
    const rest = data.subarray(sendLen);
    this.parts = rest.length ? [Buffer.from(rest)] : [];
    this.pending = rest.length;
  }

  override _write(chunk: Buffer, _enc: BufferEncoding, cb: (error?: Error | null) => void): void {
    this.parts.push(chunk);
    this.pending += chunk.length;
    if (this.pending >= this.chunk) this.flushChunk(false).then(() => cb(), cb);
    else cb();
  }

  override _final(cb: (error?: Error | null) => void): void {
    this.flushChunk(true).then(() => cb(), cb);
  }
}

class ByteCounter extends Transform {
  bytes = 0;
  private hash;
  constructor(checksum = false) { super(); this.hash = checksum ? createHash('sha256') : null; }
  get sha256(): string | undefined { return this.hash?.copy().digest('hex'); }
  override _transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback): void {
    this.bytes += chunk.length;
    this.hash?.update(chunk);
    cb(null, chunk);
  }
}

// Node 24 ships zstd in zlib (the image's runtime); older @types/node do not declare it
interface ZstdZlib {
  createZstdCompress?: (o?: { params?: Record<number, number> }) => Transform;
  createZstdDecompress?: () => Transform;
  constants: { ZSTD_c_compressionLevel?: number };
}
const z = zlib as unknown as ZstdZlib;

function zstdCompress(level: number): Transform {
  const param = z.constants.ZSTD_c_compressionLevel;
  if (!z.createZstdCompress || param === undefined) throw new Error('This Node has no zstd. Cloud Run machines run Node 24.');
  return z.createZstdCompress({ params: { [param]: level } });
}

function zstdDecompress(): Transform {
  if (!z.createZstdDecompress) throw new Error('This Node has no zstd. Cloud Run machines run Node 24.');
  return z.createZstdDecompress();
}

/** the dependency cache key: the lockfile's hash plus what makes node_modules non-portable */
export function lockKeyOf(lockfile: Buffer | string, platform: string = process.platform, arch: string = process.arch, nodeVersion: string = process.versions.node): string {
  const h = createHash('sha256').update(lockfile).digest('hex').slice(0, 40);
  return `${h}-${platform}-${arch}-node${nodeVersion.split('.')[0]}`;
}

// bun's two lockfiles come last, so the key of a repository that has an older lockfile too stays the same
export const LOCKFILES = ['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'bun.lock', 'bun.lockb'] as const;

export function lockfileKey(repoDir: string): string {
  for (const f of LOCKFILES) {
    const p = join(repoDir, f);
    if (existsSync(p)) return lockKeyOf(readFileSync(p));
  }
  throw new Error(`no lockfile in ${repoDir}`);
}

export interface TransferResult { object?: string; rawBytes: number; zBytes: number; ms: number; rawHash?: string }

export interface SnapshotsOptions {
  signer: SnapshotSigner;
  fetchImpl?: typeof fetch;
  zstdLevel?: number;
  /** tar runs as a child of the daemon; it is not a sandbox call, so BoxManager does not own it */
  spawnTar?: (args: string[], stdio: 'read' | 'write') => ChildProcess;
}

function waitExit(child: ChildProcess, name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let stderr = '';
    child.stderr?.on('data', (d: Buffer) => { stderr = (stderr + d.toString('utf8')).slice(-2000); });
    child.once('error', reject);
    child.once('close', (code: number | null) => (code === 0 ? resolve() : reject(new Error(`${name} exited ${code}: ${stderr}`))));
  });
}

export class Snapshots {
  private readonly call: typeof fetch;
  private readonly level: number;
  private readonly spawnTar: NonNullable<SnapshotsOptions['spawnTar']>;

  constructor(private readonly opts: SnapshotsOptions) {
    this.call = opts.fetchImpl ?? fetch;
    this.level = opts.zstdLevel ?? 3;
    this.spawnTar = opts.spawnTar ?? ((args, stdio) => spawn('tar', args, { stdio: stdio === 'read' ? ['ignore', 'pipe', 'pipe'] : ['pipe', 'ignore', 'pipe'] }));
  }

  async exists(key: string): Promise<boolean> { return (await this.opts.signer.sign('snapshot', key, 'exists'))?.exists === true; }

  /** sign the object and open its GCS resumable session */
  private async openSession(kind: SnapshotKind, key: string): Promise<{ session: string; object?: string }> {
    const signed = await this.opts.signer.sign(kind, key, 'upload');
    if (!signed?.url) throw new Error(`snapshot upload ${kind}/${key}: no signed url`);
    const start = await this.call(signed.url, { method: 'POST', headers: { 'x-goog-resumable': 'start', 'content-type': 'application/zstd' } });
    const session = start.headers.get('location');
    if (start.status !== 201 || !session) throw new Error(`resumable start: HTTP ${start.status}`);
    return { session, ...(signed.object ? { object: signed.object } : {}) };
  }

  private async send(open: { session: string; object?: string }, source: Readable, t0: number): Promise<TransferResult> {
    const raw = new ByteCounter(true);
    const packed = new ByteCounter();
    await pipeline(source, raw, zstdCompress(this.level), packed, new ResumableSink(open.session, this.call));
    return { ...(open.object ? { object: open.object } : {}), rawBytes: raw.bytes, zBytes: packed.bytes, ms: Date.now() - t0, rawHash: raw.sha256 };
  }

  /** `source` must hold its data until it is read (a file stream does). Never pass a child's stdout:
   *  this awaits the signer and the session first, and Node drains the unread stdout of a child that
   *  exits meanwhile. save() handles tar for that reason. */
  async upload(kind: SnapshotKind, key: string, source: Readable): Promise<TransferResult> {
    const t0 = Date.now();
    return this.send(await this.openSession(kind, key), source, t0);
  }

  /** null = no such object */
  async download(kind: SnapshotKind, key: string, sink: Writable, signal?: AbortSignal): Promise<TransferResult | null> {
    const t0 = Date.now();
    const signed = await this.opts.signer.sign(kind, key, 'download');
    if (!signed?.url) return null;
    const res = await this.call(signed.url, { ...(signal ? { signal } : {}) });
    if (!res.ok || !res.body) throw new Error(`download ${kind}/${key}: HTTP ${res.status}`);
    const packed = new ByteCounter();
    const raw = new ByteCounter(true);
    await pipeline(Readable.fromWeb(res.body as unknown as NodeReadableStream), packed, zstdDecompress(), raw, sink, { ...(signal ? { signal } : {}) });
    return { ...(signed.object ? { object: signed.object } : {}), rawBytes: raw.bytes, zBytes: packed.bytes, ms: Date.now() - t0, rawHash: raw.sha256 };
  }

  /** a raw object (no zstd, no tar) into `file`: a repository bundle is stored as the plain file
   *  `git bundle create` wrote, so git reads it as it is. false = no such object. */
  async fetchRaw(kind: 'bundle', key: string, file: string): Promise<boolean> {
    const signed = await this.opts.signer.sign(kind, key, 'download');
    if (!signed?.url) return false;
    const res = await this.call(signed.url);
    if (!res.ok || !res.body) throw new Error(`download ${kind}/${key}: HTTP ${res.status}`);
    await pipeline(Readable.fromWeb(res.body as unknown as NodeReadableStream), createWriteStream(file));
    return true;
  }

  /** the machine's stored snapshots under `prefix`; [] when this nm-api cannot list */
  async list(prefix: string): Promise<ListedSnapshot[]> {
    return this.opts.signer.list ? this.opts.signer.list('snapshot', prefix) : [];
  }

  /** `tar -C root -cf - paths… | zstd` to the object. The session opens BEFORE tar spawns, and tar's
   *  stdout joins the pipeline in the same tick. Node resumes the unread stdout of a child that exits
   *  (child_process flushStdio), so a tree small enough to tar during an await lost every byte, and
   *  the drain stored an empty archive. A short archive fails the save instead of reaching GCS as
   *  the state. */
  async save(kind: SnapshotKind, key: string, root: string, paths: string[], exclude: string[] = []): Promise<TransferResult> {
    const t0 = Date.now();
    const open = await this.openSession(kind, key);
    const tar = this.spawnTar(['-C', root, '-cf', '-', ...exclude.map(p => `--exclude=${p.replace(/([\\*?\[\]])/g, '\\$1')}`), '--', ...paths], 'read');
    const done = waitExit(tar, 'tar -c');
    const sent = tar.stdout ? this.send(open, tar.stdout, t0) : Promise.reject(new Error('tar -c has no stdout'));
    try {
      const [res] = await Promise.all([sent, done]);
      if (res.rawBytes < TAR_MIN_BYTES) throw new Error(`tar -c of ${paths.join(' ')} gave ${res.rawBytes} bytes; a tar archive has at least ${TAR_MIN_BYTES}`);
      return res;
    } catch (err) {
      // an error in the stream stops the upload before its final chunk, so GCS keeps no object
      tar.stdout?.destroy(err instanceof Error ? err : new Error(String(err)));
      tar.kill();
      await Promise.allSettled([sent, done]);
      throw err;
    }
  }

  /** the object into `tar -C root -xf -`; null = no such object. A short or unreadable archive is an
   *  error with tar's own words, so the boot can fall back (lifecycle.ts restoreWork). */
  async restore(kind: SnapshotKind, key: string, root: string, signal?: AbortSignal): Promise<TransferResult | null> {
    mkdirSync(root, { recursive: true });
    // Read past tar's zero end markers to transport EOF. An early successful tar exit can
    // otherwise race pipeline's final write and reject a valid archive with EPIPE.
    const tar = this.spawnTar(['-C', root, '--ignore-zeros', '-xf', '-'], 'write');
    const done = waitExit(tar, 'tar -x');
    if (!tar.stdin) throw new Error('tar -x has no stdin');
    let res: TransferResult | null;
    try {
      res = await this.download(kind, key, tar.stdin, signal);
    } catch (err) {
      tar.kill();
      // tar's stderr says why better than the EPIPE it left the download with; a fence or a refused
      // token keeps its type, because the lifecycle acts on it
      const why = await done.then(() => null, (e: unknown) => e);
      if (err instanceof EpochFencedError || err instanceof MachineTokenRejected || !(why instanceof Error)) throw err;
      throw new Error(`restore ${kind}/${key}: ${why.message} (${String(err)})`);
    }
    if (!res) { tar.stdin.end(); await done.catch(() => {}); return null; }
    await done;
    if (res.rawBytes < TAR_MIN_BYTES) throw new Error(`restore ${kind}/${key}: the object holds ${res.rawBytes} bytes; a tar archive has at least ${TAR_MIN_BYTES}`);
    return res;
  }

  /** `sandbox tar` of the box overlay, uploaded, then the file removed */
  async boxSave(box: BoxManager, key: string, file: string): Promise<TransferResult & { sandboxTarMs: number }> {
    const tar = await box.tar(file);
    if (tar.code !== 0) throw new Error(`sandbox tar exited ${tar.code}: ${tar.stderr.slice(-300)}`);
    try {
      const size = existsSync(file) ? statSync(file).size : 0;
      if (size < TAR_MIN_BYTES) throw new Error(`sandbox tar wrote ${size} bytes; a tar archive has at least ${TAR_MIN_BYTES}`);
      return { ...(await this.upload('snapshot', key, createReadStream(file))), sandboxTarMs: tar.ms };
    } finally {
      rmSync(file, { force: true });
    }
  }

  /** the overlay snapshot as a plain tar file for `sandbox run --import-tar`; null = none */
  async boxFetch(key: string, file: string): Promise<TransferResult | null> {
    const res = await this.download('snapshot', key, createWriteStream(file));
    if (res && res.rawBytes < TAR_MIN_BYTES) throw new Error(`box snapshot ${key} holds ${res.rawBytes} bytes; a tar archive has at least ${TAR_MIN_BYTES}`);
    return res;
  }

  /** node_modules under the lockfile's key, once per key. `paths`: every dependency tree, relative to
   *  repoDir. A pnpm workspace keeps a node_modules in each package as well as the root one, and a
   *  restore of the root alone leaves every package without its links. */
  async depSave(repoDir: string, paths: string[] = ['node_modules']): Promise<{ key: string; skipped: boolean; result?: TransferResult }> {
    const key = lockfileKey(repoDir);
    const exists = await this.opts.signer.sign('depcache', key, 'exists');
    if (exists?.exists) return { key, skipped: true };
    return { key, skipped: false, result: await this.save('depcache', key, repoDir, paths) };
  }

  async depRestore(repoDir: string): Promise<{ key: string; hit: boolean; result?: TransferResult }> {
    const key = lockfileKey(repoDir);
    const result = await this.restore('depcache', key, repoDir);
    return result ? { key, hit: true, result } : { key, hit: false };
  }
}
