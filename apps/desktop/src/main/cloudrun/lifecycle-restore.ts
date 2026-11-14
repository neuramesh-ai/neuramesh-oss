// Restore fallbacks leave no partial work tree behind.
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { EpochFencedError, MachineTokenRejected, type ListedSnapshot } from './snapshot';
import { fallbackKeys, boxKeyFor, type SnapshotKeys, type RestoreOutcome, type LifecycleOptions } from './lifecycle-contract';
import { manifestKey } from './lazy-format';

export async function restoreWorkSnapshot(named: SnapshotKeys, o: Pick<LifecycleOptions, 'snapshots' | 'cfg'>, log: NonNullable<LifecycleOptions['log']>, restoreManifest?: (key: string) => Promise<void>): Promise<RestoreOutcome> {
    const failed: RestoreOutcome['failed'] = [];
    const attempt = async (key: string): Promise<boolean> => {
      try {
        if (manifestKey(key)) {
          if (!restoreManifest) throw Error('This machine cannot read the saved workspace manifest.');
          await restoreManifest(key); return true;
        }
        if (await o.snapshots.restore('snapshot', key, o.cfg.root)) return true;
        failed.push({ key, error: 'missing' });
      } catch (e) {
        if (e instanceof EpochFencedError || e instanceof MachineTokenRejected) throw e;
        failed.push({ key, error: String(e instanceof Error ? e.message : e).slice(0, 300) });
      }
      rmSync(o.cfg.workDir, { recursive: true, force: true });
      mkdirSync(o.cfg.workDir, { recursive: true });
      return false;
    };
    if (await attempt(named.work)) return { work: named.work, box: named.box ?? null, failed };
    if (manifestKey(named.work)) throw Error('Saved workspace recovery is unavailable. No stale or empty replacement will be created.');
    let listed: ListedSnapshot[] = [];
    try {
      listed = await o.snapshots.list('');
    } catch (e) {
      if (e instanceof EpochFencedError || e instanceof MachineTokenRejected) throw e;
      log('snapshot-list-error', { error: String(e) });
    }
    for (const key of fallbackKeys(named.work, listed)) {
      if (await attempt(key)) return { work: key, box: boxKeyFor(key, named, listed), failed };
    }
    return { work: null, box: null, failed };
}

/** A failed box import falls back to a fresh box without discarding the restored work tree. */
export async function startRestoredBox(o: Pick<LifecycleOptions, 'box' | 'cfg' | 'snapshots'>, epoch: number, boxKey: string | null, log: NonNullable<LifecycleOptions['log']>): Promise<string | null> {
    const box = o.box;
    if (!box) return null;
    const boxTar = join(o.cfg.root, `.box-restore-e${epoch}.tar`);
    try {
      let importTar: string | null = null;
      if (boxKey) {
        try {
          if (await o.snapshots.boxFetch(boxKey, boxTar)) importTar = boxTar;
          else log('box-restore-missing', { key: boxKey });
        } catch (e) {
          if (e instanceof EpochFencedError || e instanceof MachineTokenRejected) throw e;
          log('box-restore-error', { key: boxKey, error: String(e) });
        }
      }
      let run = await box.run(importTar);
      if (run.code !== 0 && importTar) {
        log('box-import-failed', { key: boxKey, error: run.stderr.slice(-300) });
        run = await box.run(null);
      }
      if (run.code !== 0) {
        const why = `sandbox run exited ${run.code}: ${run.stderr.slice(-300)}`;
        log('box-unavailable', { epoch, error: why });
        return why;
      }
    } finally {
      rmSync(boxTar, { force: true });
    }
    return null;
}
