// The floors under three rules that lived only in prompt etiquette until 2026-08-18 (audit,
// doctrine §4: "enforced, not prompted" — a rule living only in a prompt is a bug).
//
//  1. "No nmq cards in chat" — extraction had no thread-mode check, so a chat agent emitting a
//     card DID mint a decision row + push, despite docs/34 claiming the mode prevents it.
//  2. create_project confirm-first — the server allowed the orchestrator unconditionally.
//  3. create_agent confirm-first (the free-text approval path) — same hole: a silent hire was
//     one bad turn away. The floor is the CARD'S EXISTENCE: clicked accepts arrive answered,
//     approved-in-their-own-words arrives open, the silent path has no card and is refused.
import type { Actor } from '@neuramesh/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { MemoryStore } from '../src/store';

const george: Actor = { kind: 'human', id: 'george' };
const rex: Actor = { kind: 'agent', id: 'a-rex', role: 'orchestrator' };
let app: ReturnType<typeof createApp>;
let store: MemoryStore;
const j = (r: Response): Promise<any> => r.json() as Promise<any>;
const base = { workspace: 'ws_acme', channel: 'dev' };
const card = (q: object) => '```nmq\n' + JSON.stringify(q) + '\n```';

const send = (actor: Actor, body: unknown) =>
  app.request('/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) },
    body: JSON.stringify(body),
  });

const cmd = (actor: Actor, body: unknown) =>
  app.request('/v1/commands', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) },
    body: JSON.stringify(body),
  });

beforeEach(() => { store = new MemoryStore(); app = createApp(store); });

describe('no nmq cards in chat — enforced at the extraction choke point', () => {
  it('an agent card in a CHAT thread mints no decision row (and no push)', async () => {
    const threadId = crypto.randomUUID();
    await send(george, { ...base, body: 'let us just talk here', threadId, threadMode: 'chat' });
    const r = await send(rex, { ...base, threadId, body: card({ question: 'Which vendor?', options: [{ label: 'A' }, { label: 'B' }] }) });
    expect(r.status).toBe(200);
    expect((await store.listDecisions('ws_acme')).length).toBe(0);
  });

  it('the same card in a TASKS thread still becomes a decision row — the floor is mode-scoped', async () => {
    const threadId = crypto.randomUUID();
    await send(george, { ...base, body: 'we should scope this work', threadId });
    await send(rex, { ...base, threadId, body: card({ question: 'Which repo?', options: [{ label: 'app' }, { label: 'api' }] }) });
    const rows = await store.listDecisions('ws_acme');
    expect(rows.length).toBe(1);
    expect(rows[0]!.question).toBe('Which repo?');
  });

  it('a channel-level card (no thread) is unaffected', async () => {
    await send(rex, { ...base, body: card({ question: 'Park it or start it?', options: [{ label: 'Park' }] }) });
    expect((await store.listDecisions('ws_acme')).length).toBe(1);
  });
});

describe('project.create — the confirm card is a floor, not etiquette', () => {
  it('a SILENT agent create is refused with CONFIRM_CARD_REQUIRED', async () => {
    const r = await cmd(rex, { type: 'project.create', workspace: 'ws_acme', name: 'XYZ mobile app' });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect((await j(r)).code).toBe('CONFIRM_CARD_REQUIRED');
  });

  it('an agent create passes once its card is on file — open (free-text approval) or answered (clicked)', async () => {
    await send(rex, { ...base, body: card({ question: 'Start a new project “XYZ mobile app”?', options: [{ label: 'Create project' }, { label: 'Not now' }] }) });
    const r = await cmd(rex, { type: 'project.create', workspace: 'ws_acme', name: 'XYZ mobile app' });
    expect(r.status).toBe(200);
    expect((await j(r)).slug).toBeTruthy();
  });

  it('a card about something ELSE does not unlock the create', async () => {
    await send(rex, { ...base, body: card({ question: 'Which repo for the sync fix?', options: [{ label: 'app' }] }) });
    const r = await cmd(rex, { type: 'project.create', workspace: 'ws_acme', name: 'XYZ mobile app' });
    expect((await j(r)).code).toBe('CONFIRM_CARD_REQUIRED');
  });

  it('humans are not gated', async () => {
    const r = await cmd(george, { type: 'project.create', workspace: 'ws_acme', name: 'Growth' });
    expect(r.status).toBe(200);
  });
});

describe('agent.register — the hire card is a floor under the free-text path', () => {
  it('a SILENT agent-issued hire is refused', async () => {
    const r = await cmd(rex, { type: 'agent.register', workspace: 'ws_acme', machineId: 'm1', name: 'seo-analyst', role: 'worker', channels: ['dev'] });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect((await j(r)).code).toBe('CONFIRM_CARD_REQUIRED');
  });

  it('the hire passes once the card naming the agent is on file', async () => {
    await send(rex, { ...base, body: card({ question: 'Hire @seo-analyst (worker) into #dev?', options: [{ label: 'Hire @seo-analyst' }, { label: 'Not now' }] }) });
    const r = await cmd(rex, { type: 'agent.register', workspace: 'ws_acme', machineId: 'm1', name: 'seo-analyst', role: 'worker', channels: ['dev'] });
    expect(r.status).toBe(200);
  });

  it('humans hire without a card, as ever', async () => {
    const r = await cmd(george, { type: 'agent.register', workspace: 'ws_acme', machineId: 'm1', name: 'scout', role: 'worker', channels: ['dev'] });
    expect(r.status).toBe(200);
  });
});
