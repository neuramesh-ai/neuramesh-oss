import test from 'node:test';
import assert from 'node:assert/strict';
import type { EngineeringCommand } from '../../../engineering-protocol';
import { ENGINEERING_ATTACHMENT_CHUNK_BYTES, sendEngineeringPrompt } from './transport';

const handle = (send: (command: EngineeringCommand) => Promise<void>) => ({ subId: 'test', send, close: () => {} });

test('an initial relay send failure rejects instead of leaving the turn live', async () => {
  await assert.rejects(sendEngineeringPrompt(handle(async () => { throw new Error('relay unavailable'); }), 'Fix it', []), /relay unavailable/);
});

test('a mid-upload relay failure aborts before the prompt is dispatched', async () => {
  const seen: EngineeringCommand[] = [];
  const upload = { id: 'a1', name: 'large.txt', mime: 'text/plain', bytes: new Uint8Array(ENGINEERING_ATTACHMENT_CHUNK_BYTES + 1) };
  await assert.rejects(sendEngineeringPrompt(handle(async (command) => {
    seen.push(command);
    if (command.type === 'attachment_chunk' && command.index === 1) throw new Error('channel closed');
  }), 'Read this', [upload]), /channel closed/);
  assert.equal(seen.some((command) => command.type === 'prompt'), false);
});
