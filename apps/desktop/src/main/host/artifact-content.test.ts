import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { prepareScratchWorkspace } from '../rework';
import { readArtifactText, registerArtifactReader } from './artifact-content';
import { readBrand } from './brandnote';

const body = '# Product\nCloud documents retain the complete source.';
const contentHash = createHash('sha256').update(body).digest('hex');
const row = { id: 'artifact-a', workspace_id: 'workspace-a', name: 'business-profile.md', kind: 'doc', inline_content: null, storage_path: 'brain:artifact-a', content_hash: contentHash, mime: 'text/markdown', created_by_kind: 'agent', source: null };

test('brand context reads authenticated cloud document bytes when the replica has only metadata', async () => {
  const db = { getAll: async <T>(sql: string): Promise<T[]> => (sql.includes('from channels c') ? [{ kind: 'marketing', website: 'example.test', marketing: null, logo: null }] : sql.includes('from artifacts') ? [row] : []) as T[] };
  registerArtifactReader(db, { workspace: 'workspace-a', apiUrl: 'https://api.test', headers: async () => ({ authorization: 'Bearer credential' }), fetchImpl: async (url, init) => {
    assert.match(String(url), /artifacts\/artifact-a\?workspace=workspace-a/);
    assert.equal((init?.headers as Record<string, string>).authorization, 'Bearer credential');
    return new Response(body);
  } });
  const facts = await readBrand(db, 'room-a');
  assert.equal(facts.docs.get('business-profile.md'), body);
});

test('artifact reads reject checksum mismatch or an unavailable workspace reader instead of empty text', async () => {
  const db = {};
  registerArtifactReader(db, { workspace: 'workspace-a', apiUrl: 'https://api.test', headers: async () => ({}), fetchImpl: async () => new Response('wrong bytes') });
  await assert.rejects(readArtifactText(db, row), /checksum/);
  await assert.rejects(readArtifactText(db, { ...row, workspace_id: 'different-workspace' }), /reader is unavailable/);
  assert.equal(await readArtifactText(db, { inline_content: 'Legacy text' }), 'Legacy text');
});


test('a fresh rework workspace restores binary cloud artifacts without a text conversion', async () => {
  const root = await mkdtemp('/tmp/nm-rework-cloud-');
  const bytes = Buffer.from([0, 255, 128, 10, 13, 240, 18]);
  const artifact = { ...row, kind: 'file', name: 'result.bin', content_hash: createHash('sha256').update(bytes).digest('hex') };
  const db = { getAll: async <T>(): Promise<T[]> => [artifact] as T[] };
  registerArtifactReader(db, { workspace: 'workspace-a', apiUrl: 'https://api.test', headers: async () => ({}), fetchImpl: async () => new Response(bytes) });
  try {
    const note = await prepareScratchWorkspace(db, 'task-a', root);
    assert.match(note, /result.bin/);
    assert.deepEqual(await readFile(join(root, 'result.bin')), bytes);
  } finally { await rm(root, { recursive: true, force: true }); }
});
