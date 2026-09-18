// The thread brain override (docs/10 §15): `thread.set_brain`, the SERVER FLOOR under the picker.
//
// The renderer greys out models with no connected provider and only ever offers real roles. This
// file tests the stop that does not depend on which client is calling — a stale build, a scripted
// caller or a future surface cannot store a model the daemon would then fail to run, and no agent
// can choose its own brain whatever the UI decides to draw.
import type { Actor } from '@neuramesh/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { MemoryStore } from '../src/store';

const george: Actor = { kind: 'human', id: 'george' };
const rex: Actor = { kind: 'agent', id: 'a-rex', role: 'orchestrator' };
const patch: Actor = { kind: 'agent', id: 'a-patch', role: 'developer' };
let app: ReturnType<typeof createApp>;
let store: MemoryStore;
const j = (r: Response): Promise<any> => r.json() as Promise<any>;
const base = { workspace: 'ws_acme', channel: 'dev' };

const OPUS = 'claude-opus-4-8';
const SONNET = 'claude-sonnet-5';

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
const born = async () => {
  const threadId = crypto.randomUUID();
  await send(george, { ...base, body: 'can you take a look at the pricing table?', threadId });
  return threadId;
};
const brainOf = (threadId: string) => store.threads.find((t) => t.id === threadId)?.brainOverride;

beforeEach(() => { store = new MemoryStore(); app = createApp(store); });

describe('thread.set_brain is HUMAN_ONLY', () => {
  it('every agent is rejected — an agent cannot choose its own model', async () => {
    const threadId = await born();
    for (const agent of [rex, patch]) {
      const res = await cmd(agent, { type: 'thread.set_brain', workspace: base.workspace, threadId, override: { developer: OPUS } });
      expect(res.status).toBe(403);
      expect((await j(res)).code).toBe('HUMAN_ONLY');
    }
    expect(brainOf(threadId) ?? null).toBeNull();
  });

  it('the human sets it, and the stored shape is the one the daemon resolves with', async () => {
    const threadId = await born();
    const res = await cmd(george, { type: 'thread.set_brain', workspace: base.workspace, threadId, override: { developer: OPUS, reviewer: SONNET } });
    expect(res.status).toBe(200);
    expect(brainOf(threadId)).toEqual({ developer: OPUS, reviewer: SONNET });
  });
});

describe('the allow-list is enforced HERE, not only in the picker', () => {
  it('a model outside the catalog is refused, naming the offender, and nothing is stored', async () => {
    const threadId = await born();
    const res = await cmd(george, { type: 'thread.set_brain', workspace: base.workspace, threadId, override: { developer: 'claude-imaginary-9' } });
    expect(res.status).toBe(422); // INVALID_INPUT — this repo's code for a well-formed, unacceptable value
    const body = await j(res);
    expect(body.code).toBe('INVALID_INPUT');
    expect(body.error).toContain('claude-imaginary-9');
    // and NOTHING is stored — a rejected command must not half-apply
    expect(brainOf(threadId) ?? null).toBeNull();
  });

  it('a role that does not exist is refused too', async () => {
    const threadId = await born();
    const res = await cmd(george, { type: 'thread.set_brain', workspace: base.workspace, threadId, override: { wizard: OPUS } });
    expect(res.status).toBe(422);
    expect((await j(res)).error).toContain('wizard');
    expect(brainOf(threadId) ?? null).toBeNull();
  });

  it('one bad entry rejects the whole command rather than storing the good half', async () => {
    const threadId = await born();
    await cmd(george, { type: 'thread.set_brain', workspace: base.workspace, threadId, override: { developer: OPUS, reviewer: 'gpt-nope' } });
    expect(brainOf(threadId) ?? null).toBeNull();
  });

  it('covers EVERY role including the orchestrator (ruling 6)', async () => {
    const threadId = await born();
    expect((await cmd(george, { type: 'thread.set_brain', workspace: base.workspace, threadId, override: { orchestrator: OPUS } })).status).toBe(200);
    expect(brainOf(threadId)).toEqual({ orchestrator: OPUS });
  });
});

describe('Reset is the WHOLE override (ruling 7)', () => {
  it('null clears it, and an emptied map clears it too — `{}` is never stored', async () => {
    const threadId = await born();
    await cmd(george, { type: 'thread.set_brain', workspace: base.workspace, threadId, override: { developer: OPUS } });
    expect(brainOf(threadId)).toEqual({ developer: OPUS });

    expect((await cmd(george, { type: 'thread.set_brain', workspace: base.workspace, threadId, override: null })).status).toBe(200);
    expect(brainOf(threadId)).toBeNull();

    await cmd(george, { type: 'thread.set_brain', workspace: base.workspace, threadId, override: { developer: OPUS } });
    await cmd(george, { type: 'thread.set_brain', workspace: base.workspace, threadId, override: {} });
    expect(brainOf(threadId)).toBeNull(); // not `{}` — an empty object reads as "has an override"
  });

  it('setting it again REPLACES rather than merging, so a removed role is actually removed', async () => {
    const threadId = await born();
    await cmd(george, { type: 'thread.set_brain', workspace: base.workspace, threadId, override: { developer: OPUS, reviewer: SONNET } });
    await cmd(george, { type: 'thread.set_brain', workspace: base.workspace, threadId, override: { developer: OPUS } });
    expect(brainOf(threadId)).toEqual({ developer: OPUS });
  });
});

describe('the composer draft is applied at BIRTH, and only at birth', () => {
  // the same contract threadMode has: what the composer was showing when the conversation
  // started is what the conversation starts with, and a later message cannot re-brain it
  it('a send that BIRTHS a thread carries the brain the composer was showing', async () => {
    const threadId = crypto.randomUUID();
    await send(george, { ...base, body: 'draft the pricing table', threadId, brainOverride: { developer: OPUS } });
    expect(brainOf(threadId)).toEqual({ developer: OPUS });
  });

  it('a LATER message carrying one is ignored — re-braining is thread.set_brain, not typing', async () => {
    const threadId = crypto.randomUUID();
    await send(george, { ...base, body: 'first', threadId, brainOverride: { developer: OPUS } });
    await send(george, { ...base, body: 'second', threadId, brainOverride: { reviewer: SONNET } });
    expect(brainOf(threadId)).toEqual({ developer: OPUS });
  });

  it('a birth with no draft is a thread with no override, not an empty one', async () => {
    const threadId = crypto.randomUUID();
    await send(george, { ...base, body: 'no draft here', threadId });
    expect(brainOf(threadId) ?? null).toBeNull();
  });

  it('a junk draft from a stale client is dropped at birth rather than stored', async () => {
    const threadId = crypto.randomUUID();
    await send(george, { ...base, body: 'stale client', threadId, brainOverride: { developer: 'claude-imaginary-9', wizard: OPUS } });
    expect(brainOf(threadId) ?? null).toBeNull();
    const ok = crypto.randomUUID();
    await send(george, { ...base, body: 'half junk', threadId: ok, brainOverride: { developer: OPUS, reviewer: 'gpt-nope' } });
    expect(brainOf(ok)).toEqual({ developer: OPUS }); // the honourable half survives a BIRTH
  });
});

describe('the override belongs to the THREAD (ruling 5)', () => {
  it('an unknown thread is NOT_FOUND rather than a silent no-op', async () => {
    const res = await cmd(george, { type: 'thread.set_brain', workspace: base.workspace, threadId: crypto.randomUUID(), override: { developer: OPUS } });
    expect(res.status).toBe(404);
  });

  it('it survives the thread being linked to a task, and does not leak to a sibling thread', async () => {
    const a = await born();
    const b = await born();
    await cmd(george, { type: 'thread.set_brain', workspace: base.workspace, threadId: a, override: { developer: OPUS } });
    expect(brainOf(a)).toEqual({ developer: OPUS });
    expect(brainOf(b) ?? null).toBeNull();
    // the thread carrying the override is the same row a task links to, so a task moving rooms
    // cannot separate the two — there is nowhere else for it to live
    await send(george, { ...base, body: 'follow-up', threadId: a });
    expect(brainOf(a)).toEqual({ developer: OPUS });
  });
});

// A ROUTINE RUNS ON THE STARTER BRAIN ON PRO (George, 2026-09-16, docs/10 §15.6): the thread a
// schedule opens is born with the orchestrator on the house model, server-stamped, so the run
// never waits on a vendor login. Free keeps the seat as configured; an explicit override wins.
describe('a routine thread is born on its CONFIGURED brain — Starter is the fallback, decided at wake (2026-09-17)', () => {
  // The 2026-09-16 cut stamped every routine on Pro with { orchestrator: Starter } at birth. George,
  // one day later: "I didn't mean all routines should automatically run on starter; starter should
  // be a fallback brain … if the configured brain is unavailable, usage expired, etc; the reason
  // verbose to the user in the thread; auto for routines, manual for everything else." The daemon
  // owns that decision (apps/desktop host/starterfallback.ts): it is the only place that knows
  // whether the seat can run. The server's job here shrank to the birth-time contract below.
  const routineOpener = async (extra: Record<string, unknown> = {}): Promise<string> => {
    const threadId = crypto.randomUUID();
    await send(george, { ...base, threadId, scheduleId: crypto.randomUUID(), body: 'Routine · Weekly X calendar\n\ndraft the week', ...extra });
    return threadId;
  };

  it('on Pro: NO stamp — the routine opens on the brain the workspace configured', async () => {
    await store.setWorkspacePlan(base.workspace, { plan: 'cloud' });
    const threadId = await routineOpener();
    expect(brainOf(threadId) ?? null).toBeNull();
  });

  it('on Free: no stamp either', async () => {
    const threadId = await routineOpener();
    expect(brainOf(threadId) ?? null).toBeNull();
  });

  it('an explicit override on the opener still rides (the composer draft contract, §15.4b)', async () => {
    await store.setWorkspacePlan(base.workspace, { plan: 'cloud' });
    const threadId = await routineOpener({ brainOverride: { orchestrator: OPUS } });
    expect(brainOf(threadId)).toEqual({ orchestrator: OPUS });
  });

  it('the fallback is recorded the way a human records a switch: the owner\'s thread.set_brain on the routine\'s thread', async () => {
    const threadId = await routineOpener();
    const r = await cmd(george, { ...base, type: 'thread.set_brain', threadId, override: { orchestrator: 'gemini-3.5-flash-lite' } });
    expect(r.status).toBe(200);
    expect(brainOf(threadId)).toEqual({ orchestrator: 'gemini-3.5-flash-lite' });
  });

  it('a later reply into the routine thread cannot move the seat (birth-only, like schedule_id)', async () => {
    const threadId = await routineOpener({ brainOverride: { orchestrator: OPUS } });
    await send(george, { ...base, threadId, body: 'also cover instagram', brainOverride: { orchestrator: 'gemini-3.5-flash-lite' } });
    expect(brainOf(threadId)).toEqual({ orchestrator: OPUS });
  });
});
