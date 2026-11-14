import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import * as zlib from 'node:zlib';
import { Snapshots } from './snapshot';

const zstd = zlib as unknown as { zstdCompressSync?: (data: Buffer) => Buffer };

test('extract consumes valid tar padding through EOF and hashes every archive byte', { skip: !zstd.zstdCompressSync }, async t => {
  const root = mkdtempSync(join(tmpdir(), 'nm-tar-eof-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'retained.txt'), 'retained file bytes');
  // Valid zero padding larger than a pipe buffer makes an early tar exit observable.
  // The old reader extracts the file but then fails EPIPE/premature close on Linux.
  const archive = Buffer.concat([
    execFileSync('tar', ['-C', root, '-cf', '-', 'retained.txt']),
    Buffer.alloc(1024 * 1024),
  ]);
  const packed = zstd.zstdCompressSync!(archive);
  const snapshots = new Snapshots({
    signer: { sign: async () => ({ url: 'https://fixture.invalid/snapshot' }) },
    fetchImpl: async () => new Response(new Uint8Array(packed)),
  });
  const result = await snapshots.restore('snapshot', 'fixture', join(root, 'restored'));
  assert.equal(result?.rawBytes, archive.length);
  assert.equal(result?.rawHash, createHash('sha256').update(archive).digest('hex'));
  assert.equal(readFileSync(join(root, 'restored', 'retained.txt'), 'utf8'), 'retained file bytes');
});

test('extract still rejects a corrupt tar header', { skip: !zstd.zstdCompressSync }, async t => {
  const root = mkdtempSync(join(tmpdir(), 'nm-tar-tail-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'retained.txt'), 'retained file bytes');
  const archive = execFileSync('tar', ['-C', root, '-cf', '-', 'retained.txt']);
  archive[0] = archive[0]! ^ 1; // Break the header checksum inside a valid zstd frame.
  const packed = zstd.zstdCompressSync!(archive);
  const snapshots = new Snapshots({
    signer: { sign: async () => ({ url: 'https://fixture.invalid/snapshot' }) },
    fetchImpl: async () => new Response(new Uint8Array(packed)),
  });
  await assert.rejects(snapshots.restore('snapshot', 'fixture', join(root, 'restored')));
});
