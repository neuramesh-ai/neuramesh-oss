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

// THE OPENING INVENTORY (2026-09-19): the desktop's Claude turns ran for days with no nm server in
// the session (the model searched for load_skill, draft_posts, create_task… and found only the
// user's claude.ai connectors), answered as a tool-less writer, and the monitor sweep then filed
// "fallen-through" units for those answers. A turn that expects nm and does not get it says so.
test('a turn that expects the nm server stops with the honest line when the CLI came up without it, and logs the inventory either way', async () => {
  const { mcpInventory, NM_TOOLS_MISSING } = await import('./turnkit');
  const init = (servers: Array<{ name: string; status: string }>, tools: string[] = []) => ({ type: 'system', subtype: 'init', tools, mcp_servers: servers });
  const logs: Array<{ summary?: string; level?: string }> = [];
  const log = (r: { summary?: string; level?: string }) => { logs.push(r); };
  // absent: the 2026-09-19 desktop session (only the claude.ai connectors came up)
  const gone = await drainQuery(stream([
    init([{ name: 'claude-design', status: 'failed' }, { name: 'claude.ai Claude Docs', status: 'connected' }], ['ToolSearch', 'Read', 'mcp__claude_ai_Claude_Docs__guide']),
    assistant([{ type: 'text', text: 'I do not have your brand docs loaded, so here are three scripts…' }]),
    result('I do not have your brand docs loaded, so here are three scripts…'),
  ]), 'fallback', log, undefined, undefined, { mcp: 'nm' });
  assert.equal(gone, NM_TOOLS_MISSING);
  assert.match(logs[0]!.summary!, /^tools: mcp servers: claude-design=failed, claude.ai Claude Docs=connected · nm tools in the prompt: 0/);
  assert.equal(logs[0]!.level, 'warn');
  // failed: the same answer
  assert.equal(mcpInventory({ mcp_servers: [{ name: 'nm', status: 'failed' }] }, 'nm').ok, false);
  // connected runs; pending is given a moment (the CLI's status call decides); needs-auth never connects
  assert.equal(mcpInventory({ tools: ['mcp__nm__list_tasks'], mcp_servers: [{ name: 'nm', status: 'connected' }] }, 'nm').ok, true);
  assert.deepEqual(mcpInventory({ mcp_servers: [{ name: 'nm', status: 'pending' }] }, 'nm').pending, true);
  assert.equal(mcpInventory({ mcp_servers: [{ name: 'nm', status: 'needs-auth' }] }, 'nm').ok, false);
  // a stream that answers the status call: pending at init, connected on the first ask → the turn runs
  const late = Object.assign(stream([
    init([{ name: 'nm', status: 'pending' }]),
    assistant([{ type: 'text', text: 'Late but here.' }]),
    result('Late but here.'),
  ]), { mcpServerStatus: async () => [{ name: 'nm', status: 'connected' }] });
  assert.equal(await drainQuery(late, 'fallback', log, undefined, undefined, { mcp: 'nm' }), 'Late but here.');
  const fine = await drainQuery(stream([
    init([{ name: 'nm', status: 'connected' }], ['ToolSearch', 'mcp__nm__list_tasks']),
    assistant([{ type: 'text', text: 'On it.' }]),
    result('On it.'),
  ]), 'fallback', log, undefined, undefined, { mcp: 'nm' });
  assert.equal(fine, 'On it.');
  assert.equal(logs.find((l) => /nm=connected/.test(l.summary ?? ''))?.level, 'info');
  // a turn that expects nothing (a worker's) ignores the inventory
  assert.equal(await drainQuery(stream([init([]), assistant([{ type: 'text', text: 'x' }]), result('x')]), 'fallback'), 'x');
});
