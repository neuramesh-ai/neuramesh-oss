// The thread-root foreign key, against the REAL schema (migration 0098). This is the
// regression suite for a production outage: POST /v1/messages 500'd on
//
//   PostgresError: insert or update on table "threads" violates foreign key constraint
//   "threads_root_message_id_fkey"
//   detail: Key (root_message_id)=(8ec87b60-…) is not present in table "messages".
//
// postMessage wrote root_message_id in the thread INSERT, one statement BEFORE inserting the
// message it pointed at. Two shapes reached that line, and both are exercised below:
//
//   1. A composer send names its OWN message as the root (docs/31 — the thread hangs off the
//      message that opened it). That id cannot exist yet by definition.
//   2. A reply into a thread whose root has since been PURGED (a channel delete takes the
//      room's messages with it). The client keeps retrying the same POST, gets the same 500
//      every time, and every later send from that machine queues behind the poison op — which
//      is how one stale id silenced every agent in the workspace.
//
// Only Postgres has the FK, so only a pg test can catch this; the in-memory store mirrors the
// same fallback so the two cannot disagree (store-parity). Run via scripts/test-pg.sh —
// skipped without DATABASE_URL.
import type { Actor } from '@neuramesh/shared';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { PostgresStore } from '../src/pgstore';

const DB = process.env['DATABASE_URL'];
const WS = 'a0000000-0000-0000-0000-00000000000a';

const george: Actor = { kind: 'human', id: '00000000-0000-0000-0000-000000000001' };
const rex: Actor = { kind: 'agent', id: '20000000-0000-0000-0000-000000000002', role: 'orchestrator' };

const store = DB ? new PostgresStore(DB) : null;
const app = store ? createApp(store) : null;
const j = (r: Response): Promise<any> => r.json() as Promise<any>;

function send(actor: Actor, body: unknown) {
  return app!.request('/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) },
    body: JSON.stringify(body),
  });
}

/** the row the FK guards — no store accessor exposes it, and raw SQL is the pg-test idiom */
async function rootOf(threadId: string): Promise<string | null> {
  const sql = postgres(DB!);
  try {
    const [row] = await sql<Array<{ root_message_id: string | null }>>`select root_message_id from threads where id = ${threadId}::uuid`;
    return row?.root_message_id ?? null;
  } finally {
    await sql.end();
  }
}

afterAll(async () => {
  await store?.close();
});

describe.skipIf(!DB)('threads.root_message_id can never break the FK (migration 0098)', () => {
  it('a composer send naming its OWN id as the root succeeds and roots on itself', async () => {
    const msgId = randomUUID();
    const threadId = randomUUID();
    const r = await send(george, { workspace: WS, channel: 'dev', id: msgId, threadId, rootMessageId: msgId, body: 'Kick off a thread from the composer' });
    expect(r.status).toBe(200); // was 500: FK violated one statement before msgId existed
    expect((await j(r)).message.id).toBe(msgId);
    expect(await rootOf(threadId)).toBe(msgId);
  });

  it('a reply naming a REAL older message roots the thread on that message, not the reply', async () => {
    const rootId = randomUUID();
    await send(george, { workspace: WS, channel: 'dev', id: rootId, body: 'a room message worth replying to' });

    const threadId = randomUUID();
    const replyId = randomUUID();
    const r = await send(george, { workspace: WS, channel: 'dev', id: replyId, threadId, rootMessageId: rootId, body: 'replying in a thread' });
    expect(r.status).toBe(200);
    // the whole point of a named root: it stays in the feed and the thread hangs off it
    expect(await rootOf(threadId)).toBe(rootId);
  });

  it('a root that no longer exists degrades to this message — never a 500, never a poison retry', async () => {
    const purged = randomUUID(); // a message id the DB has never seen (or has since purged)
    const threadId = randomUUID();
    const msgId = randomUUID();
    const r = await send(george, { workspace: WS, channel: 'dev', id: msgId, threadId, rootMessageId: purged, body: 'sent into a thread whose root was purged' });
    expect(r.status).toBe(200); // was 500 forever — the outage
    expect(await rootOf(threadId)).toBe(msgId);

    // and the retry of that same delivery is still acked, so a wedged queue drains
    const again = await send(george, { workspace: WS, channel: 'dev', id: msgId, threadId, rootMessageId: purged, body: 'sent into a thread whose root was purged' });
    expect(again.status).toBe(200);
  });

  it("an agent's thread reply into a purged-root thread lands — the shape that silenced rex", async () => {
    const trigger = randomUUID();
    await send(george, { workspace: WS, channel: 'dev', id: trigger, body: 'hey @rex, whats the status of the tasks we are working on?' });

    const threadId = randomUUID();
    const r = await send(rex, { workspace: WS, channel: 'dev', threadId, rootMessageId: randomUUID(), replyTo: trigger, body: 'Board status: …' });
    expect(r.status).toBe(200);
  });
});
