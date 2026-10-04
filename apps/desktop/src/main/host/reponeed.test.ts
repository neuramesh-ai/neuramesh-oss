// The GitHub card a tool posts (docs/design/repo-connect-2026-10): one card per conversation or
// task, flagged as the tool's so the server mints its Needs-you row; the reader's refusals put it up
// and tell the model to stop; a chat-mode thread and a Local stack keep the card's row out; a brief's
// #N references travel with the brief. The replica and the API are fakes, and gh is never spawned.
// Run: pnpm exec tsx --test src/main/host/reponeed.test.ts
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { GITHUB_NEED_PREFIX, parseNeed } from '@neuramesh/shared';
import { repoChatTools } from './chattools-repo';
import { conversationNeedWords, needOpen, postRepoNeed, repoReadable, resetNeedMemoForTest } from './reponeed';
import { CARD_UP, makeRepoReader } from './reporead';
import { referencedTasks, taskNumbersIn } from './taskrefs';
import { playbookTools } from './tools-playbooks';

const LOCAL = { id: 'r1', org_name: 'local', name: 'neuramesh', clone_url: null, local_path: '~/code/neuramesh', provider: 'local' };
const GITHUB = { id: 'r2', org_name: 'acme', name: 'site', clone_url: 'https://github.com/acme/site.git', local_path: null, provider: 'github' };

function replica(o: { connected?: boolean; repo?: unknown | null; open?: number; title?: string | null; mode?: string | null; tasks?: Array<{ number: number; title: string; state: string; description: string | null }> } = {}) {
  const seen: Array<{ sql: string; params: unknown[] }> = [];
  return {
    seen,
    getAll: async <T,>(sql: string, params: unknown[] = []): Promise<T[]> => {
      seen.push({ sql, params });
      if (/from connectors/.test(sql)) return [{ n: o.connected ? 1 : 0 }] as T[];
      if (/from repos/.test(sql)) return (o.repo === null || o.repo === undefined ? [] : [o.repo]) as T[];
      if (/from decisions/.test(sql)) return [{ n: o.open ?? 0 }] as T[];
      if (/select mode from threads/.test(sql)) return (o.mode === undefined ? [] : [{ mode: o.mode }]) as T[];
      if (/from threads/.test(sql)) return (o.title === undefined ? [] : [{ title: o.title }]) as T[];
      if (/from tasks/.test(sql)) return (o.tasks ?? []).filter((t) => t.number === params[1]) as T[];
      return [] as T[];
    },
  };
}
function poster() {
  const sent: Array<{ path: string; body: Record<string, unknown> }> = [];
  const post = async (path: string, _actor: unknown, body: unknown) => { sent.push({ path, body: body as Record<string, unknown> }); return new Response('{}', { status: 200 }); };
  return { sent, post };
}
/** the API refuses every read with this status and code */
const refuse = (status: number, code: string) => async () => ({ status, ok: false, json: async (): Promise<unknown> => ({ code, error: code }), text: async () => '' });
const rex = { kind: 'agent', id: 'a-rex', role: 'orchestrator' };
const place = { workspace: 'ws', channel: 'ch-build', threadId: 't-1' };
const words = { ask: 'Storage interface investigation', why: 'This conversation reads the code in neuramesh. Nothing ran yet.', lead: 'I need to read the code in neuramesh for this, and nothing here can read it yet.', after: 'rex continues here when GitHub is connected.' };

beforeEach(() => resetNeedMemoForTest());

test('the card posts once, flagged as the tool\'s, with the lead line above it and its foot inside', async () => {
  const db = replica();
  const p = poster();
  assert.equal(await postRepoNeed({ db, post: p.post, actor: rex }, place, words), true);
  assert.equal(p.sent.length, 1);
  const body = p.sent[0]!.body;
  assert.equal(body['needCard'], true);
  assert.equal(body['threadId'], 't-1');
  assert.ok(String(body['body']).startsWith(words.lead));
  const card = parseNeed(String(body['body']));
  assert.deepEqual(card && { connect: card.connect, ask: card.ask, after: card.after, channel: card.channel }, { connect: ['github'], ask: words.ask, after: words.after, channel: 'ch-build' });
  // a second refusal in the same turn: the replica has not seen the row yet, the memo has
  assert.equal(await postRepoNeed({ db, post: p.post, actor: rex }, place, words), true);
  assert.equal(p.sent.length, 1);
});

test('a card already open in the conversation is enough: nothing posts, and the reader still stops', async () => {
  const db = replica({ open: 1 });
  const p = poster();
  assert.equal(await postRepoNeed({ db, post: p.post, actor: rex }, place, words), true);
  assert.equal(p.sent.length, 0);
  const q = db.seen.find((s) => /from decisions/.test(s.sql))!;
  assert.deepEqual(q.params, ['ch-build', 't-1', `${GITHUB_NEED_PREFIX}%`]);
});

test('a task\'s card is keyed by the task, and goes to its thread', async () => {
  const db = replica();
  const p = poster();
  await postRepoNeed({ db, post: p.post, actor: rex }, { workspace: 'ws', channel: 'ch-build', taskId: 'task-1046' }, words);
  assert.equal(p.sent[0]!.body['taskId'], 'task-1046');
  assert.equal(p.sent[0]!.body['threadId'], undefined);
  assert.equal(await needOpen(replica(), { workspace: 'ws', channel: 'ch-build', taskId: 'task-1046' }), true, 'the memo holds the task too');
});

test('a post the server refused is no card: the reader keeps its prose', async () => {
  const db = replica();
  const post = async () => new Response('{}', { status: 422 });
  assert.equal(await postRepoNeed({ db, post, actor: rex }, place, words), false);
});

test('a server that cannot connect GitHub (a Local stack) gets no card: the reader keeps its prose', async () => {
  const seen: string[] = [];
  const answer = (status: number, code: string) => async (path: string) => { seen.push(path); return { status, ok: false, json: async (): Promise<unknown> => ({ code, error: code }), text: async () => '' }; };
  const local = poster();
  assert.equal(await postRepoNeed({ db: replica(), post: local.post, actor: rex, get: answer(501, 'NOT_CONFIGURED') }, place, words), false);
  assert.equal(local.sent.length, 0, 'no card that could never complete');
  assert.match(seen[0]!, /^\/v1\/repo\/tree\?channel=ch-build$/, 'the server is asked by its own read route');
  // a hosted server answers past its App check: the card goes up
  const hosted = poster();
  assert.equal(await postRepoNeed({ db: replica(), post: hosted.post, actor: rex, get: answer(409, 'NOT_CONNECTED') }, place, words), true);
  assert.equal(hosted.sent.length, 1);
  // the reader on a Local stack: the hook declines, so the model reads the prose that names the fix
  resetNeedMemoForTest();
  const quiet = poster();
  const reader = makeRepoReader({ apiGet: answer(501, 'NOT_CONFIGURED'), actor: rex, db: replica({ repo: LOCAL }), channelId: 'ch', capable: async () => false,
    onNeed: () => postRepoNeed({ db: replica(), post: quiet.post, actor: rex, get: answer(501, 'NOT_CONFIGURED') }, place, words) });
  assert.match(await reader.tree({}), /no GitHub remote to read/);
  assert.equal(quiet.sent.length, 0);
});

test('the conversation\'s words name its repository and its title, and a project with none says so', async () => {
  const named = await conversationNeedWords(replica({ repo: LOCAL, title: 'Storage interface investigation' }), place, 'rex');
  assert.equal(named.ask, 'Storage interface investigation');
  assert.match(named.why, /reads the code in neuramesh/);
  assert.match(named.lead, /code in neuramesh/);
  assert.equal(named.after, 'rex continues here when GitHub is connected.');
  const none = await conversationNeedWords(replica({ repo: null }), { ...place, threadId: null }, 'rex');
  assert.equal(none.ask, 'This conversation');
  assert.match(none.why, /no repository yet/);
});

test('readable means the connector, or a GitHub repository and this machine\'s gh: a desktop folder is not', async () => {
  assert.deepEqual(await repoReadable(replica({ connected: true }), 'ch'), { ok: true, repoName: null });
  assert.deepEqual(await repoReadable(replica({ repo: LOCAL }), 'ch', async () => true), { ok: false, repoName: 'neuramesh' });
  assert.deepEqual(await repoReadable(replica({ repo: GITHUB }), 'ch', async () => false), { ok: false, repoName: 'site' });
  assert.deepEqual(await repoReadable(replica({ repo: GITHUB }), 'ch', async () => true), { ok: true, repoName: 'site' });
  assert.deepEqual(await repoReadable(replica({ repo: null }), 'ch'), { ok: false, repoName: null });
});

test('the reader: a refusal a grant fixes puts the card up and tells the model to stop, and without the hook it keeps its prose', async () => {
  const apiGet = async () => ({ status: 409, ok: false, json: async (): Promise<unknown> => ({ code: 'NOT_CONNECTED', error: 'x' }), text: async () => '' });
  let asked = 0;
  const withCard = makeRepoReader({ apiGet, actor: rex, db: replica({ repo: LOCAL }), channelId: 'ch', capable: async () => false, onNeed: async () => { asked++; return true; } });
  assert.equal(await withCard.tree({}), CARD_UP);
  assert.equal(await withCard.file({ path: 'README.md' }), CARD_UP);
  assert.equal(asked, 2);
  const plain = makeRepoReader({ apiGet, actor: rex, db: replica({ repo: LOCAL }), channelId: 'ch', capable: async () => false });
  assert.match(await plain.tree({}), /no GitHub remote to read/);
  // the connector answers NOT_CONNECTED from the server: the same card
  const server = makeRepoReader({ apiGet, actor: rex, db: replica({ connected: true }), channelId: 'ch', onNeed: async () => true });
  assert.equal(await server.changes({}), CARD_UP);
  // a hook that could not post leaves the prose in place
  const failed = makeRepoReader({ apiGet, actor: rex, db: replica({ connected: true }), channelId: 'ch', onNeed: async () => false });
  assert.match(await failed.changes({}), /GitHub is not connected for this project/);
});

test('the conversation\'s reads: a chat-mode thread keeps the prose, since the server mints no row there and no grant could resume it', async () => {
  const read = async (mode: string | null) => {
    resetNeedMemoForTest();
    const p = poster();
    const tools = repoChatTools({ z, text: (s: string) => s, tool: (name: string, _d: string, _s: unknown, run: unknown) => ({ name, run }),
      agent: { id: 'a-plume', name: 'plume', role: 'marketer' }, ch: { id: 'ch-build', slug: 'build', workspace_id: 'ws' }, log: () => {},
      db: replica({ connected: true, mode }), apiGet: refuse(409, 'NOT_CONNECTED'), post: p.post, threadId: 't-1' } as never) as unknown as Array<{ name: string; run: (i: unknown) => Promise<string> }>;
    return { out: await tools.find((x) => x.name === 'read_repo_file')!.run({ path: 'README.md' }), sent: p.sent.length };
  };
  const chat = await read('chat');
  assert.match(chat.out, /GitHub is not connected for this project/);
  assert.equal(chat.sent, 0, 'no card that nothing could resume');
  // the marketer's turn in a tasks thread: the card goes up, and the model stops
  assert.deepEqual(await read('tasks'), { out: CARD_UP, sent: 1 });
});

test('run_playbook on a server that cannot connect GitHub: its card renders, mints no row and promises no resume', async () => {
  const run = async (status: number, code: string) => {
    const p = poster();
    const db = { getAll: async <T,>(sql: string): Promise<T[]> => (/from connectors/.test(sql) ? [{ provider: 'x', status: 'connected' }]
      : /from repos/.test(sql) ? [{ org_name: 'acme', name: 'site', project_id: 'p1' }] : /from channels/.test(sql) ? [{ kind: 'marketing', marketing: null }] : []) as T[] };
    const tools = playbookTools({ z, db, post: p.post, ch: { id: 'ch-mkt', slug: 'marketing', workspace_id: 'ws' }, actor: rex, thread: null, convoThreadId: 't-1',
      log: () => {}, here: () => 'ch-mkt', known: new Map(), apiGet: refuse(status, code), agent: { name: 'rex' } } as never, async () => false);
    await tools.find((x) => x.name === 'run_playbook')!.run({ playbook: 'release', inputs: { release: 'v1.2.0' } });
    assert.equal(p.sent.length, 1);
    return { needCard: p.sent[0]!.body['needCard'], card: parseNeed(String(p.sent[0]!.body['body'])) };
  };
  const local = await run(501, 'NOT_CONFIGURED');
  assert.deepEqual(local.card?.connect, ['github']);
  assert.equal(local.needCard, undefined, 'no Needs-you row waits for a grant that can never land');
  assert.equal(local.card?.after, undefined);
  const hosted = await run(409, 'NOT_CONNECTED');
  assert.equal(hosted.needCard, true);
  assert.equal(hosted.card?.after, 'rex runs Release drafts here when GitHub is connected.');
});

test('the #N a brief names travel with the brief: numbers once each, from the board, never a stranger\'s', async () => {
  assert.deepEqual(taskNumbersIn('What does #1046 need, and is #1046 blocked by #1052? Not &#39; or a/#3.'), [1046, 1052]);
  const db = replica({ tasks: [{ number: 1046, title: 'Standardize the storage interface', state: 'backlog', description: 'One object model for every adapter.' }] });
  const refs = await referencedTasks(db, 'ws', 'Migration and verification for #1046 and #9999');
  assert.match(refs, /^The tasks this brief names, from the board:/);
  assert.match(refs, /#1046 · Standardize the storage interface · backlog\nOne object model for every adapter\./);
  assert.doesNotMatch(refs, /#9999/);
  const q = db.seen.find((s) => /from tasks/.test(s.sql))!;
  assert.equal(q.params[0], 'ws', 'the lookup stays in this workspace');
  assert.equal(await referencedTasks(db, 'ws', 'no numbers here'), '');
});
