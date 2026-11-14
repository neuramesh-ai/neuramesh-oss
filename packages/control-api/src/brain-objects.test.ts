import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it, vi } from 'vitest';
import { configuredBrainObjects, FileBrainObjects, GcsBrainObjects } from './brain-objects';

it('permits real file persistence for the isolated loopback harness and refuses production or public binding', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nm-brain-harness-'));
  try {
    vi.stubEnv('NM_LOCAL', '0'); vi.stubEnv('NM_BRAIN_GCS_BUCKET', '');
    vi.stubEnv('NM_BRAIN_STORAGE_DIR', root); vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('NM_ALLOW_ACTOR_HEADER', '1'); vi.stubEnv('HOST', '127.0.0.1');
    const objects = configuredBrainObjects()!;
    const bytes = Buffer.from('real isolated coding transcript');
    const ref = await objects.put('qualification/transcript', bytes, 'text/plain');
    expect(await objects.get(ref)).toEqual(bytes);
    vi.stubEnv('NODE_ENV', 'production'); expect(configuredBrainObjects()).toBeNull();
    vi.stubEnv('NODE_ENV', 'development'); vi.stubEnv('HOST', '0.0.0.0'); expect(configuredBrainObjects()).toBeNull();
    vi.stubEnv('HOST', '127.0.0.1'); vi.stubEnv('NM_ALLOW_ACTOR_HEADER', '0'); expect(configuredBrainObjects()).toBeNull();
  } finally { vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); }
});

it('atomically writes immutable objects, verifies bytes, and rejects path traversal', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nm-brain-objects-'));
  try {
    const objects = new FileBrainObjects(root);
    const bytes = Buffer.from('durable complete transcript');
    const refs = await Promise.all([objects.put('thread/segment', bytes, 'text/plain'), objects.put('thread/segment', bytes, 'text/plain')]);
    expect(refs[0]).toEqual(refs[1]);
    expect(await objects.get(refs[0]!)).toEqual(bytes);
    await expect(objects.put('thread/segment', Buffer.from('overwrite'), 'text/plain')).rejects.toThrow('checksum');
    await expect(objects.put('../escape', bytes, 'text/plain')).rejects.toThrow('path');
    await writeFile(join(root, 'thread/segment'), 'corruption');
    await expect(objects.get(refs[0]!)).rejects.toThrow('checksum');
  } finally { await rm(root, { recursive: true, force: true }); }
});

it('keeps existing local objects readable after selecting GCS while writing new objects to GCS', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nm-brain-upgrade-'));
  const bytes = Buffer.from('existing recorded conversation');
  try {
    vi.stubEnv('NM_LOCAL', '1');
    vi.stubEnv('NM_BRAIN_STORAGE_DIR', root);
    vi.stubEnv('NM_BRAIN_GCS_BUCKET', '');
    const oldRef = await configuredBrainObjects()!.put('thread/old', bytes, 'text/plain');
    vi.stubEnv('NM_BRAIN_GCS_BUCKET', 'private-test-bucket');
    const newRef = { ...oldRef, backend: 'gcs' as const, bucket: 'private-test-bucket', key: 'thread/new', generation: '123' };
    const upload = vi.spyOn(GcsBrainObjects.prototype, 'put').mockResolvedValue(newRef);
    const download = vi.spyOn(GcsBrainObjects.prototype, 'get').mockResolvedValue(bytes);
    const upgraded = configuredBrainObjects()!;
    expect(await upgraded.get(oldRef)).toEqual(bytes);
    expect(download).not.toHaveBeenCalled();
    expect(await upgraded.put('thread/new', bytes, 'text/plain')).toEqual(newRef);
    expect(upload).toHaveBeenCalledWith('thread/new', bytes, 'text/plain');
    expect(await upgraded.get(newRef)).toEqual(bytes);
    expect(download).toHaveBeenCalledWith(newRef);
    expect(configuredBrainObjects()).toBe(upgraded);
    vi.restoreAllMocks();
    vi.stubEnv('NM_LOCAL', '0');
    await expect(configuredBrainObjects()!.get(oldRef)).rejects.toThrow('backend');
  } finally {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  }
});
