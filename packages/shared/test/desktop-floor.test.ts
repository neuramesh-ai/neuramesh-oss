// the supported desktops and the floor, tied to the contract snapshots (docs/46).
//
// SUPPORTED_DESKTOP_VERSIONS is kept by hand: the two newest PUBLISHED desktops, moved in the
// ledger-header PR after a publish (docs/11 §2), never in the version-bump PR. these tests hold it
// to the snapshot files, and the floor to the older of the two. the control-api's contract test
// checks the files that a bump must add.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { belowFloor, compareVersions, MIN_DESKTOP_VERSION, SUPPORTED_DESKTOP_VERSIONS } from '../src/desktop-floor';

const dir = join(import.meta.dirname, '../../../contracts/desktop');
const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
const versions = files.map((f) => f.slice(0, -'.json'.length));

describe('the supported desktops', () => {
  test('every snapshot file is named for its version and says so inside', () => {
    expect(files.length, 'contracts/desktop holds no snapshot: the checks below would pass on nothing').toBeGreaterThanOrEqual(2);
    for (const f of files) {
      expect(f, 'a snapshot is named <major>.<minor>.<patch>.json').toMatch(/^\d+\.\d+\.\d+\.json$/);
      const snap = JSON.parse(readFileSync(join(dir, f), 'utf8')) as { format: number; version: string };
      expect({ file: f, format: snap.format, version: snap.version }).toEqual({ file: f, format: 1, version: f.slice(0, -'.json'.length) });
    }
  });

  test('SUPPORTED_DESKTOP_VERSIONS names two versions, newest first, and each has its snapshot', () => {
    const [newest, older] = SUPPORTED_DESKTOP_VERSIONS;
    expect(SUPPORTED_DESKTOP_VERSIONS).toHaveLength(2);
    expect(compareVersions(newest, older), 'SUPPORTED_DESKTOP_VERSIONS names two different versions, newest first').toBe(1);
    for (const v of SUPPORTED_DESKTOP_VERSIONS) {
      expect(versions, `SUPPORTED_DESKTOP_VERSIONS names ${v}, and contracts/desktop/${v}.json does not exist. A supported desktop is a published one, and its version-bump PR wrote the snapshot (docs/46).`).toContain(v);
    }
  });

  test('MIN_DESKTOP_VERSION is the older of the two', () => {
    expect(MIN_DESKTOP_VERSION).toBe(SUPPORTED_DESKTOP_VERSIONS[1]);
  });
});

describe('versions compare by number', () => {
  test('segment by segment, never as text', () => {
    expect(['0.150.0', '0.9.0', '0.149.1', '1.0.0', '0.149.0'].sort(compareVersions)).toEqual(['0.9.0', '0.149.0', '0.149.1', '0.150.0', '1.0.0']);
    expect(compareVersions('0.150.0', '0.150.0')).toBe(0);
  });

  test('belowFloor: only an older version is below, and a missing floor never is', () => {
    expect(belowFloor('0.148.2', '0.149.0')).toBe(true);
    expect(belowFloor('0.149.0', '0.149.0')).toBe(false);
    expect(belowFloor('0.151.0', '0.149.0')).toBe(false);
    expect(belowFloor('0.148.0', null)).toBe(false);
    expect(belowFloor('0.148.0', 'soon')).toBe(false);
  });
});
