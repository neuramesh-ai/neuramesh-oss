// Decisions (docs/12 slice 2) against the REAL schema (migration 0061) — validates the
// server-side card extraction in POST /v1/messages (transactional with the message
// insert), the same-question supersede rule, and the exactly-once answer flip
// (HUMAN_ONLY + CONFLICT). Run via scripts/test-pg.sh — skipped without DATABASE_URL.
import { designProviderQuestionBlock, type Actor } from '@neuramesh/shared';
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

function send(actor: Actor, path: string, body: unknown) {
  return app!.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) },
    body: JSON.stringify(body),
  });
}
const card = (q: object) => '```nmq\n' + JSON.stringify(q) + '\n```';

afterAll(async () => {
  await store?.close();
});

describe.skipIf(!DB)('decisions on postgres (real schema, migration 0061)', () => {
  it('an agent nmq card becomes an open decision row, transactional with the message', async () => {
    const q = { question: 'Ship the banner to prod?', options: [{ label: 'Ship it', description: 'now' }, { label: 'Hold' }], allowOther: false };
    const r = await send(rex, '/v1/messages', { workspace: WS, channel: 'dev', body: `Your call.\n\n${card(q)}` });
    expect(r.status).toBe(200);
    const { message } = await j(r);
    const d = (await store!.listDecisions(WS)).find((x) => x.question === 'Ship the banner to prod?');
    expect(d).toBeTruthy();
    expect(d!.status).toBe('open');
    expect(d!.messageId).toBe(message.id);
    expect(d!.taskId).toBeNull();
    expect(d!.asker).toEqual({ kind: 'agent', id: rex.id });
    expect(d!.options).toEqual(q.options);
    expect(d!.allowOther).toBe(false);
  });

  it('human messages and malformed blocks never open decisions', async () => {
    await send(george, '/v1/messages', { workspace: WS, channel: 'dev', body: card({ question: 'From a human?' }) });
    await send(rex, '/v1/messages', { workspace: WS, channel: 'dev', body: '```nmq\nnot json\n```' });
    const all = await store!.listDecisions(WS);
    expect(all.some((d) => d.question === 'From a human?')).toBe(false);
  });

  it('answer flips exactly once: human-only, the second write CONFLICTs, dismiss mirrors', async () => {
    await send(rex, '/v1/messages', { workspace: WS, channel: 'dev', body: card({ question: 'Rate-limit by key or IP?', options: [{ label: 'Key' }, { label: 'IP' }] }) });
    const d = (await store!.listDecisions(WS)).find((x) => x.question === 'Rate-limit by key or IP?')!;

    // an agent may not answer — the human is the tiebreaker
    expect((await send(rex, '/v1/commands', { type: 'decision.answer', decisionId: d.id, answer: 'Key' })).status).toBe(403);

    expect((await send(george, '/v1/commands', { type: 'decision.answer', decisionId: d.id, answer: 'Key' })).status).toBe(200);
    const after = (await store!.listDecisions(WS)).find((x) => x.id === d.id)!;
    expect(after.status).toBe('answered');
    expect(after.answer).toBe('Key');
    expect(after.answeredBy).toEqual({ kind: 'human', id: george.id });
    expect(after.answeredAt).toBeTruthy();

    // the second machine's click stands down (0060 lesson: uniqueness lives server-side)
    expect((await send(george, '/v1/commands', { type: 'decision.answer', decisionId: d.id, answer: 'IP' })).status).toBe(409);
    // unknown id → 404
    expect((await send(george, '/v1/commands', { type: 'decision.answer', decisionId: crypto.randomUUID(), answer: 'x' })).status).toBe(404);

    // dismiss mirrors the flip
    await send(rex, '/v1/messages', { workspace: WS, channel: 'dev', body: card({ question: 'Park this idea?' }) });
    const p = (await store!.listDecisions(WS)).find((x) => x.question === 'Park this idea?')!;
    expect((await send(george, '/v1/commands', { type: 'decision.dismiss', decisionId: p.id })).status).toBe(200);
    expect((await store!.listDecisions(WS)).find((x) => x.id === p.id)!.status).toBe('dismissed');
  });

  it('a re-asked question supersedes its older open card in the same channel/thread', async () => {
    const q = { question: 'Approve the plan for #77?', options: [{ label: 'Approve' }] };
    await send(rex, '/v1/messages', { workspace: WS, channel: 'dev', body: card(q) });
    await send(rex, '/v1/messages', { workspace: WS, channel: 'dev', body: card(q) });
    const rounds = (await store!.listDecisions(WS)).filter((x) => x.question === 'Approve the plan for #77?');
    expect(rounds.length).toBe(2);
    expect(rounds.filter((x) => x.status === 'open').length).toBe(1);
    const open = rounds.find((x) => x.status === 'open')!;
    const dismissed = rounds.find((x) => x.status === 'dismissed')!;
    expect(Date.parse(open.createdAt)).toBeGreaterThanOrEqual(Date.parse(dismissed.createdAt));
  });

  it('a task-thread card carries its task id', async () => {
    const { task } = await j(await send(george, '/v1/commands', { type: 'task.create', workspace: WS, channel: 'dev', title: 'decisions pg task', kind: 'bug' }));
    await send(rex, '/v1/messages', { workspace: WS, channel: 'dev', taskId: task.id, body: card({ question: 'Intake ok for this one?' }) });
    const d = (await store!.listDecisions(WS)).find((x) => x.question === 'Intake ok for this one?')!;
    expect(d.taskId).toBe(task.id);
  });

  it('answering the Iris canvas decision selects that provider on the task', async () => {
    const { task } = await j(await send(george, '/v1/commands', { type: 'task.create', workspace: WS, channel: 'dev', title: 'choose design canvas', kind: 'design' }));
    expect((await send(rex, '/v1/commands', { type: 'task.request_design', taskId: task.id })).status).toBe(200);
    expect((await send(rex, '/v1/messages', { workspace: WS, channel: 'dev', taskId: task.id, body: designProviderQuestionBlock() })).status).toBe(200);
    const decision = (await store!.listDecisions(WS)).find((x) => x.taskId === task.id && x.question === 'Where should Iris draft this?')!;

    expect((await send(george, '/v1/commands', { type: 'decision.answer', decisionId: decision.id, answer: 'Somewhere else' })).status).toBe(422);
    expect((await store!.listDecisions(WS)).find((x) => x.id === decision.id)?.status).toBe('open');
    expect((await send(george, '/v1/commands', { type: 'decision.answer', decisionId: decision.id, answer: 'Use Claude Design' })).status).toBe(200);
    const detail = await j(await app!.request(`/v1/tasks/${task.id}`, { headers: { 'x-nm-actor': JSON.stringify(george) } }));
    expect(detail.task.state).toBe('designing');
    expect(detail.events.find((event: { type: string }) => event.type === 'task.design_provider_selected')?.payload).toMatchObject({ provider: 'claude-design' });
  });

  // The Home needs-you list trusts the synced `status`; the thread also collapses a card on a
  // string-matched `**question** → answer` reply. When the explicit decision.answer flip doesn't
  // land (its documented transient-failure fallback still posts the reply, plus mobile / older
  // clients), the two diverge — thread resolved, Home still nagging. postMessage now closes that
  // gap: the reply itself flips the row, so `status` is authoritative for every surface.
  it('a human `**question** → answer` reply auto-resolves the open card, no decision.answer needed', async () => {
    await send(rex, '/v1/messages', { workspace: WS, channel: 'dev', body: card({ question: 'Add @market-analyst to #general?', options: [{ label: 'Add @market-analyst' }, { label: 'Not now' }] }) });
    const d = (await store!.listDecisions(WS)).find((x) => x.question === 'Add @market-analyst to #general?')!;
    expect(d.status).toBe('open');
    await send(george, '/v1/messages', { workspace: WS, channel: 'dev', body: '**Add @market-analyst to #general?** → Add @market-analyst' });
    const after = (await store!.listDecisions(WS)).find((x) => x.id === d.id)!;
    expect(after.status).toBe('answered');
    expect(after.answer).toBe('Add @market-analyst');
    expect(after.answeredBy).toEqual({ kind: 'human', id: george.id });
    expect(after.answeredAt).toBeTruthy();
  });

  it('only a HUMAN reply auto-resolves — an agent posting the same answer line does not', async () => {
    await send(rex, '/v1/messages', { workspace: WS, channel: 'dev', body: card({ question: 'Bump the cache TTL?', options: [{ label: 'Yes' }] }) });
    const d = (await store!.listDecisions(WS)).find((x) => x.question === 'Bump the cache TTL?')!;
    await send(rex, '/v1/messages', { workspace: WS, channel: 'dev', body: '**Bump the cache TTL?** → Yes' });
    expect((await store!.listDecisions(WS)).find((x) => x.id === d.id)!.status).toBe('open');
  });

  it('auto-resolve is scoped to the reply\'s channel + task — a reply in another scope leaves it open', async () => {
    const { task } = await j(await send(george, '/v1/commands', { type: 'task.create', workspace: WS, channel: 'dev', title: 'scope task', kind: 'bug' }));
    await send(rex, '/v1/messages', { workspace: WS, channel: 'dev', taskId: task.id, body: card({ question: 'Scoped: proceed?', options: [{ label: 'Yes' }] }) });
    const d = (await store!.listDecisions(WS)).find((x) => x.question === 'Scoped: proceed?')!;
    expect(d.taskId).toBe(task.id);
    // a channel-level reply (task_id null) must NOT resolve the task-scoped card
    await send(george, '/v1/messages', { workspace: WS, channel: 'dev', body: '**Scoped: proceed?** → Yes' });
    expect((await store!.listDecisions(WS)).find((x) => x.id === d.id)!.status).toBe('open');
    // the reply IN the task thread does
    await send(george, '/v1/messages', { workspace: WS, channel: 'dev', taskId: task.id, body: '**Scoped: proceed?** → Yes' });
    expect((await store!.listDecisions(WS)).find((x) => x.id === d.id)!.status).toBe('answered');
  });

  it('idempotent with the explicit flip: the card click answers first, so its reply cannot re-flip or overwrite', async () => {
    await send(rex, '/v1/messages', { workspace: WS, channel: 'dev', body: card({ question: 'Deploy window?', options: [{ label: 'Now' }, { label: 'Tonight' }] }) });
    const d = (await store!.listDecisions(WS)).find((x) => x.question === 'Deploy window?')!;
    expect((await send(george, '/v1/commands', { type: 'decision.answer', decisionId: d.id, answer: 'Now' })).status).toBe(200);
    // the reply lands after the authoritative flip — a differing label must not overwrite it
    await send(george, '/v1/messages', { workspace: WS, channel: 'dev', body: '**Deploy window?** → Tonight' });
    const after = (await store!.listDecisions(WS)).find((x) => x.id === d.id)!;
    expect(after.status).toBe('answered');
    expect(after.answer).toBe('Now');
  });

  it('a terminal transition dismisses the task\'s still-open cards — a question can\'t outlive its task', async () => {
    const { task } = await j(await send(george, '/v1/commands', { type: 'task.create', workspace: WS, channel: 'dev', title: 'question outlives task', kind: 'bug' }));
    await send(rex, '/v1/messages', { workspace: WS, channel: 'dev', taskId: task.id, body: card({ question: 'Release step: full or bump-only?', options: [{ label: 'Full' }, { label: 'Bump only' }] }) });
    const before = (await store!.listDecisions(WS)).find((x) => x.question === 'Release step: full or bump-only?')!;
    expect(before.status).toBe('open');
    expect(before.taskId).toBe(task.id);

    // the human never clicked the card — they closed the task instead. The question is
    // moot now, so the card must not linger on Mission Control (dismissed in the same txn).
    expect((await send(george, '/v1/commands', { type: 'task.cancel', taskId: task.id })).status).toBe(200);
    const after = (await store!.listDecisions(WS)).find((x) => x.id === before.id)!;
    expect(after.status).toBe('dismissed');
    expect(after.answeredAt).toBeTruthy();
  });
});
