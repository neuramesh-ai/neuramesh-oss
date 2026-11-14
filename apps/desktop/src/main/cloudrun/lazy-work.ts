import { createHash } from 'node:crypto';
import { chmodSync, chownSync, createReadStream, linkSync, lchownSync, lstatSync, lutimesSync, mkdirSync, readdirSync, readlinkSync, renameSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { Writable } from 'node:stream';
import { dirname, join, relative, resolve, sep } from 'node:path';
import type { Hydration } from '../harness/hydration';
import { chunkKey, coldPaths, fingerprint, manifestKey, parseManifest, segmentDependencies, type LazyManifest, type LazySegment } from './lazy-format';
import { EpochFencedError, MachineTokenRejected, type Snapshots } from './snapshot';

/** All extraction happens in staging. Only verified, complete segments reach the live tree. */
export class LazyWork implements Hydration {
  private manifest: LazyManifest | null = null;
  private loaded = new Set<string>();
  private active = new Map<string, Promise<void>>();
  private controllers = new Map<string, AbortController>();
  private stopped = false;
  private placeholders = new Map<string, number>();
  private markerPlaceholders = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private transfers = 0;
  private waiters: Array<{ resolve(): void; reject(error: Error): void }> = [];
  constructor(private o: { root: string; work: string; brain?: string; epoch: number; snapshots: Snapshots; log: (event: string, fields?: Record<string, unknown>) => void; valid: () => boolean }) {}
  private full(path: string) { return join(this.o.root, path); }
  private related(path: string): LazySegment[] {
    const p = resolve(path);
    return (this.manifest?.segments ?? []).filter(s => { const f = this.full(s.path); return p === f || p.startsWith(f + sep) || f.startsWith(p + sep); });
  }
  pending(path: string): boolean { return this.related(path).some(s => !this.loaded.has(s.path)); }
  async ensure(path: string): Promise<void> { for (const s of this.related(path)) await this.hydrate(s, new Set()); }
  async matching(test: (path: string) => boolean): Promise<void> { for (const s of this.manifest?.segments ?? []) if (test(this.full(s.path))) await this.hydrate(s, new Set()); }
  private check(): void { if (this.stopped || !this.o.valid()) throw Error('Workspace restoration is paused while this machine stops.'); }

  async restore(key: string): Promise<void> {
    if (!manifestKey(key)) throw Error('Expected a lazy workspace manifest.');
    const parts: Buffer[] = []; let size = 0;
    const sink = new Writable({ write(bytes: Buffer, _encoding, done) { size += bytes.length; if (size > 8 * 1024 * 1024) return done(Error('Workspace manifest exceeds the supported size.')); parts.push(Buffer.from(bytes)); done(); } });
    if (!(await this.o.snapshots.download('snapshot', key, sink))) throw Error('The workspace manifest is unavailable.');
    {
      const m = parseManifest(JSON.parse(Buffer.concat(parts).toString('utf8')), this.o.work);
      if (key !== `manifest-e${m.epoch}`) throw Error('Workspace manifest epoch does not match its object key.');
      const core = await this.o.snapshots.restore('snapshot', m.core, this.o.root);
      if (!core) throw Error('The workspace core is unavailable.');
      if (core.rawHash !== m.coreHash) throw Error('The saved workspace core checksum does not match.');
      this.manifest = m;
      for (const s of m.segments) {
        // Existing Git worktrees must remain discoverable and must not be pruned as missing.
        const full = this.full(s.path);
        this.safeParents(full);
        const present = lstatSync(full, { throwIfNoEntry: false });
        if (present && !present.isDirectory()) continue; // preserve an overlay symlink/file
        mkdirSync(full, { recursive: true });
        if (s.gitMarker && !lstatSync(join(full, '.git'), { throwIfNoEntry: false })) {
          const marker = join(this.full(s.path), '.git');
          writeFileSync(marker, s.gitMarker, { mode: s.gitMode ?? 0o600 });
          if (s.gitUid !== undefined && s.gitGid !== undefined) chownSync(marker, s.gitUid, s.gitGid);
          this.markerPlaceholders.add(marker);
        }
        if (readdirSync(this.full(s.path)).every(n => n === '.git' && !!s.gitMarker)) this.placeholders.set(this.full(s.path), lstatSync(this.full(s.path)).mtimeMs);
      }
      this.o.log('lazy-core-ready', { epoch: this.o.epoch, pendingSegments: m.segments.length });
    }
  }

  private hydrate(s: LazySegment, visiting: Set<string>): Promise<void> {
    if (this.loaded.has(s.path) || visiting.has(s.path)) return Promise.resolve();
    const held = this.active.get(s.path); if (held) return held;
    const next = new Set(visiting).add(s.path);
    const work = this.load(s, next).finally(() => { this.active.delete(s.path); this.controllers.delete(s.path); });
    this.active.set(s.path, work); return work;
  }
  private async load(s: LazySegment, visiting: Set<string>): Promise<void> {
    this.check();
    for (const p of s.dependencies) await this.hydrate(this.manifest!.segments.find(d => d.path === p)!, visiting);
    this.check();
    // At most two streams: an unrelated background download cannot monopolize the
    // connection needed by an opened thread, and many tabs cannot exhaust memory.
    await this.acquire();
    const tag = createHash('sha256').update(s.path).digest('hex').slice(0, 16);
    const stage = join(this.o.root, `.hydrate-e${this.o.epoch}-${tag}`), abort = new AbortController();
    this.controllers.set(s.path, abort);
    const started = Date.now();
    try {
      mkdirSync(stage, { recursive: true });
      const result = await this.o.snapshots.restore('snapshot', s.key, stage, abort.signal);
      if (!result) throw Error('Saved workspace segment is unavailable.');
      if (await fingerprint(join(stage, s.path)) !== s.hash) throw Error('Saved workspace segment checksum does not match.');
      this.check();
      // Re-check the authenticated epoch after a long signed download, before installing bytes.
      if (!(await this.o.snapshots.exists(s.key))) throw Error('Saved workspace segment is unavailable.');
      this.check();
      await this.publish(join(stage, s.path), this.full(s.path), tag);
      this.loaded.add(s.path);
      this.o.log('lazy-segment-ready', { epoch: this.o.epoch, segment: tag, bytes: result.rawBytes, compressedBytes: result.zBytes, ms: Date.now() - started });
    } finally { rmSync(stage, { recursive: true, force: true }); this.release(); }
  }

  private async acquire(): Promise<void> {
    this.check();
    if (this.transfers >= 2) await new Promise<void>((resolve, reject) => this.waiters.push({ resolve, reject }));
    else this.transfers++;
    try { this.check(); } catch (e) { this.release(); throw e; }
  }
  private release(): void { const next = this.waiters.shift(); if (next) next.resolve(); else this.transfers--; }

  /** Preserve new local writes. Conflicting saved files are kept in the next core snapshot too. */
  private async publish(from: string, to: string, tag: string): Promise<void> {
    this.check();
    this.safeParents(to);
    const before = lstatSync(from), present = lstatSync(to, { throwIfNoEntry: false });
    if (!present && !before.isDirectory()) {
      try {
        mkdirSync(dirname(to), { recursive: true });
        if (before.isSymbolicLink()) { symlinkSync(readlinkSync(from), to); lchownSync(to, before.uid, before.gid); lutimesSync(to, before.atime, before.mtime); }
        else linkSync(from, to); // Atomic no-replace, also preserves archive hard links and ownership.
        return;
      } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; return this.publish(from, to, tag); }
    }
    if (before.isDirectory() && (!present || present.isDirectory())) {
      const placeholder = !present || this.placeholders.get(to) === present.mtimeMs;
      if (!present) mkdirSync(to, { recursive: true });
      for (const name of readdirSync(from)) await this.publish(join(from, name), join(to, name), tag);
      if (placeholder) { chmodSync(to, before.mode & 0o7777); chownSync(to, before.uid, before.gid); utimesSync(to, before.atime, before.mtime); }
      return;
    }
    if (before.isFile() && present?.isFile() && before.size === present.size) {
      const hash = async (path: string) => { const h = createHash('sha256'); for await (const b of createReadStream(path)) h.update(b); return h.digest('hex'); };
      const same = await hash(from) === await hash(to);
      this.check();
      if (same) {
        if (this.markerPlaceholders.has(to)) { chmodSync(to, before.mode & 0o7777); chownSync(to, before.uid, before.gid); utimesSync(to, before.atime, before.mtime); }
        return;
      }
    }
    let conflict = join(this.o.root, this.o.work, '.restore-conflicts', `e${this.o.epoch}`, tag, relative(this.o.root, to));
    const base = conflict;
    for (let n = 1; lstatSync(conflict, { throwIfNoEntry: false }); n++) conflict = `${base}.saved-${n}`;
    this.safeParents(conflict);
    mkdirSync(dirname(conflict), { recursive: true }); renameSync(from, conflict);
    this.o.log('lazy-local-write-preserved', { epoch: this.o.epoch, segment: tag });
  }

  /** Never follow a new local symlink while merging an archive into the live tree. */
  private safeParents(path: string): void {
    const rel = relative(this.o.root, path);
    if (!rel || rel.startsWith('..' + sep) || rel === '..' || resolve(this.o.root, rel) !== path) throw Error('Workspace restore escaped its root.');
    let parent = this.o.root;
    for (const part of rel.split(sep).slice(0, -1)) {
      parent = join(parent, part);
      const s = lstatSync(parent, { throwIfNoEntry: false });
      if (s && !s.isDirectory()) throw Error('Workspace restore found a changed parent directory. Saved files remain in recovery storage.');
    }
  }

  startBackground(delayMs = 30_000): void {
    if (this.timer || this.stopped) return;
    this.timer = setTimeout(() => { this.timer = null; void this.background().catch(e => this.o.log('lazy-background-paused', { error: e instanceof Error ? e.message : 'restore paused' })); }, delayMs); this.timer.unref?.();
  }
  private async background(): Promise<void> {
    for (const s of this.manifest?.segments ?? []) {
      if (this.stopped || !this.o.valid()) return;
      try { await this.hydrate(s, new Set()); }
      catch (e) {
        if (e instanceof EpochFencedError || e instanceof MachineTokenRejected) { this.stop(); throw e; }
        if (!this.stopped) this.o.log('lazy-background-pending', { epoch: this.o.epoch, error: e instanceof Error ? e.message : 'restore failed' });
      }
    }
  }
  stop(): void { this.stopped = true; if (this.timer) clearTimeout(this.timer); this.timer = null; for (const a of this.controllers.values()) a.abort(); for (const next of this.waiters.splice(0)) next.reject(Error('Workspace restoration is paused while this machine stops.')); }
  async pause(): Promise<void> { this.stop(); await Promise.allSettled([...this.active.values()]); }

  async save(): Promise<{ key: string; coreBytes: number; segments: number }> {
    await this.pause();
    const carried = (this.manifest?.segments ?? []).filter(s => !this.loaded.has(s.path));
    const paths = coldPaths(this.o.root, this.o.work, this.o.brain).filter(p => !carried.some(s => p === s.path || p.startsWith(s.path + '/')));
    const deps = segmentDependencies(this.o.root, [...paths, ...carried.map(s => s.path)]), segments = [...carried];
    for (const path of paths) {
      const hash = await fingerprint(this.full(path)), key = chunkKey(path, hash);
      const exists = await this.o.snapshots.exists(key);
      if (!exists) await this.o.snapshots.save('snapshot', key, this.o.root, [path]);
      segments.push({ path, key, hash, ...(deps.get(path) ?? { dependencies: [] }) });
    }
    const core = `core-e${this.o.epoch}`;
    // Unloaded paths may contain newer local overlay files. Keep those in core while
    // carrying the original remote segment; a later verified merge preserves both.
    const saved = await this.o.snapshots.save('snapshot', core, this.o.root, [this.o.work], paths);
    if (!saved.rawHash) throw Error('The workspace core has no verified checksum.');
    const manifest: LazyManifest = { format: 'nm-lazy-work', version: 1, epoch: this.o.epoch, work: this.o.work, core, coreHash: saved.rawHash, segments };
    parseManifest(manifest, this.o.work);
    const key = `manifest-e${this.o.epoch}`, file = join(this.o.root, `.manifest-write-e${this.o.epoch}.json`);
    try { writeFileSync(file, JSON.stringify(manifest), { mode: 0o600 }); await this.o.snapshots.upload('snapshot', key, createReadStream(file)); }
    finally { rmSync(file, { force: true }); }
    this.o.log('lazy-snapshot-saved', { epoch: this.o.epoch, coreBytes: saved.rawBytes, segments: segments.length, carried: carried.length });
    return { key, coreBytes: saved.rawBytes, segments: segments.length };
  }
}

export function createLazyWork(cfg: { root: string; work: string; brainDir: string }, epoch: number, snapshots: Snapshots, valid: () => boolean, log: (event: string, fields?: Record<string, unknown>) => void): LazyWork {
  return new LazyWork({ root: cfg.root, work: cfg.work, brain: relative(cfg.root, cfg.brainDir), epoch, snapshots, valid, log });
}
