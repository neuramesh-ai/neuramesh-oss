// An AUTH card is a needs-you item (George, 2026-09-17: "the message '@rex cannot run…' is easily
// missed"). The server mints a decision row from it exactly as it does from an nmq card, in the one
// choke point every card flows through — so the thread pill, the Home queue and the bell count it
// without any client remembering to. A card that RECORDS a switch a routine already made asks
// nothing, and mints nothing; a human cannot mint one by pasting the block.
import { authCardBlock, type Actor } from '@neuramesh/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { MemoryStore } from '../src/store';

const george: Actor = { kind: 'human', id: 'george' };
const rex: Actor = { kind: 'agent', id: 'a-rex', role: 'orchestrator' };
let app: ReturnType<typeof createApp>;
let store: MemoryStore;
const base = { workspace: 'ws_acme', channel: 'dev' };

const send = (actor: Actor, body: unknown) =>
  app.request('/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) },
    body: JSON.stringify(body),
  });
const offer = { provider: 'openai', reason: 'unavailable' as const, agent: 'rex', why: 'This machine has no OpenAI / Codex login.', starter: true, scope: { threadId: 't-1', role: 'orchestrator' } };
const opened = async (): Promise<Array<{ question: string; status: string; allowOther?: boolean; allow_other?: unknown }>> =>
  (await store.listDecisions(base.workspace)).filter((d) => d.status === 'open') as never;

beforeEach(() => { store = new MemoryStore(); app = createApp(store); });

describe('an nmauth card and the needs-you queue', () => {
  it('an agent\'s offer mints ONE open decision whose question names who, why and the way out', async () => {
    const threadId = crypto.randomUUID();
    await send(george, { ...base, threadId, body: '@rex one line, please.' });
    const r = await send(rex, { ...base, threadId, body: `@rex cannot run on OpenAI / Codex here.\n\n${authCardBlock(offer)}` });
    expect(r.status).toBe(200);
    const open = await opened();
    expect(open).toHaveLength(1);
    expect(open[0]!.question).toBe('@rex cannot run here. This machine has no OpenAI / Codex login. Sign in again, or switch this conversation to the NeuraMesh brain, on credits.');
  });

  it('a switched card (the routine already moved) asks nothing and mints nothing', async () => {
    const threadId = crypto.randomUUID();
    await send(george, { ...base, threadId, body: 'Routine · Onboarding checklist\n\nwrite it' });
    await send(rex, { ...base, threadId, body: `@rex cannot run on OpenAI / Codex here.\n\n${authCardBlock({ ...offer, switched: true })}` });
    expect(await opened()).toHaveLength(0);
  });

  it('a human pasting the block mints nothing — only an agent can say it cannot run', async () => {
    await send(george, { ...base, body: authCardBlock(offer) });
    expect(await opened()).toHaveLength(0);
  });
});
