// run from apps/desktop:  pnpm exec tsx --test src/main/brain-artifact-reader.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readBrainArtifact } from './brain-artifact-reader';

// nothing listens on the discard port, so a cache miss fails at once and never reaches a real server
const apiUrl = 'http://127.0.0.1:9';
const id = '797b447d-30c2-5fde-8957-6ce95e980ea1';
const workspace = 'b6eab88b-d208-4e4a-9cc8-7543edab8a74';

test('a cached artifact sits in a folder per server, principal and workspace, and reads by its checksum', async () => {
  const cacheRoot = await mkdtemp(join(tmpdir(), 'nm-brain-artifacts-'));
  try {
    const bytes = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const dir = join(cacheRoot, 'http___127.0.0.1_9', 'user_2abc', workspace);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, id), bytes);
    const read = await readBrainArtifact({ apiUrl, actorId: 'user_2abc', workspace, cacheRoot }, id, sha256, 'image/svg+xml');
    assert.equal(read.sha256, sha256);
    assert.equal(read.mime, 'image/svg+xml');
    assert.deepEqual(Buffer.from(read.bytes), bytes);
  } finally {
    await rm(cacheRoot, { recursive: true, force: true });
  }
});

test('a scope part that names a parent folder is refused before any read', async () => {
  const cacheRoot = await mkdtemp(join(tmpdir(), 'nm-brain-artifacts-'));
  try {
    await assert.rejects(readBrainArtifact({ apiUrl, actorId: '..', workspace, cacheRoot }, id, 'a'.repeat(64)), /Invalid artifact scope/);
    await assert.rejects(readBrainArtifact({ apiUrl, actorId: 'user_2abc', workspace: '', cacheRoot }, id, 'a'.repeat(64)), /Invalid artifact scope/);
  } finally {
    await rm(cacheRoot, { recursive: true, force: true });
  }
});
