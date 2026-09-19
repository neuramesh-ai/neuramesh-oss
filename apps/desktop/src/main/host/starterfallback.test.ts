import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { STARTER_MODEL } from '@neuramesh/shared';
import type { HostedAgent } from '../agents';
import { configureStarterFallback, fallbackText, offerCard, owningThread, starterFallback, unavailableOf, whyUnavailable } from './starterfallback';

const rex: HostedAgent = { id: 'a-rex', name: 'rex', role: 'orchestrator', model: 'gpt-5.6-sol', runtime: 'codex', modelSource: 'manual', channels: new Set() };
const expired = { kind: 'login', provider: 'openai', reason: 'expired' } as const;

test('unavailableOf: a blocked login, a missing one, a usable seat, and the echo gate', () => {
  assert.deepEqual(unavailableOf({ authMode: 'none', blocked: { provider: 'openai', reason: 'expired' } }, 'codex'), expired);
  assert.deepEqual(unavailableOf({ authMode: 'none', blocked: { provider: 'anthropic', reason: 'unavailable' } }, 'claude-code'), { kind: 'login', provider: 'anthropic', reason: 'missing' });
  assert.deepEqual(unavailableOf({ authMode: 'none' }, 'gemini'), { kind: 'login', provider: 'gemini', reason: 'missing' });
  assert.equal(unavailableOf({ authMode: 'subscription' }, 'codex'), null);
  assert.equal(unavailableOf({ authMode: 'starter' }, 'gemini'), null);
  process.env['NM_AGENT_MODE'] = 'echo';
  try { assert.equal(unavailableOf({ authMode: 'none' }, 'codex'), null); } finally { delete process.env['NM_AGENT_MODE']; }
});

test('the reason is said plainly, and the text names what happens next', () => {
  assert.equal(whyUnavailable(expired, 'codex'), 'The OpenAI / Codex login on this machine expired.');
  assert.equal(whyUnavailable({ kind: 'nocompute', provider: 'anthropic', reason: null, cloudLacksLogin: true }, 'claude-code'), 'No machine available to me can serve Claude. Your cloud machine has no Claude login either.');
  assert.equal(whyUnavailable({ kind: 'capped', model: 'gpt-5.6-sol' }, 'codex'), 'The usage limit on gpt-5.6-sol is reached.');
  assert.match(fallbackText(rex, expired, 'auto'), /^@rex cannot run on OpenAI \/ Codex here\. The OpenAI \/ Codex login on this machine expired\. This routine continues on the NeuraMesh brain, on credits\./);
  assert.match(fallbackText(rex, expired, 'offer'), /Sign in to OpenAI \/ Codex again on this machine, or run this conversation on the NeuraMesh brain, on credits\.$/);
  assert.match(fallbackText(rex, expired, 'nocredits'), /out of credits/);
  for (const t of [fallbackText(rex, expired, 'auto'), fallbackText(rex, expired, 'offer')]) assert.doesNotMatch(t, /—|;/, 'STE: no em dash, no semicolon');
});

test('the offer card carries the reason, the scope the button switches, and whether Starter can take it', () => {
  const body = offerCard(rex, expired, { threadId: 't1' }, true, 42);
  const json = JSON.parse(/```nmauth\n([\s\S]*?)```/.exec(body)![1]!);
  assert.deepEqual(json, { provider: 'openai', reason: 'expired', agent: 'rex', taskNumber: 42, why: 'The OpenAI / Codex login on this machine expired.', starter: true, scope: { threadId: 't1', role: 'orchestrator' } });
  assert.ok(body.startsWith('@rex cannot run on OpenAI / Codex here.'));
  assert.equal(JSON.parse(/```nmauth\n([\s\S]*?)```/.exec(offerCard(rex, expired, null, false))![1]!).scope, undefined);
});

// ── the door, against a fake replica and a fake server ──────────────────────────────────────
type Call = { url: string; body: any; actor: { kind: string; id: string } | null };
let calls: Call[];
let usage: { outOfCredits: boolean } = { outOfCredits: false };
let rows: Record<string, any>;
const realFetch = globalThis.fetch;
beforeEach(() => {
  calls = []; usage = { outOfCredits: false };
  rows = {};
  globalThis.fetch = (async (url: any, init?: any) => {
    const u = String(url);
    if (u.includes('/v1/usage')) return new Response(JSON.stringify({ credits: usage }), { status: 200 });
    const hdr = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url: u, body: init?.body ? JSON.parse(init.body) : null, actor: hdr['x-nm-actor'] ? JSON.parse(hdr['x-nm-actor']) : null });
    return new Response('{"ok":true}', { status: 200 });
  }) as typeof fetch;
  // like the replica's `get`: an empty result THROWS (PowerSync), it never returns undefined — the
  // door's first live run silently stood down on exactly that, because a unit anchored to a
  // conversation has no thread of its own and the "own thread" query is empty by design
  const db = {
    get: async (sql: string, params?: unknown[]) => {
      const hit = sql.startsWith('select id, schedule_id, brain_override from threads where id') ? rows[`thread:${params?.[0]}`]
        : sql.includes('where task_id') ? rows[`own:${params?.[0]}`]
          : sql.includes('origin_thread_id') ? rows[`origin:${params?.[0]}`]
            : sql.includes('root_message_id') ? rows[`root:${params?.[0]}`]
              : undefined;
      if (!hit) throw new Error('Result set is empty');
      return hit;
    },
  };
  configureStarterFallback({ db, apiUrl: 'http://api', ownerActorId: 'george' });
});
afterEach(() => { globalThis.fetch = realFetch; configureStarterFallback(null); });

test('a ROUTINE conversation re-seats the failing role by itself: the override is written as the owner, the reason is posted, the agent comes back on Starter', async () => {
  rows['thread:t-routine'] = { id: 't-routine', schedule_id: 's1', brain_override: JSON.stringify({ developer: 'claude-opus-4-8' }) };
  const next = await starterFallback(rex, expired, { workspace: 'ws', channelId: 'ch', threadId: 't-routine', replyTo: 'm1' });
  assert.equal(next?.model, STARTER_MODEL);
  assert.equal(next?.runtime, 'gemini');
  const setBrain = calls.find((c) => c.url.endsWith('/v1/commands'));
  assert.deepEqual(setBrain?.body, { type: 'thread.set_brain', workspace: 'ws', threadId: 't-routine', override: { developer: 'claude-opus-4-8', orchestrator: STARTER_MODEL } });
  const said = calls.find((c) => c.url.endsWith('/v1/messages'));
  assert.equal(said?.body.threadId, 't-routine');
  // NOT a reply to the trigger: the turn continues, and its real answer replies to that trigger
  // next — a reason holding the one-reply-per-trigger slot had that answer refused as a duplicate
  assert.equal(said?.body.replyTo, undefined);
  assert.match(said?.body.body, /This routine continues on the NeuraMesh brain/);
  // the auto path posts a card too, marked as the switch it already made: the docked notice reads
  // it (no button to click, no decision row — the server skips a switched card)
  const rec = JSON.parse(/```nmauth\n([\s\S]*?)```/.exec(said?.body.body)![1]!);
  assert.equal(rec.switched, true);
  assert.deepEqual(rec.scope, { threadId: 't-routine', role: 'orchestrator' });
  assert.equal(rec.starter, true);
  assert.equal(said?.actor?.kind, 'agent', 'the agent explains itself; the owner only speaks for a cap');
  assert.equal(setBrain?.actor?.kind, 'human', 'the override is the owner\'s word (set_brain is HUMAN_ONLY)');
});

test('a HUMAN conversation gets the reason and the card with the switch, and the turn stops', async () => {
  rows['thread:t-human'] = { id: 't-human', schedule_id: null, brain_override: null };
  const next = await starterFallback(rex, expired, { workspace: 'ws', channelId: 'ch', threadId: 't-human', replyTo: 'm2' });
  assert.equal(next, null);
  assert.ok(!calls.some((c) => c.url.endsWith('/v1/commands')), 'nothing moved without a click');
  const said = calls.find((c) => c.url.endsWith('/v1/messages'));
  assert.match(said?.body.body, /```nmauth/);
  assert.deepEqual(JSON.parse(/```nmauth\n([\s\S]*?)```/.exec(said?.body.body)![1]!).scope, { threadId: 't-human', role: 'orchestrator' });
});

test('on a CLOUD machine a human conversation moves by itself too: the NeuraMesh brain is that machine\'s default (George, 2026-09-19), and the record says "conversation"', async () => {
  const kind = process.env['NM_MACHINE_KIND'];
  process.env['NM_MACHINE_KIND'] = 'member';
  try {
    rows['thread:t-web'] = { id: 't-web', schedule_id: null, brain_override: null };
    const next = await starterFallback(rex, { kind: 'nocompute', provider: 'anthropic', reason: 'missing', cloudLacksLogin: true }, { workspace: 'ws', channelId: 'ch', threadId: 't-web', replyTo: 'm3' });
    assert.equal(next?.model, STARTER_MODEL);
    const setBrain = calls.find((c) => c.url.endsWith('/v1/commands'));
    assert.deepEqual(setBrain?.body, { type: 'thread.set_brain', workspace: 'ws', threadId: 't-web', override: { orchestrator: STARTER_MODEL } });
    assert.equal(setBrain?.actor?.kind, 'human', 'the owner\'s word, as for a routine');
    const said = calls.find((c) => c.url.endsWith('/v1/messages'));
    assert.match(said?.body.body, /This conversation continues on the NeuraMesh brain, on credits/);
    assert.doesNotMatch(said?.body.body, /routine/);
    assert.equal(said?.body.replyTo, undefined, 'the turn continues: its real answer replies to the trigger');
    assert.equal(JSON.parse(/```nmauth\n([\s\S]*?)```/.exec(said?.body.body)![1]!).switched, true);
    // out of credits on the cloud machine: the card, no move, exactly as on a laptop
    calls = []; usage = { outOfCredits: true };
    rows['thread:t-web2'] = { id: 't-web2', schedule_id: null, brain_override: null };
    assert.equal(await starterFallback(rex, expired, { workspace: 'ws', channelId: 'ch', threadId: 't-web2', replyTo: 'm4' }), null);
    assert.ok(!calls.some((c) => c.url.endsWith('/v1/commands')));
    assert.match(calls.find((c) => c.url.endsWith('/v1/messages'))?.body.body, /out of credits/);
  } finally { if (kind === undefined) delete process.env['NM_MACHINE_KIND']; else process.env['NM_MACHINE_KIND'] = kind; }
});

test('a unit anchored to a routine conversation is routine-owned, and the move lands on the unit\'s own thread (the row threadBrain reads first)', async () => {
  rows['own:task9'] = { id: 't-own', schedule_id: null, brain_override: null };
  rows['origin:task9'] = { id: 't-routine', schedule_id: 's1', brain_override: null };
  assert.deepEqual(await owningThread({ get: async (sql: string, p?: unknown[]) => rows[sql.includes('origin') ? `origin:${p?.[0]}` : `own:${p?.[0]}`] } as never, { taskId: 'task9' }), { id: 't-own', routine: true, override: null });
  const patch: HostedAgent = { ...rex, id: 'a-patch', name: 'patch', role: 'developer', model: 'claude-sonnet-5', runtime: 'claude-code', modelSource: 'pack' };
  const next = await starterFallback(patch, { kind: 'login', provider: 'anthropic', reason: 'missing' }, { workspace: 'ws', channelId: 'ch', taskId: 'task9', taskNumber: 9 });
  assert.equal(next?.model, STARTER_MODEL);
  assert.equal(calls.find((c) => c.url.endsWith('/v1/commands'))?.body.threadId, 't-own');
  assert.equal(calls.find((c) => c.url.endsWith('/v1/messages'))?.body.taskId, 'task9');
});

test('out of credits: no move on either path, and the card offers no switch', async () => {
  usage = { outOfCredits: true };
  rows['thread:t-routine'] = { id: 't-routine', schedule_id: 's1', brain_override: null };
  assert.equal(await starterFallback(rex, expired, { workspace: 'ws', channelId: 'ch', threadId: 't-routine' }), null);
  assert.ok(!calls.some((c) => c.url.endsWith('/v1/commands')));
  const said = calls.find((c) => c.url.endsWith('/v1/messages'));
  assert.match(said?.body.body, /out of credits/);
  assert.equal(JSON.parse(/```nmauth\n([\s\S]*?)```/.exec(said?.body.body)![1]!).starter, false);
});

test('moved a moment ago by THIS host: a second pass takes the seat silently even before the replica shows the override', async () => {
  // seen live: the wake ladder\'s door and the wake\'s own door ran 40 ms apart, the replica still
  // read null, and the routine\'s thread got the reason twice
  rows['thread:t-routine'] = { id: 't-routine', schedule_id: 's1', brain_override: null };
  const first = await starterFallback(rex, expired, { workspace: 'ws', channelId: 'ch', threadId: 't-routine' });
  assert.equal(first?.model, STARTER_MODEL);
  const posted = calls.length;
  const second = await starterFallback(rex, expired, { workspace: 'ws', channelId: 'ch', threadId: 't-routine' });
  assert.equal(second?.model, STARTER_MODEL);
  assert.equal(calls.length, posted, 'nothing posted, nothing written, the second time');
  // another role on the same thread is its own seat: it still gets the door
  const patch: HostedAgent = { ...rex, id: 'a-patch', name: 'patch', role: 'developer', model: 'gpt-5.5', runtime: 'codex' };
  await starterFallback(patch, expired, { workspace: 'ws', channelId: 'ch', threadId: 't-routine' });
  assert.ok(calls.length > posted);
});

test('already moved by an earlier pass: the seat is taken silently, nothing is posted twice', async () => {
  rows['thread:t-routine'] = { id: 't-routine', schedule_id: 's1', brain_override: JSON.stringify({ orchestrator: STARTER_MODEL }) };
  const next = await starterFallback(rex, expired, { workspace: 'ws', channelId: 'ch', threadId: 't-routine' });
  assert.equal(next?.model, STARTER_MODEL);
  assert.equal(calls.length, 0);
});

test('a CAP in a routine conversation is re-asked by the OWNER, mentioning the agent — a fresh trigger, so the wake lease is not lost', async () => {
  rows['thread:t-routine'] = { id: 't-routine', schedule_id: 's1', brain_override: null };
  const next = await starterFallback(rex, { kind: 'capped', model: 'gpt-5.6-sol' }, { workspace: 'ws', channelId: 'ch', threadId: 't-routine', replyTo: 'm3' });
  assert.equal(next?.model, STARTER_MODEL);
  const said = calls.find((c) => c.url.endsWith('/v1/messages'));
  assert.equal(said?.body.threadId, 't-routine');
  assert.match(said?.body.body, /^@rex cannot run on OpenAI \/ Codex here\. The usage limit on gpt-5\.6-sol is reached\. This routine continues on the NeuraMesh brain/);
  assert.equal(said?.actor?.kind, 'human', 'the OWNER speaks, so the message is a fresh human trigger');
  assert.match(said?.body.body, /@rex/, 'and it mentions the agent, which routes the wake to him');
});

test('a seat already on Starter has nowhere to fall: it says so and stops', async () => {
  const house = { ...rex, model: STARTER_MODEL, runtime: 'gemini' };
  assert.equal(await starterFallback(house, { kind: 'capped', model: STARTER_MODEL }, { workspace: 'ws', channelId: 'ch', threadId: 't-routine' }), null);
  assert.match(calls[0]?.body.body, /cannot run on the NeuraMesh brain now/);
});

test('conversationOrigin: a unit the orchestrator created speaks for the human who opened its conversation', async () => {
  rows['own:task9'] = undefined;
  rows['origin:task9'] = { id: 't-routine', schedule_id: 's1', brain_override: null };
  rows['root:t-routine'] = { author_kind: 'human', author_id: 'george' };
  const { conversationOrigin } = await import('./starterfallback');
  assert.equal(await conversationOrigin({ taskId: 'task9' }), 'george');
  rows['root:t-routine'] = { author_kind: 'agent', author_id: 'a-rex' };
  assert.equal(await conversationOrigin({ taskId: 'task9' }), null, 'an agent-opened conversation names nobody');
  assert.equal(await conversationOrigin({ taskId: 'nope' }), null);
});

test('unconfigured (a test host, a build that never booted the lane): the door is closed and the caller keeps its old path', async () => {
  configureStarterFallback(null);
  assert.equal(await starterFallback(rex, expired, { workspace: 'ws', channelId: 'ch', threadId: 't' }), null);
  assert.equal(calls.length, 0);
});
