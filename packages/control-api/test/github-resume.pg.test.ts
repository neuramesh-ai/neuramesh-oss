// the GitHub card's resume against the REAL schema. the memory twin is github-resume.test.ts.
//
// what this locks down:
//   · openGitHubNeeds reads the open GitHub cards of the rooms of one project, with each card's
//     conversation (the join through messages.thread_id), and never another project's. a card is a
//     row whose message holds the nmneed block, and a task card carries its last block's reason
//   · resumeAfterGitHub answers each card as the person, posts the connected divider in its
//     conversation as that person, and a second run finds nothing open. a task the claim blocked for
//     GitHub unblocks, and a task blocked for another reason stays blocked with the divider in its thread
//   · a GitHub card supersedes only an older card of its own conversation (postMessage)
//   · the room's repository is the one its project's GitHub row names while the row is connected or
//     waits for a new grant, and a revoked row names nothing (repoForChannel)
//   · the resolve's way-out words find a grant no workspace recorded (installationForRepo `unrecorded`)
//
// its own workspace on the cloud plan, like coding-threads.pg.test.ts: the fixture workspace is on
// the free plan, whose 3-project cap the other suites fill first. skipped without DATABASE_URL
// (scripts/test-pg.sh).
import { GITHUB_NEED_PREFIX, githubConnectedMarker, needBlock, type Actor } from '@neuramesh/shared';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { resumeAfterGitHub } from '../src/github-resume';
import { PostgresStore } from '../src/pgstore';

const DB = process.env['DATABASE_URL'];
let WS = '';
let george: Actor = { kind: 'human', id: '' };
const rex: Actor = { kind: 'agent', id: '20000000-0000-0000-0000-000000000002', role: 'orchestrator' };
const patch: Actor = { kind: 'agent', id: '30000000-0000-0000-0000-000000000003', role: 'worker' };
const store = DB ? new PostgresStore(DB) : null;
const app = store ? createApp(store) : null;
const sql = DB ? postgres(DB, { max: 1, prepare: false, onnotice: () => {} }) : null;
const j = (r: Response): Promise<any> => r.json() as Promise<any>;
const send = (actor: Actor, path: string, body: unknown) =>
  app!.request(path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) }, body: JSON.stringify(body) });
const card = (channel: string, ask: string) => `I need to read the code for this.\n\n${needBlock({ channel, ask, why: 'It reads the code.', connect: ['github'] })}`;
/** a room in a project of its own, so a test's cards never meet another test's */
const room = async (tag: string): Promise<string> => {
  const id = crypto.randomUUID().slice(0, 8);
  const project = await j(await send(george, '/v1/commands', { type: 'project.create', workspace: WS, name: `${tag} ${id}` }));
  return (await j(await send(george, '/v1/commands', { type: 'channel.create', workspace: WS, project: project.projectId, slug: `${tag}-${id}` }))).channelId as string;
};

let A = ''; let B = ''; let X = '';
beforeAll(async () => {
  if (!app || !sql) return;
  const [u] = await sql`insert into nm_users (clerk_user_id, email) values ('clerk_rc_george', 'george@repo-connect.test')
    on conflict (clerk_user_id) do update set email = excluded.email returning id`;
  george = { kind: 'human', id: u!['id'] as string };
  WS = (await j(await send(george, '/v1/commands', { type: 'workspace.create', name: 'Repo Connect', slug: `rc-${Date.now().toString(36)}` }))).workspaceId as string;
  await sql`update workspaces set plan = 'cloud' where id = ${WS}::uuid`;
  const here = await j(await send(george, '/v1/commands', { type: 'project.create', workspace: WS, name: `Repo connect ${Date.now().toString(36)}` }));
  const away = await j(await send(george, '/v1/commands', { type: 'project.create', workspace: WS, name: `Elsewhere ${Date.now().toString(36)}` }));
  A = (await j(await send(george, '/v1/commands', { type: 'channel.create', workspace: WS, project: here.projectId, slug: `rc-a-${Date.now().toString(36)}` }))).channelId as string;
  B = (await j(await send(george, '/v1/commands', { type: 'channel.create', workspace: WS, project: here.projectId, slug: `rc-b-${Date.now().toString(36)}` }))).channelId as string;
  X = (await j(await send(george, '/v1/commands', { type: 'channel.create', workspace: WS, project: away.projectId, slug: `rc-x-${Date.now().toString(36)}` }))).channelId as string;
});

afterAll(async () => { await store?.close(); await sql?.end(); });

describe.skipIf(!DB)('the GitHub card resume against real postgres', () => {
  it('reads the project\'s open cards with their conversations, answers them as the person, and posts the divider once', async () => {
    const [tA, tB, tX] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    for (const [channel, threadId, ask] of [[A, tA, 'The audit'], [B, tB, 'The notes'], [X, tX, 'The site']] as const) {
      expect((await send(rex, '/v1/messages', { workspace: WS, channel, threadId, body: card(channel, ask), needCard: true })).status).toBe(200);
    }
    const open = await store!.announcements.openGitHubNeeds(A);
    expect(open.map((o) => o.threadId).sort()).toEqual([tA, tB].sort());
    expect(open.every((o) => o.taskId === null && o.blockReason === null)).toBe(true);

    expect(await resumeAfterGitHub(store!, { workspace: WS, channel: A, actor: george.id }, 'acme/site')).toBe(2);
    const dividers = await sql!`select thread_id, author_kind::text as kind, author_id from messages where body = ${githubConnectedMarker('acme/site')} and thread_id in (${tA}::uuid, ${tB}::uuid, ${tX}::uuid)`;
    expect(dividers.map((d) => d['thread_id']).sort()).toEqual([tA, tB].sort());
    expect(dividers.every((d) => d['kind'] === 'human' && d['author_id'] === george.id)).toBe(true);

    const rows = (await store!.listDecisions(WS)).filter((d) => d.question.startsWith(GITHUB_NEED_PREFIX) && [A, B, X].includes(d.channel));
    expect(rows.filter((d) => d.status === 'answered').map((d) => d.channel).sort()).toEqual([A, B].sort());
    expect(rows.find((d) => d.channel === X)?.status).toBe('open');

    // the card polls the resolve every 5 s: the next run finds nothing open, and posts nothing
    expect(await resumeAfterGitHub(store!, { workspace: WS, channel: A, actor: george.id }, 'acme/site')).toBe(0);
  });

  it('two conversations of one room with the same ask keep their own cards, and an agent question with the prefix is no card', async () => {
    const ch = await room('rc-same');
    const [t1, t2, t3] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    for (const threadId of [t1, t2, t1]) expect((await send(rex, '/v1/messages', { workspace: WS, channel: ch, threadId, body: card(ch, 'Release drafts'), needCard: true })).status).toBe(200);
    const question = `${GITHUB_NEED_PREFIX}which branch should I read?`;
    expect((await send(rex, '/v1/messages', { workspace: WS, channel: ch, threadId: t3, body: '```nmq\n' + JSON.stringify({ question, options: ['main', 'dev'] }) + '\n```' })).status).toBe(200);
    const rows = (await store!.listDecisions(WS)).filter((d) => d.channel === ch);
    expect(rows.filter((d) => d.question !== question).map((d) => d.status).sort()).toEqual(['dismissed', 'open', 'open']);
    expect(rows.find((d) => d.question === question)?.status).toBe('open');
    expect((await store!.announcements.openGitHubNeeds(ch)).map((o) => o.threadId).sort()).toEqual([t1, t2].sort());
  });

  it('a task card: the claim\'s GitHub wait unblocks, and a task blocked for another reason stays blocked with the divider in its thread', async () => {
    const ch = await room('rc-task');
    const blocked = async (title: string, reason: string): Promise<string> => {
      const { task } = await j(await send(george, '/v1/commands', { type: 'task.create', workspace: WS, channel: ch, title, kind: 'feature' }));
      expect((await send(patch, '/v1/commands', { type: 'task.claim', taskId: task.id })).status).toBe(200);
      expect((await send(patch, '/v1/commands', { type: 'task.block', taskId: task.id, reason })).status).toBe(200);
      expect((await send(patch, '/v1/messages', { workspace: WS, channel: ch, taskId: task.id, body: card(ch, `#${task.number}`), needCard: true })).status).toBe(200);
      return task.id as string;
    };
    const waits = await blocked('Push the branch', 'Waits for GitHub: this cloud machine cannot push the branch yet.');
    const legal = await blocked('Publish the terms', 'Waits on legal sign-off');
    expect((await store!.announcements.openGitHubNeeds(ch)).map((o) => [o.taskId, o.threadId, o.blockReason]))
      .toEqual([[waits, null, 'Waits for GitHub: this cloud machine cannot push the branch yet.'], [legal, null, 'Waits on legal sign-off']]);

    expect(await resumeAfterGitHub(store!, { workspace: WS, channel: ch, actor: george.id }, 'acme/site')).toBe(2);
    expect((await store!.getTask(waits))?.state).toBe('in_progress');
    expect((await store!.getTask(legal))?.state).toBe('blocked');
    const dividers = await sql!`select task_id, thread_id, author_kind::text as kind, author_id from messages where body = ${githubConnectedMarker('acme/site')} and task_id in (${waits}::uuid, ${legal}::uuid)`;
    expect(dividers.map((d) => ({ ...d }))).toEqual([{ task_id: legal, thread_id: null, kind: 'human', author_id: george.id }]);
  });

  it('the room\'s repository is the one its project\'s live GitHub row names, even when it sorts second', async () => {
    const ch = await room('rc-repo');
    const tag = crypto.randomUUID().slice(0, 8);
    for (const name of [`alpha-${tag}`, `site-${tag}`]) expect((await send(george, '/v1/commands', { type: 'repo.link', workspace: WS, channel: ch, url: `https://github.com/acme/${name}` })).status).toBe(200);
    expect(await store!.announcements.repoForChannel(ch)).toMatchObject({ orgName: 'acme', name: `alpha-${tag}` });
    const { id } = await store!.upsertConnector({ workspace: WS, channelId: ch, provider: 'github', handle: `acme/site-${tag}`, connectedBy: george.id, scopes: '' });
    expect(await store!.announcements.repoForChannel(ch)).toMatchObject({ orgName: 'acme', name: `site-${tag}` });
    // a row that waits for a new grant still names the pick, so the reconnect words name it too
    await store!.markConnectorReauth(id);
    expect(await store!.announcements.repoForChannel(ch)).toMatchObject({ orgName: 'acme', name: `site-${tag}` });
    // a person's disconnect names nothing: the old order comes back
    await sql!`update connectors set status = 'revoked' where id = ${id}::uuid`;
    expect(await store!.announcements.repoForChannel(ch)).toMatchObject({ orgName: 'acme', name: `alpha-${tag}` });
  });

  it('the grant no workspace recorded: installationForRepo reads it only when asked for one', async () => {
    const tag = crypto.randomUUID().slice(0, 8);
    const [ours, door] = [880_000_000 + Math.floor(Math.random() * 9_000_000), 890_000_000 + Math.floor(Math.random() * 9_000_000)];
    await store!.announcements.upsertInstallation({ installationId: ours, account: 'acme', repos: [`acme/ours-${tag}`], workspaceId: WS });
    await store!.announcements.upsertInstallation({ installationId: door, account: 'acme', repos: [`acme/door-${tag}`] });
    expect(await store!.announcements.installationForRepo(`acme/ours-${tag}`)).toEqual({ installationId: ours });
    expect(await store!.announcements.installationForRepo(`acme/ours-${tag}`, { unrecorded: true })).toBeNull();
    expect(await store!.announcements.installationForRepo(`ACME/door-${tag}`, { unrecorded: true })).toEqual({ installationId: door });
    // the door's callback never forgets a workspace a grant named: the row stays recorded
    await store!.announcements.upsertInstallation({ installationId: ours, account: 'acme', repos: [`acme/ours-${tag}`], workspaceId: null });
    expect(await store!.announcements.installationForRepo(`acme/ours-${tag}`, { unrecorded: true })).toBeNull();
    await sql!`delete from github_installations where installation_id in (${ours}, ${door})`;
  });
});
