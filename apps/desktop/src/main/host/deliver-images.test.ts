import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { deliverImages } from './deliver-images';
import { imagesChatTool } from './chattools-share';
import { contentTools } from './tools-content';

const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9D8AAAAASUVORK5CYII=', 'base64');
const image = { bytes, mime: 'image/jpeg', thumb: 'data:image/jpeg;base64,PREVIEW' };
const actor = { kind: 'agent', id: 'rex' };
const channel = { id: 'room', workspace_id: 'workspace' };
const input = { images: [{ brief: 'A detailed sunset sky', name: 'sunset.jpg' }] };

function rig(failUpload = false) {
  const calls: Array<{ path: string; body: any }> = [];
  const post = async (path: string, _actor: unknown, body: unknown) => {
    calls.push({ path, body });
    return path === '/v1/messages' ? Response.json({ message: { id: 'message', thread_id: 'server-thread' } })
      : new Response('{}', { status: failUpload ? 503 : 200 });
  };
  return { calls, post };
}

for (const registry of ['chat', 'orchestrator'] as const) test(`${registry} image tool uploads original bytes and sniffed MIME, never the preview`, async () => {
  const { calls, post } = rig();
  const context = { z, post, actor, agent: { id: 'rex' }, ch: channel, threadId: 'server-thread', convoThreadId: 'server-thread',
    log: () => {}, generateShareImage: async () => image, text: (text: string) => text };
  let run: (input: unknown) => Promise<unknown>;
  if (registry === 'chat') imagesChatTool({ ...context, tool: (_name: string, _description: string, _schema: unknown, execute: typeof run) => { run = execute; } } as never);
  else run = contentTools(context as never).find(tool => tool.name === 'share_images')!.run;
  assert.match(String(await run!(input)), /now SHOWING/);
  const upload = calls[1]!;
  assert.equal(upload.path, '/v1/brain/artifacts');
  assert.equal(upload.body.threadId, 'server-thread');
  assert.equal(upload.body.messageId, 'message');
  assert.equal(upload.body.name, 'sunset.png');
  assert.equal(upload.body.mime, 'image/png');
  assert.deepEqual(Buffer.from(upload.body.contentBase64, 'base64'), bytes);
  assert.equal(upload.body.sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(upload.body.inlineContent, undefined);
});

test('task images use the server-created task thread and keep their message anchor', async () => {
  const { calls, post } = rig();
  await deliverImages({ post, actor, channel, anchor: { taskId: 'task' }, generate: async () => image }, input);
  assert.equal(calls[0]!.body.taskId, 'task');
  assert.equal(calls[1]!.body.threadId, 'server-thread');
  assert.equal(calls[1]!.body.messageId, 'message');
});

test('a thumbnail without its original is a failed generation, not a saved image', async () => {
  const { calls, post } = rig();
  const result = await deliverImages({ post, actor, channel, anchor: { threadId: 'thread' }, generate: async () => ({ thumb: image.thumb }) }, input);
  assert.equal(result.attached, 0);
  assert.match(result.error!, /original image/);
  assert.equal(calls.length, 0);
});

test('an upload rejection never reports attachment success or falls back to a thumbnail', async () => {
  const { calls, post } = rig(true);
  const result = await deliverImages({ post, actor, channel, anchor: { threadId: 'thread' }, generate: async () => image }, input);
  assert.equal(result.attached, 0);
  assert.match(result.error!, /could not be attached/);
  assert.match(result.failed[0]!, /503/);
  assert.equal(calls.length, 2);
});
