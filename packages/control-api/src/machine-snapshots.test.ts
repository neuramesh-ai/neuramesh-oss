// The snapshot URL route (machine-snapshots.ts) and the V4 signer under it (gcs-sign.ts), with the
// storage and the fence as fakes. The contract: a machine bearer only; the object path comes from
// the TOKEN's workspace and machine, never the body; a key is one safe path segment; an upload is
// a signed resumable start, fenced by epoch; a download or an exists reads the object first.
import type { Actor } from '@neuramesh/shared';
import { createHash } from 'node:crypto';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { DomainError } from './errors';
import { signV4, v4Canonical, type SnapshotStorage } from './gcs-sign';
import { hashMachineToken } from './machine-auth';
import { SIGNED_URL_SECONDS, machineSnapshotRoutes, snapshotKeyOf, snapshotObject, snapshotPrefix, type UploadFence } from './machine-snapshots';
import type { Store } from './store';

const WS = '0f0f0f0f-0000-4000-8000-000000000001';
const MACHINE = '1a1a1a1a-0000-4000-8000-000000000001';
const OTHER_WS = '0f0f0f0f-0000-4000-8000-000000000999';
const TOKEN = `nmm_${'ab'.repeat(24)}`;
const NOW = new Date('2026-10-19T12:00:00.000Z');
const EMAIL = 'nm-api@p.iam.gserviceaccount.com';

const store = {
  machineByTokenHash: async (hash: string) =>
    hash === hashMachineToken(TOKEN) ? { id: MACHINE, workspace_id: WS, owner_user_id: 'u1', kind: 'member', owner_clerk_id: null } : null,
} as unknown as Store;

/** deterministic signer: the "signature" is sha256 of what it was asked to sign */
const signer = { email: async () => EMAIL, signBlob: async (p: Buffer) => createHash('sha256').update(p).digest() };

function mkApp(o: { objects?: Record<string, number>; storage?: SnapshotStorage | null; fence?: UploadFence; noList?: boolean } = {}) {
  const fenced: [string, number | undefined][] = [];
  const listedPrefixes: string[] = [];
  const storage: SnapshotStorage = {
    bucket: 'nm-snapshots',
    signer,
    stat: async (object) => (o.objects && object in o.objects ? { size: o.objects[object]! } : null),
    ...(o.noList ? {} : {
      list: async (prefix: string) => {
        listedPrefixes.push(prefix);
        return Object.entries(o.objects ?? {}).filter(([name]) => name.startsWith(prefix)).map(([name, size]) => ({ name, size }));
      },
    }),
  };
  const app = new Hono<{ Variables: { actor: Actor } }>();
  // stand-in for app.ts's /v1 gate: the route re-derives the machine from the bearer either way
  app.use('/v1/*', async (c, next) => { c.set('actor', { kind: 'human', id: 'u1' }); await next(); });
  machineSnapshotRoutes(app, store, {
    storage: o.storage === undefined ? storage : o.storage,
    fence: o.fence ?? (async (id, epoch) => void fenced.push([id, epoch])),
    now: () => NOW,
  });
  return { app, fenced, listedPrefixes };
}

const sign = (app: Hono<{ Variables: { actor: Actor } }>, body: unknown, auth: string | null = `Bearer ${TOKEN}`) =>
  app.request('/v1/machines/snapshots/sign', { method: 'POST', headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) }, body: JSON.stringify(body) });

describe('POST /v1/machines/snapshots/sign: who may ask', () => {
  it('is a machine bearer only: a person is 403 MACHINE_ONLY, an unknown token 401', async () => {
    const { app } = mkApp();
    const person = await sign(app, { kind: 'snapshot', key: 'work-e1', op: 'exists' }, 'Bearer eyJhbGciOi.clerk.jwt');
    expect(person.status).toBe(403);
    expect(((await person.json()) as { code: string }).code).toBe('MACHINE_ONLY');
    expect((await sign(app, { kind: 'snapshot', key: 'work-e1', op: 'exists' }, null)).status).toBe(403);
    expect((await sign(app, { kind: 'snapshot', key: 'work-e1', op: 'exists' }, `Bearer nmm_${'cd'.repeat(24)}`)).status).toBe(401);
  });

  it('scopes to the token, never the body: a named workspace or machine is ignored', async () => {
    const { app } = mkApp();
    const res = await sign(app, { kind: 'snapshot', key: 'work-e1', op: 'exists', machineId: 'someone-else', workspaceId: OTHER_WS, workspace: OTHER_WS });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ exists: false, size: null, object: `v1/workspaces/${WS}/machines/${MACHINE}/snapshots/work-e1.tar.zst` });
  });

  it('refuses a key that is not one safe path segment', async () => {
    const { app } = mkApp();
    for (const key of ['', '../x', 'a/b', '.hidden', '-lead', 'a b', 'x'.repeat(129), 'ä', 'k%2F']) {
      expect((await sign(app, { kind: 'snapshot', key, op: 'exists' })).status, key).toBe(400);
    }
    expect((await sign(app, { kind: 'snapshot', key: 'box_e2.v1-x', op: 'exists' })).status).toBe(200);
    expect((await sign(app, { kind: 'other', key: 'k', op: 'exists' })).status).toBe(400);
    expect((await sign(app, { kind: 'snapshot', key: 'k', op: 'delete' })).status).toBe(400);
    expect(() => snapshotObject('snapshot', WS, MACHINE, '../escape')).toThrow(DomainError);
  });

  it('503s when snapshot storage is not configured', async () => {
    const { app } = mkApp({ storage: null });
    expect((await sign(app, { kind: 'snapshot', key: 'k', op: 'exists' })).status).toBe(503);
  });
});

describe('POST /v1/machines/snapshots/sign: what it mints', () => {
  it('upload: a signed resumable POST for exactly the token\'s object, fenced with the epoch it named', async () => {
    const { app, fenced } = mkApp();
    const res = await sign(app, { kind: 'snapshot', key: 'work-e1', op: 'upload', epoch: 1 });
    expect(res.status).toBe(200);
    const out = (await res.json()) as { url: string; object: string; method: string; headers: Record<string, string>; expiresInSeconds: number };
    expect(fenced).toEqual([[MACHINE, 1]]);
    expect(out.method).toBe('POST');
    expect(out.headers).toEqual({ 'content-type': 'application/zstd', 'x-goog-resumable': 'start' });
    expect(out.expiresInSeconds).toBe(1800);
    const url = new URL(out.url);
    expect(url.origin + url.pathname).toBe(`https://storage.googleapis.com/nm-snapshots/v1/workspaces/${WS}/machines/${MACHINE}/snapshots/work-e1.tar.zst`);
    expect(url.searchParams.get('X-Goog-Algorithm')).toBe('GOOG4-RSA-SHA256');
    expect(url.searchParams.get('X-Goog-Credential')).toBe(`${EMAIL}/20261019/auto/storage/goog4_request`);
    expect(url.searchParams.get('X-Goog-Date')).toBe('20261019T120000Z');
    expect(url.searchParams.get('X-Goog-Expires')).toBe(String(SIGNED_URL_SECONDS));
    expect(url.searchParams.get('X-Goog-SignedHeaders')).toBe('content-type;host;x-goog-resumable');
    expect(url.searchParams.get('X-Goog-Signature')).toMatch(/^[a-f0-9]{64}$/);
  });

  it('a stale epoch is 409 STALE_EPOCH and mints nothing', async () => {
    const { app } = mkApp({ fence: async () => { throw new DomainError('STALE_EPOCH', 'epoch 0 is behind 1'); } });
    const res = await sign(app, { kind: 'snapshot', key: 'work-e0', op: 'upload', epoch: 0 });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string; url?: string };
    expect(body.code).toBe('STALE_EPOCH');
    expect(body.url).toBeUndefined();
  });

  it('depcache lives under the workspace, not the machine', async () => {
    const { app } = mkApp();
    const out = (await (await sign(app, { kind: 'depcache', key: 'pnpm-3f2a', op: 'upload', epoch: 0 })).json()) as { object: string };
    expect(out.object).toBe(`v1/workspaces/${WS}/depcache/pnpm-3f2a.tar.zst`);
  });

  it('a depcache download stamps the object as used (the depcache pass keeps it); a snapshot download does not', async () => {
    const dep = `v1/workspaces/${WS}/depcache/pnpm-3f2a.tar.zst`;
    const snap = `v1/workspaces/${WS}/machines/${MACHINE}/snapshots/work-e1.tar.zst`;
    const touched: string[] = [];
    const storage: SnapshotStorage = {
      bucket: 'nm-snapshots', signer, stat: async (o) => (o === dep || o === snap ? { size: 10 } : null),
      touch: async (o) => { touched.push(o); },
    };
    const { app } = mkApp({ storage });
    expect((await sign(app, { kind: 'depcache', key: 'pnpm-3f2a', op: 'download' })).status).toBe(200);
    expect((await sign(app, { kind: 'snapshot', key: 'work-e1', op: 'download' })).status).toBe(200);
    expect((await sign(app, { kind: 'depcache', key: 'pnpm-3f2a', op: 'exists' })).status).toBe(200);
    await new Promise((r) => setTimeout(r, 0));
    expect(touched).toEqual([dep]);
  });

  it('download: 404 when absent; a signed GET with its size when present; exists says both', async () => {
    const object = `v1/workspaces/${WS}/machines/${MACHINE}/snapshots/box-e1.tar.zst`;
    const { app } = mkApp({ objects: { [object]: 4096 } });
    expect((await sign(app, { kind: 'snapshot', key: 'nope', op: 'download' })).status).toBe(404);
    const got = (await (await sign(app, { kind: 'snapshot', key: 'box-e1', op: 'download' })).json()) as { url: string; size: number; method: string };
    expect(got.size).toBe(4096);
    expect(got.method).toBe('GET');
    expect(new URL(got.url).searchParams.get('X-Goog-SignedHeaders')).toBe('host');
    expect(await (await sign(app, { kind: 'snapshot', key: 'box-e1', op: 'exists' })).json()).toEqual({ exists: true, size: 4096, object });
  });
});

describe('POST /v1/machines/snapshots/sign: op list (the restore fallback)', () => {
  const mine = `v1/workspaces/${WS}/machines/${MACHINE}/snapshots/`;
  it('answers the keys under the token\'s own machine prefix with their sizes, unfenced; foreign and odd objects are dropped', async () => {
    const { app, fenced, listedPrefixes } = mkApp({ objects: {
      [`${mine}work-e1.tar.zst`]: 9,
      [`${mine}work-e2.tar.zst`]: 52_000,
      [`${mine}box-e2.tar.zst`]: 7_000,
      [`${mine}notes.txt`]: 3,
      [`v1/workspaces/${WS}/machines/someone-else/snapshots/work-e9.tar.zst`]: 1,
      [`v1/workspaces/${OTHER_WS}/machines/${MACHINE}/snapshots/work-e8.tar.zst`]: 1,
    } });
    const res = await sign(app, { kind: 'snapshot', op: 'list', prefix: '', epoch: 3, machineId: 'someone-else' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ keys: [{ key: 'work-e1', size: 9 }, { key: 'work-e2', size: 52_000 }, { key: 'box-e2', size: 7_000 }], truncated: false });
    expect(listedPrefixes).toEqual([mine]);
    expect(fenced).toEqual([]);
    expect(await (await sign(app, { kind: 'snapshot', op: 'list', prefix: 'work-e' })).json()).toEqual({ keys: [{ key: 'work-e1', size: 9 }, { key: 'work-e2', size: 52_000 }], truncated: false });
  });

  it('refuses a prefix that is not plain key characters, a depcache listing, and a key-less download', async () => {
    const { app } = mkApp();
    for (const prefix of ['../', 'a/b', 'x'.repeat(65)]) expect((await sign(app, { kind: 'snapshot', op: 'list', prefix })).status, prefix).toBe(400);
    expect((await sign(app, { kind: 'depcache', op: 'list' })).status).toBe(400);
    expect((await sign(app, { kind: 'snapshot', op: 'download' })).status).toBe(400);
  });

  it('501s on a storage that cannot list, so the machine boots fresh rather than guessing', async () => {
    const { app } = mkApp({ noList: true });
    expect((await sign(app, { kind: 'snapshot', op: 'list' })).status).toBe(501);
  });

  it('snapshotKeyOf: only a key-shaped name with the archive suffix under the prefix', () => {
    expect(snapshotKeyOf(mine, `${mine}work-e3.tar.zst`)).toBe('work-e3');
    expect(snapshotKeyOf(mine, `${mine}work-e3.tar`)).toBeNull();
    expect(snapshotKeyOf(mine, `${mine}a/b.tar.zst`)).toBeNull();
    expect(snapshotKeyOf(mine, `elsewhere/work-e3.tar.zst`)).toBeNull();
    expect(snapshotPrefix(WS, MACHINE)).toBe(mine);
  });
});

describe('the V4 canonical form', () => {
  it('signs GOOG4-RSA-SHA256 over the canonical request with a blank line after the headers', async () => {
    const req = { bucket: 'b', object: 'v1/a b/c.tar.zst', method: 'POST' as const, expiresSeconds: 1800, headers: { 'Content-Type': 'application/zstd', 'X-Goog-Resumable': 'start' }, now: NOW };
    const { path, query, stringToSign } = v4Canonical(req, EMAIL);
    expect(path).toBe('/b/v1/a%20b/c.tar.zst');
    const canonical = [
      'POST', path, query,
      'content-type:application/zstd\nhost:storage.googleapis.com\nx-goog-resumable:start\n',
      'content-type;host;x-goog-resumable', 'UNSIGNED-PAYLOAD',
    ].join('\n');
    expect(stringToSign).toBe(['GOOG4-RSA-SHA256', '20261019T120000Z', '20261019/auto/storage/goog4_request', createHash('sha256').update(canonical).digest('hex')].join('\n'));
    expect(query).toBe(`X-Goog-Algorithm=GOOG4-RSA-SHA256&X-Goog-Credential=nm-api%40p.iam.gserviceaccount.com%2F20261019%2Fauto%2Fstorage%2Fgoog4_request&X-Goog-Date=20261019T120000Z&X-Goog-Expires=1800&X-Goog-SignedHeaders=content-type%3Bhost%3Bx-goog-resumable`);
    const url = await signV4(req, signer);
    expect(url.endsWith(`&X-Goog-Signature=${createHash('sha256').update(stringToSign).digest('hex')}`)).toBe(true);
  });
});
