// A card a model bent is stored in its shape (shared/cardfence.ts, George's screenshot of 2026-10-02): the
// server repairs every agent message before it stores one, so each client draws the card, and the decision
// row is minted, the thing a bent card silently lost. A person's words are never rewritten.
import { parseQuestions, routineBlock, type Actor } from '@neuramesh/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { MemoryStore } from '../src/store';

const george: Actor = { kind: 'human', id: 'george' };
const rex: Actor = { kind: 'agent', id: 'a-rex', role: 'orchestrator' };
let app: ReturnType<typeof createApp>;
let store: MemoryStore;
let ROOM = '';
const j = (r: Response): Promise<any> => r.json() as Promise<any>;
const req = (actor: Actor, path: string, body: unknown) =>
  app.request(path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) }, body: JSON.stringify(body) });
const BENT = 'Two ways to tune it.\n\n```nmq\n"question": "How should we adjust the query?",\n"options": [\n  { "label": "Broaden keywords" },\n  { "label": "Keep keywords" }\n],\n"allowOther": true\n}\n```';

beforeEach(async () => {
  store = new MemoryStore();
  app = createApp(store);
  const proj = await j(await req(george, '/v1/commands', { type: 'project.create', workspace: 'ws_acme', name: 'Ops' }));
  ROOM = (await j(await req(george, '/v1/commands', { type: 'channel.create', workspace: 'ws_acme', project: proj.projectId, slug: 'marketing' }))).channelId as string;
});

const thread = async () => {
  const threadId = crypto.randomUUID();
  await req(george, '/v1/messages', { workspace: 'ws_acme', channel: ROOM, body: 'how can we fine tune the query?', threadId });
  return threadId;
};

describe('a bent card from an agent', () => {
  it('is stored in its shape, and its question becomes a decision', async () => {
    const threadId = await thread();
    expect(parseQuestions(BENT)).toEqual([]);
    expect((await req(rex, '/v1/messages', { workspace: 'ws_acme', channel: ROOM, threadId, body: BENT })).status).toBe(200);
    const stored = store.messages.filter((m) => m.threadId === threadId && m.author.kind === 'agent').at(-1)!;
    expect(stored.body.startsWith('Two ways to tune it.\n\n```nmq\n{')).toBe(true);
    expect(parseQuestions(stored.body)[0]?.options?.map((o) => o.label)).toEqual(['Broaden keywords', 'Keep keywords']);
    expect((await store.listDecisions('ws_acme')).filter((d) => d.status === 'open').map((d) => d.question)).toContain('How should we adjust the query?');
  });

  it('a routine card it bent and wrote by hand is still dropped: the repair runs before the guard', async () => {
    const threadId = await thread();
    const draft = { title: 'By hand', cadence: 'daily', atTime: '09:00', goal: 'g', eachRun: 'e', rules: 'r', output: 'o', ifNone: 'n' } as const;
    const bent = routineBlock({ kind: 'draft', draft }).replace('```nmroutine\n', '```nmroutine ');
    expect((await req(rex, '/v1/messages', { workspace: 'ws_acme', channel: ROOM, threadId, body: `${bent}\n\nDone.` })).status).toBe(200);
    expect(store.messages.filter((m) => m.threadId === threadId && m.author.kind === 'agent').at(-1)!.body).toBe('Done.');
  });
});

it("a person's words are never rewritten", async () => {
  const threadId = await thread();
  expect((await req(george, '/v1/messages', { workspace: 'ws_acme', channel: ROOM, threadId, body: BENT })).status).toBe(200);
  expect(store.messages.some((m) => m.threadId === threadId && m.author.kind === 'human' && m.body === BENT)).toBe(true);
});
