// THE ROUTINE'S REPLY CARD, GUARANTEED (models-and-replies round): a routine run whose drafts came back
// as a list gets the card from the host, and the reply points at it; a turn whose tool posted the card,
// a session that is no reply routine, and a prose answer are left alone. Run from apps/desktop:
// pnpm exec tsx --test src/main/host/routinereplies.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseReplies } from '@neuramesh/shared';
import { postReplyCard } from './replycard';
import { replyIntro, routineDeliversReplies, routineReplyTurn } from './routinereplies';

const LIST = `Here are the matching posts from the last 24 hours that met the 500 impressions bar:

1. Author: @eng_khairallah1
- Link: https://x.com/eng_khairallah1/status/2105769157317013669
- Draft Response: Setting up specialized roles makes a huge difference.`;

const EXTRACTED = JSON.stringify({ replies: [{
  target: { handle: '@eng_khairallah1', url: 'https://x.com/eng_khairallah1/status/2105769157317013669', platform: 'x', source: 'connector', text: 'build your first AI agent team', metrics: { impressions: 10651 } },
  draft: 'Setting up specialized roles makes a huge difference.',
}] });

function host(o: { payload?: unknown; landed?: boolean }) {
  const posted: Array<{ path: string; body: Record<string, unknown> }> = [];
  const db = {
    get: async <T>(sql: string): Promise<T | null> => {
      if (/from threads t join schedules/.test(sql)) return (o.payload === undefined ? null : { payload: o.payload }) as T;
      if (/nmreply/.test(sql)) return (o.landed ? { id: 'm-card' } : null) as T;
      return null;
    },
  };
  const post = async (path: string, _a: unknown, body: unknown) => {
    posted.push({ path, body: body as Record<string, unknown> });
    return { ok: true, status: 200, json: async () => ({ message: { id: `m-${posted.length}` } }) };
  };
  let completes = 0;
  const runtimeFor = () => ({ complete: async () => { completes += 1; return EXTRACTED; } });
  return { db, post, posted, runtimeFor, completes: () => completes };
}
const agent = { id: 'a-rex', name: 'rex', role: 'orchestrator', model: 'gemini-3.5-flash-lite', runtime: 'gemini' };
const ch = { id: 'c-mkt', slug: 'marketing', workspace_id: 'ws' };
const args = (thread: string | null) => [agent, ch, 'transcript', 'tok', undefined, undefined, [], [], thread] as unknown[];
const ROUTINE = { routine: true, prompt: 'Goal: find posts and draft concrete responses', replyGap: 8 };
const says = (reply: string) => async (..._a: unknown[]) => reply;

test('the reply keeps its opening words, up to the first list item or link', () => {
  assert.equal(replyIntro(LIST), 'Here are the matching posts from the last 24 hours that met the 500 impressions bar:');
  assert.equal(replyIntro('No post passed the bar today.'), 'No post passed the bar today.');
});

test('a routine delivers replies by its gap or its prompt, and a content schedule never does', async () => {
  assert.equal(await routineDeliversReplies(host({ payload: JSON.stringify(ROUTINE) }).db, 't'), true);
  assert.equal(await routineDeliversReplies(host({ payload: { routine: true, prompt: 'Draft a reply to each post' } }).db, 't'), true);
  assert.equal(await routineDeliversReplies(host({ payload: { routine: true, prompt: 'Sum up the week' } }).db, 't'), false);
  assert.equal(await routineDeliversReplies(host({ payload: { prompt: 'Draft a reply to each post' } }).db, 't'), false);
  assert.equal(await routineDeliversReplies(host({}).db, 't'), false);
});

test('a routine run that answered with a list gets the card, and the reply points at it', async () => {
  const h = host({ payload: ROUTINE });
  const out = await routineReplyTurn(says(LIST), args('th-routine'), h);
  assert.equal(h.posted.length, 1);
  const card = parseReplies(String(h.posted[0]!.body['body']));
  assert.equal(card?.items[0]?.target.handle, 'eng_khairallah1');
  assert.equal(h.posted[0]!.body['threadId'], 'th-routine');
  assert.equal(out, 'Here are the matching posts from the last 24 hours that met the 500 impressions bar:\n\nThe reply drafts are on the card above.');
});

test('a turn whose tool posted the card, a card already in the replica, or no routine: the reply stands', async () => {
  // the tool posted during the turn: the writer remembers the thread
  const tool = host({ payload: ROUTINE });
  const out = await routineReplyTurn(async (..._a: unknown[]) => {
    await postReplyCard({ post: tool.post, actor: { kind: 'agent', id: 'a-rex' }, ch, anchor: { threadId: 'th-tool' } }, { replies: JSON.parse(EXTRACTED).replies });
    return LIST;
  }, args('th-tool'), tool);
  assert.equal(out, LIST);
  assert.equal(tool.completes(), 0);
  const landed = host({ payload: ROUTINE, landed: true });
  assert.equal(await routineReplyTurn(says(LIST), args('th-landed'), landed), LIST);
  const plain = host({ payload: { routine: true, prompt: 'Sum up the week' } });
  assert.equal(await routineReplyTurn(says(LIST), args('th-plain'), plain), LIST);
  assert.equal(plain.completes(), 0);
});

test('a prose answer with no post link never costs an extraction', async () => {
  const h = host({ payload: ROUTINE });
  assert.equal(await routineReplyTurn(says('No post passed the bar today.'), args('th-quiet'), h), 'No post passed the bar today.');
  assert.equal(h.completes(), 0);
  assert.equal(await routineReplyTurn(says(LIST), args(null), h), LIST);
});
