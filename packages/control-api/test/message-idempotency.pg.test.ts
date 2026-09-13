// POST /v1/messages must be idempotent on the client-supplied id. PowerSync clients
// (mobile) retry uploads by design: if the POST lands but the response is lost (phone
// locked mid-send), the SAME message is re-sent. Before this fix the retry hit the
// messages primary key (23505) → an uncaught 500 → the client retried forever and its
// upload queue wedged behind the poison op — every later message never published.
// Run via scripts/test-pg.sh — skipped without DATABASE_URL.
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { PostgresStore } from '../src/pgstore';

const DB = process.env['DATABASE_URL'];
const WS = 'a0000000-0000-0000-0000-00000000000a';
const GEO = { kind: 'human', id: '00000000-0000-0000-0000-000000000001' };
const REX = { kind: 'agent', id: '20000000-0000-0000-0000-000000000002' };

const store = DB ? new PostgresStore(DB) : null;
const app = store ? createApp(store) : null;

function sendMsg(actor: { kind: string; id: string }, body: Record<string, unknown>) {
  return app!.request('/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) },
    body: JSON.stringify({ workspace: WS, channel: 'dev', ...body }),
  });
}

afterAll(async () => {
  await store?.close();
});

describe.skipIf(!DB)('message idempotency — a retried delivery is an ack, not an error', () => {
  it('same id retried by the same author: 200 both times, one row, one event', async () => {
    const id = crypto.randomUUID();
    const first = await sendMsg(GEO, { id, body: 'hey rex, what should we work on next?' });
    expect(first.status).toBe(200);

    // the PowerSync retry: identical payload, identical id
    const retry = await sendMsg(GEO, { id, body: 'hey rex, what should we work on next?' });
    expect(retry.status).toBe(200);
    expect(((await retry.json()) as { message: { id: string } }).message.id).toBe(id);

    const sql = postgres(DB!);
    try {
      const [msgs] = await sql`select count(*)::int as n from messages where id = ${id}`;
      expect(msgs!['n']).toBe(1);
      // the event log must not double either — the retry is an ack, not new activity
      const [evs] = await sql`select count(*)::int as n from events where type = 'message.posted' and payload->>'preview' like 'hey rex, what should we work on next%'`;
      expect(evs!['n']).toBe(1);
    } finally {
      await sql.end();
    }
  });

  it('same id from a DIFFERENT author is id-squatting: 409, original row untouched', async () => {
    const id = crypto.randomUUID();
    const first = await sendMsg(GEO, { id, body: 'the original' });
    expect(first.status).toBe(200);

    const squat = await sendMsg(REX, { id, body: 'not the original' });
    expect(squat.status).toBe(409);

    const sql = postgres(DB!);
    try {
      const [row] = await sql`select body, author_kind from messages where id = ${id}`;
      expect(row).toMatchObject({ body: 'the original', author_kind: 'human' });
    } finally {
      await sql.end();
    }
  });

  it('an agent card retry does not duplicate its decision row', async () => {
    const id = crypto.randomUUID();
    const card = 'Which path?\n```nmq\n{"question":"Which path A?","options":["a","b"]}\n```';
    const first = await sendMsg(REX, { id, body: card });
    expect(first.status).toBe(200);
    const retry = await sendMsg(REX, { id, body: card });
    expect(retry.status).toBe(200);

    const sql = postgres(DB!);
    try {
      const [n] = await sql`select count(*)::int as n from decisions where message_id = ${id}::uuid`;
      expect(n!['n']).toBe(1);
    } finally {
      await sql.end();
    }
  });
});
