// The machine half of a repository bundle download (repo-bundle.ts over snapshot.ts fetchRaw): the
// bundle is signed as kind 'bundle', read raw (no zstd, no tar) into a temp folder outside the work
// dir, and the folder goes with the dispose or with any failure.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { fetchBundle } from './repo-bundle';
import { Snapshots, type SnapshotSigner } from './snapshot';

const BYTES = Buffer.from('# v2 git bundle\nfake refs and pack\n');

function snapshots(o: { stored: boolean; status?: number }) {
  const signed: Array<[string, string, string]> = [];
  const signer: SnapshotSigner = {
    sign: async (kind, key, op) => { signed.push([kind, key, op]); return o.stored ? { url: `https://gcs.test/${kind}/${key}`, object: `v1/workspaces/w/repos/${key}.bundle` } : null; },
  };
  const fetchImpl = (async (url: string) => {
    assert.equal(url, 'https://gcs.test/bundle/fixture-1');
    return new Response(o.status && o.status !== 200 ? 'nope' : new Uint8Array(BYTES), { status: o.status ?? 200 });
  }) as unknown as typeof fetch;
  return { s: new Snapshots({ signer, fetchImpl }), signed };
}

test('fetchBundle: the raw object into a temp file, signed as a bundle download; dispose removes it', async () => {
  const root = mkdtempSync('/tmp/nm-repo-bundle-');
  try {
    const { s, signed } = snapshots({ stored: true });
    const got = await fetchBundle(s, 'fixture-1', root);
    assert.deepEqual(signed, [['bundle', 'fixture-1', 'download']]);
    assert.equal(dirname(dirname(got.file)), root);
    assert.deepEqual(readFileSync(got.file), BYTES, 'the bytes are the bundle as uploaded: no zstd, no tar');
    got.dispose();
    assert.equal(existsSync(dirname(got.file)), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('fetchBundle: an absent key and a failed download throw, and leave no folder behind', async () => {
  const root = mkdtempSync('/tmp/nm-repo-bundle-');
  try {
    await assert.rejects(fetchBundle(snapshots({ stored: false }).s, 'fixture-1', root), /not in this workspace's storage/);
    await assert.rejects(fetchBundle(snapshots({ stored: true, status: 403 }).s, 'fixture-1', root), /HTTP 403/);
    assert.deepEqual(readdirSync(root), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
