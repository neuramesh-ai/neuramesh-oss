// drainQuery over the SDK's stream shape: the reply keeps the words the model said in a message
// of its own, even when a tool call and its one-line confirmation close the turn.
import test from 'node:test';
import assert from 'node:assert/strict';
import { drainQuery } from './turnkit';

const INTRO = "👋 Hey. I'm @rex, your orchestrator. This is #general, the team's home base. Mention me with a goal and I'll break it into board tasks and hand them to the team.";
const PILLS = '```nms\n["What are we building?", "Show me the library docs"]\n```';

async function* stream(messages: unknown[]): AsyncIterable<unknown> { for (const m of messages) yield m; }
const assistant = (content: unknown[]) => ({ type: 'assistant', message: { content } });
const result = (text: string) => ({ type: 'result', subtype: 'success', result: text });

test('an introduction, a tool check, a confirmation: the reply is the introduction and the confirmation', async () => {
  const reply = await drainQuery(stream([
    assistant([{ type: 'text', text: INTRO }]),
    assistant([{ type: 'text', text: 'Let me check the board.' }, { type: 'tool_use', id: 't1', name: 'mcp__nm__list_tasks', input: {} }]),
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: '[]' }] } },
    assistant([{ type: 'text', text: 'Confirmed: no open tasks on the board right now.' }]),
    result('Confirmed: no open tasks on the board right now.'),
  ]), 'fallback');
  assert.equal(reply, `${INTRO}\n\nConfirmed: no open tasks on the board right now.`);
});

test('an introduction, then the pills as their own final block: the words lead and the pills follow', async () => {
  const reply = await drainQuery(stream([
    assistant([{ type: 'text', text: INTRO }]),
    assistant([{ type: 'text', text: PILLS }]),
    result(PILLS),
  ]), 'fallback');
  assert.equal(reply, `${INTRO}\n\n${PILLS}`);
});

test('narration before a tool call still goes when the final block answers', async () => {
  const reply = await drainQuery(stream([
    assistant([{ type: 'text', text: 'Let me check the board.' }, { type: 'tool_use', id: 't1', name: 'mcp__nm__list_tasks', input: {} }]),
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: '[]' }] } },
    assistant([{ type: 'text', text: 'The board is empty. Give me a goal and I will draft the first unit.' }]),
    result('The board is empty. Give me a goal and I will draft the first unit.'),
  ]), 'fallback');
  assert.equal(reply, 'The board is empty. Give me a goal and I will draft the first unit.');
});
