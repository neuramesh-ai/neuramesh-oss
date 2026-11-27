// ask_publish and publish_file (plan I14 point 4): the agent finds a file in Files in its rooms, by id or by name
// (George, 2026-11-24: the session runs in #general, and the file is in #build). ask_publish posts the card.
// publish_file names the file and the session to POST /v1/publish, which decides, and gives the agent the link or
// the reason. Both refuse a file that cannot go out, a file outside the agent's rooms, a name in two other rooms,
// and a turn with no conversation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { parsePublishAsk } from '@neuramesh/shared';
import { publishTools } from './tools-publish';

const ID = '6f1c0e1a-0000-4000-8000-000000000001';
type Answer = { status: number; body: Record<string, unknown> };
type File = { id: string; name: string; channel?: string };
// the replica: the agent is in room-a (the session's room), room-b and room-d, and not in room-c
const ROOMS = ['room-a', 'room-b', 'room-d'];
function replica(files: File[]) {
  const mine = files.map((f) => ({ ...f, channel: f.channel ?? 'room-a' })).filter((f) => ROOMS.includes(f.channel));
  return {
    getAll: async (sql: string, params: unknown[]) => {
      if (/a\.id = \?/.test(sql)) return mine.filter((f) => f.id === params[1]).map((f) => ({ id: f.id, name: f.name, room: f.channel }));
      const here = String(params[0]);
      return mine.filter((f) => f.name.toLowerCase() === String(params[3]).toLowerCase())
        .map((f) => ({ id: f.id, name: f.name, room: f.channel, here: f.channel === here ? 1 : 0 }))
        .sort((a, b) => b.here - a.here);
    },
  };
}
function fixture(files: File[], anchor: { threadId: string } | { taskId: string } | null = { threadId: 'thread-a' }, answer: Answer = { status: 200, body: {} }) {
  const posts: Array<{ path: string; body: Record<string, unknown> }> = [];
  const [tool, publish] = publishTools({
    z, ch: { id: 'room-a', workspace_id: 'ws' }, actor: { kind: 'agent', id: 'pike' }, anchor: () => anchor,
    db: replica(files) as never,
    post: (async (path: string, _actor: unknown, body: Record<string, unknown>) => {
      posts.push({ path, body });
      return { ok: answer.status < 300, status: answer.status, json: async () => answer.body };
    }) as never,
  });
  return { tool: tool!, publish: publish!, posts };
}

test('posts the card for a file in the room, and says that only the person publishes', async () => {
  const f = fixture([{ id: ID, name: 'field-sync-demo.mp4' }]);
  assert.equal(f.tool.name, 'ask_publish');
  const said = await f.tool.run({ file: 'Field-Sync-Demo.mp4', for: 'The video block in the email to Lena' });
  assert.match(said, /Only the person can publish it/);
  assert.equal(f.posts.length, 1);
  assert.equal(f.posts[0]!.path, '/v1/messages');
  assert.equal(f.posts[0]!.body['threadId'], 'thread-a');
  assert.deepEqual(parsePublishAsk(String(f.posts[0]!.body['body'])), { id: ID, for: 'The video block in the email to Lena', prose: '', done: false });
});

test('refuses an SVG or a PDF, a name that is not in Files, and a turn with no conversation', async () => {
  const f = fixture([{ id: ID, name: 'logo.svg' }, { id: ID, name: 'deck.pdf' }]);
  assert.match(await f.tool.run({ file: 'logo.svg' }), /cannot be published/);
  assert.match(await f.tool.run({ file: 'deck.pdf' }), /cannot be published/);
  assert.match(await f.tool.run({ file: 'missing.mp4' }), /Call list_library with scope project or workspace/);
  assert.equal(f.posts.length, 0);
  assert.match(await fixture([{ id: ID, name: 'a.png' }], null).tool.run({ file: 'a.png' }), /needs a conversation/);
});

test('publish_file names the file and the session, and gives back the link that the server made', async () => {
  const url = 'https://acme.neuramesh.page/i/abc';
  const f = fixture([{ id: ID, name: 'launch.png' }], { threadId: 'thread-a' }, { status: 200, body: { link: { url } } });
  assert.equal(f.publish.name, 'publish_file');
  const said = await f.publish.run({ file: 'launch.png', for: 'The launch post' });
  assert.match(said, new RegExp(`Published "launch.png" at ${url}`));
  assert.deepEqual(f.posts, [{ path: '/v1/publish', body: { workspace: 'ws', artifact: ID, thread: 'thread-a', for: 'The launch post' } }]);
  // a task thread names the task
  const task = fixture([{ id: ID, name: 'launch.png' }], { taskId: 'task-a' }, { status: 200, body: { link: { url } } });
  await task.publish.run({ file: 'launch.png' });
  assert.equal(task.posts[0]!.body['task'], 'task-a');
});

test('publish_file says why the server refused, and sends the agent to ask_publish when no person asked', async () => {
  const none = fixture([{ id: ID, name: 'launch.png' }], { threadId: 'thread-a' }, { status: 403, body: { code: 'HUMAN_WORD', error: 'No person typed in this session in the last 30 minutes.' } });
  assert.match(await none.publish.run({ file: 'launch.png' }), /Not published: No person typed.*Call ask_publish/);
  const scan = fixture([{ id: ID, name: 'deck.html' }], { threadId: 'thread-a' }, { status: 400, body: { code: 'SECRET_FOUND', error: 'The scan found a value like a secret.' } });
  const said = await scan.publish.run({ file: 'deck.html' });
  assert.match(said, /Not published: The scan found/);
  assert.doesNotMatch(said, /ask_publish/);
  const svg = fixture([{ id: ID, name: 'logo.svg' }]);
  assert.match(await svg.publish.run({ file: 'logo.svg' }), /cannot be published/);
  assert.match(await fixture([{ id: ID, name: 'a.png' }], null).publish.run({ file: 'a.png' }), /needs the conversation/);
  assert.equal(svg.posts.length, 0);
});


test('publish_file takes the id of a file in another room of the agent, and the link comes to this session', async () => {
  // George, 2026-11-24: the session is in #general (room-a), and the mockup is in Files in #build (room-b)
  const url = 'https://acme.neuramesh.page/p/abc';
  const f = fixture([{ id: ID, name: 'design-mockup-v2-homepage-settle.html', channel: 'room-b' }], { threadId: 'thread-a' }, { status: 200, body: { link: { url } } });
  assert.match(await f.publish.run({ file: ID }), /Published "design-mockup-v2-homepage-settle\.html"/);
  assert.deepEqual(f.posts, [{ path: '/v1/publish', body: { workspace: 'ws', artifact: ID, thread: 'thread-a', for: '' } }]);
  // and by name, when one other room holds it
  const byName = fixture([{ id: ID, name: 'design-mockup-v2-homepage-settle.html', channel: 'room-b' }], { threadId: 'thread-a' }, { status: 200, body: { link: { url } } });
  await byName.publish.run({ file: 'design-mockup-v2-homepage-settle.html' });
  assert.equal(byName.posts[0]!.body['artifact'], ID);
});

test('a name in this room wins, a name in two other rooms asks for the id, and a room the agent is not in refuses', async () => {
  const OTHER = '6f1c0e1a-0000-4000-8000-000000000002';
  const here = fixture([{ id: OTHER, name: 'deck.html', channel: 'room-b' }, { id: ID, name: 'deck.html' }], { threadId: 'thread-a' }, { status: 200, body: { link: { url: 'https://x' } } });
  await here.publish.run({ file: 'deck.html' });
  assert.equal(here.posts[0]!.body['artifact'], ID);
  const two = fixture([{ id: ID, name: 'deck.html', channel: 'room-b' }, { id: OTHER, name: 'deck.html', channel: 'room-d' }]);
  assert.match(await two.publish.run({ file: 'deck.html' }), /more than one room \(#room-b, #room-d\).*use the id/);
  assert.equal(two.posts.length, 0);
  // a file of room-c: the agent is not in that room, so neither its id nor its name finds it
  const outside = fixture([{ id: ID, name: 'secret-plan.html', channel: 'room-c' }]);
  assert.match(await outside.publish.run({ file: ID }), /No file in Files in your rooms has the id/);
  assert.match(await outside.tool.run({ file: 'secret-plan.html' }), /No file named "secret-plan\.html" is in Files in your rooms/);
  assert.equal(outside.posts.length, 0);
});

test('the tools say: name the file by its id, publish it as it is, never copy it, and the skill is not a gate', async () => {
  const f = fixture([]);
  for (const d of [f.tool.description, f.publish.description]) assert.match(d, /id from list_library/);
  assert.match(f.publish.description, /never copy it to publish it/);
  assert.match(f.publish.description, /Read a file only to make a NEW page/);
  assert.match(f.publish.description, /You do not need it to publish a file/);
  assert.match(f.publish.description, /not in the repository/);
  for (const d of [f.tool.description, f.publish.description]) assert.doesNotMatch(d, /—|;/);
});
