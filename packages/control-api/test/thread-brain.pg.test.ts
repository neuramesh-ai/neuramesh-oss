// The thread brain override against the REAL schema (migration 0101) — run via
// scripts/test-pg.sh, skipped without DATABASE_URL.
//
// This file exists because of a bug the in-memory tests could not see. `setThreadBrain` first
// bound the SERIALIZED STRING to a `::jsonb` cast, and postgres.js encoded it as a json *scalar*
// (`"{\"developer\":…}"`) rather than an object. Every unit test passed; the first live write was
// rejected by 0101's `jsonb_typeof(brain_override) = 'object'` check. The check earned itself in
// under a minute — and the lesson is that a jsonb round-trip is only proven against postgres.
import type { Actor } from '@neuramesh/shared';
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { PostgresStore } from '../src/pgstore';

const DB = process.env['DATABASE_URL'];
const WS = 'a0000000-0000-0000-0000-00000000000a';
const CH = 'c0000000-0000-0000-0000-00000000000b';
const george: Actor = { kind: 'human', id: '00000000-0000-0000-0000-000000000001' };
const rex: Actor = { kind: 'agent', id: '20000000-0000-0000-0000-000000000002', role: 'orchestrator' };

const OPUS = 'claude-opus-4-8';
const SONNET = 'claude-sonnet-5';

const store = DB ? new PostgresStore(DB) : null;
const app = store ? createApp(store) : null;
// a second, read-only connection: the store's own `sql` is private, and the point of this file
// is to look at the column with its own eyes rather than through a method that might agree with
// the bug it is checking for
const db = DB ? postgres(DB, { max: 1, prepare: false, onnotice: () => {} }) : null;
const j = (r: Response): Promise<any> => r.json() as Promise<any>;

const post = (actor: Actor, path: string, body: unknown) =>
  app!.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) },
    body: JSON.stringify(body),
  });
const born = async () => {
  const threadId = crypto.randomUUID();
  await post(george, '/v1/messages', { workspace: WS, channel: CH, body: 'pricing table?', threadId });
  return threadId;
};
/** read the column RAW, so a json scalar cannot masquerade as an object */
const raw = async (threadId: string) => {
  const [row] = await db!<Array<{ brain_override: unknown; kind: string | null }>>`
    select brain_override, jsonb_typeof(brain_override) as kind from threads where id = ${threadId}::uuid`;
  return row;
};

afterAll(async () => { await store?.close(); await db?.end(); });

describe.skipIf(!DB)('thread.set_brain against real postgres', () => {
  it('stores an OBJECT, not a json string — the shape the daemon reads back', async () => {
    const threadId = await born();
    const res = await post(george, '/v1/commands', { type: 'thread.set_brain', workspace: WS, threadId, override: { developer: OPUS, reviewer: SONNET } });
    expect(res.status).toBe(200);
    const row = await raw(threadId);
    expect(row?.kind).toBe('object'); // the assertion the unit tests structurally could not make
    expect(row?.brain_override).toEqual({ developer: OPUS, reviewer: SONNET });
  });

  it('Reset writes NULL, so the column is empty rather than holding `{}`', async () => {
    const threadId = await born();
    await post(george, '/v1/commands', { type: 'thread.set_brain', workspace: WS, threadId, override: { developer: OPUS } });
    await post(george, '/v1/commands', { type: 'thread.set_brain', workspace: WS, threadId, override: null });
    const row = await raw(threadId);
    expect(row?.brain_override).toBeNull();
    expect(row?.kind).toBeNull();
  });

  it('a birth-time draft lands as an OBJECT too — a different INSERT from the update path', async () => {
    const threadId = crypto.randomUUID();
    await post(george, '/v1/messages', { workspace: WS, channel: CH, body: 'start on opus', threadId, brainOverride: { developer: OPUS } });
    const row = await raw(threadId);
    expect(row?.kind).toBe('object');
    expect(row?.brain_override).toEqual({ developer: OPUS });
    // …and a later message cannot re-brain it
    await post(george, '/v1/messages', { workspace: WS, channel: CH, body: 'later', threadId, brainOverride: { reviewer: SONNET } });
    expect((await raw(threadId))?.brain_override).toEqual({ developer: OPUS });
  });

  it('an agent is refused by the server, not by the picker', async () => {
    const threadId = await born();
    const res = await post(rex, '/v1/commands', { type: 'thread.set_brain', workspace: WS, threadId, override: { developer: OPUS } });
    expect(res.status).toBe(403);
    expect((await j(res)).code).toBe('HUMAN_ONLY');
    expect((await raw(threadId))?.brain_override).toBeNull();
  });

  it('a model outside the catalog never reaches the column', async () => {
    const threadId = await born();
    const res = await post(george, '/v1/commands', { type: 'thread.set_brain', workspace: WS, threadId, override: { developer: 'claude-imaginary-9' } });
    expect(res.status).toBe(422);
    expect((await raw(threadId))?.brain_override).toBeNull();
  });
});
