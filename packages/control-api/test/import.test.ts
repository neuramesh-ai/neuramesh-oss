// The import lane without a database (unit U7, docs/export-format.md "Import"): the batch body
// schema, the route's answers that need no store (404 under NM_LOCAL, 413 by declared size), and
// the memory store's 501. The lane itself is proven in import.pg.test.ts.
import type { Actor } from '@neuramesh/shared';
import { EXPORT_FORMAT, EXPORT_TABLES, EXPORT_VERSION, IMPORT_BATCH_MAX_BYTES } from '@neuramesh/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { ImportBatchSchema } from '../src/import';
import { MemoryStore } from '../src/store';

const george: Actor = { kind: 'human', id: '00000000-0000-0000-0000-000000000001' };
const hdr = { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(george) };
const WS = '0b8c1a2e-1111-4222-8333-444455556666';
const IMPORT = '33333333-3333-4333-8333-333333333333';
const j = (r: Response): Promise<any> => r.json() as Promise<any>;

const manifest = {
  format: EXPORT_FORMAT, version: EXPORT_VERSION, workspace: { id: WS, name: 'Local', slug: 'local' }, exportedAt: '2026-09-12T10:00:00.000Z',
  counts: Object.fromEntries(EXPORT_TABLES.map((t) => [t, 0])),
};
const good = { importId: IMPORT, seq: 3, table: 'messages', rows: [{ id: '44444444-4444-4444-8444-444444444444', workspace_id: WS, body: 'hi' }] };

describe('ImportBatchSchema', () => {
  it('accepts a row batch, an opening batch, a link pass, and an echoed idMap', () => {
    expect(ImportBatchSchema.safeParse(good).success).toBe(true);
    expect(ImportBatchSchema.safeParse({ importId: IMPORT, seq: 0, table: 'projects', rows: [], first: { manifest, totalBytes: 1234 } }).success).toBe(true);
    expect(ImportBatchSchema.safeParse({ ...good, table: 'threads', links: true }).success).toBe(true);
    expect(ImportBatchSchema.safeParse({ ...good, idMap: { '55555555-5555-4555-8555-555555555555': '66666666-6666-4666-8666-666666666666' } }).success).toBe(true);
    expect(ImportBatchSchema.safeParse({ ...good, last: true }).success).toBe(true);
  });

  it('refuses a bad shape, an unknown table, and a table that never travels', () => {
    expect(ImportBatchSchema.safeParse({ ...good, rows: 'x' }).success).toBe(false);
    expect(ImportBatchSchema.safeParse({ ...good, rows: [{ id: 'not-a-uuid' }] }).success).toBe(false);
    expect(ImportBatchSchema.safeParse({ ...good, seq: -1 }).success).toBe(false);
    expect(ImportBatchSchema.safeParse({ ...good, importId: 'move-1' }).success).toBe(false);
    expect(ImportBatchSchema.safeParse({ ...good, table: 'nope' }).success).toBe(false);
    for (const t of ['machines', 'provider_credentials', 'machine_tokens', 'workspace_members', 'credit_grants']) {
      expect(ImportBatchSchema.safeParse({ ...good, table: t }).success, t).toBe(false);
    }
  });

  it('the opening batch rides alone at seq 0, a link pass needs a table with late keys, an idMap holds uuids', () => {
    expect(ImportBatchSchema.safeParse({ ...good, seq: 0, first: { manifest, totalBytes: 1 } }).success).toBe(false);
    expect(ImportBatchSchema.safeParse({ importId: IMPORT, seq: 1, table: 'projects', rows: [], first: { manifest, totalBytes: 1 } }).success).toBe(false);
    expect(ImportBatchSchema.safeParse({ importId: IMPORT, seq: 0, table: 'projects', rows: [], first: { manifest: { ...manifest, format: 'zip' }, totalBytes: 1 } }).success).toBe(false);
    expect(ImportBatchSchema.safeParse({ ...good, table: 'projects', links: true }).success).toBe(false);
    expect(ImportBatchSchema.safeParse({ ...good, idMap: { rex: 'iris' } }).success).toBe(false);
  });
});

describe('POST /v1/workspaces/:id/import/batches without postgres', () => {
  const app = createApp(new MemoryStore());
  const post = (headers: Record<string, string> = {}) =>
    app.request(`/v1/workspaces/${WS}/import/batches`, { method: 'POST', headers: { ...hdr, ...headers }, body: JSON.stringify(good) });
  const local = process.env['NM_LOCAL'];
  afterEach(() => {
    if (local === undefined) delete process.env['NM_LOCAL']; else process.env['NM_LOCAL'] = local;
  });

  it('answers 501 on the memory store, the way the export does', async () => {
    delete process.env['NM_LOCAL'];
    const res = await post();
    expect(res.status).toBe(501);
    expect((await j(res)).code).toBe('NOT_FOUND');
  });

  it('does not exist on the local stack', async () => {
    process.env['NM_LOCAL'] = '1';
    const res = await post();
    expect(res.status).toBe(404);
    expect((await j(res)).code).toBe('NOT_FOUND');
  });

  it('refuses a declared body over 4 MB before it reads anything', async () => {
    delete process.env['NM_LOCAL'];
    const res = await post({ 'content-length': String(IMPORT_BATCH_MAX_BYTES + 1) });
    expect(res.status).toBe(413);
    expect(await j(res)).toMatchObject({ code: 'IMPORT_TOO_LARGE', error: 'The batch is over 4 MB. Send smaller batches.' });
  });
});
