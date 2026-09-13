// Reply dedupe against the REAL schema (migration 0060) — proves the partial unique
// index (author_id, reply_to) actually refuses a concurrent second reply and that the
// pgstore maps 23505 → CONFLICT (409) through the /v1/messages route the daemons use.
// Run via scripts/test-pg.sh — skipped without DATABASE_URL.
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { PostgresStore } from '../src/pgstore';

const DB = process.env['DATABASE_URL'];
const WS = 'a0000000-0000-0000-0000-00000000000a';
const NOVA = { kind: 'agent', id: '30000000-0000-0000-0000-000000000003' };
const REX = { kind: 'agent', id: '20000000-0000-0000-0000-000000000002' };
const GEO = { kind: 'human', id: '00000000-0000-0000-0000-000000000001' };

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

describe.skipIf(!DB)('reply dedupe (0060) — the index is the enforcement', () => {
  it('same agent + same trigger: first lands, second is 409 CONFLICT; another agent still may', async () => {
    // a real human trigger message to hang the replies off (reply_to is a real FK)
    const trig = await sendMsg(GEO, { body: 'human trigger — please pick this up' });
    expect(trig.status).toBe(200);
    const trigId = ((await trig.json()) as { message: { id: string } }).message.id;

    const first = await sendMsg(NOVA, { body: "I'm the assigned worker — picking it up.", replyTo: trigId });
    expect(first.status).toBe(200);

    const dup = await sendMsg(NOVA, { body: "I'm the assigned worker — picking it up.", replyTo: trigId });
    expect(dup.status).toBe(409);
    expect(((await dup.json()) as { code: string }).code).toBe('CONFLICT');

    // a different agent answering the same trigger is fine (e.g. orchestrator + assignee)
    const other = await sendMsg(REX, { body: 'noted — routing.', replyTo: trigId });
    expect(other.status).toBe(200);
  });

  it('a human replyTo is ignored (humans are never deduped)', async () => {
    const trig = await sendMsg(GEO, { body: 'another trigger' });
    const trigId = ((await trig.json()) as { message: { id: string } }).message.id;
    const h1 = await sendMsg(GEO, { body: 'human note one', replyTo: trigId });
    const h2 = await sendMsg(GEO, { body: 'human note two', replyTo: trigId });
    expect(h1.status).toBe(200);
    expect(h2.status).toBe(200);
  });
});
