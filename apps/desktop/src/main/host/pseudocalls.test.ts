import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';
import { RUN_NARRATED, argumentsOnlyReply, parsePseudoToolCalls, relabelPillFence, schemaArgs, stripPseudoToolCalls } from './pseudocalls';

const TOOLS = ['set_thread_title', 'create_task', 'add_backlog_item'];

// the live reply, verbatim shape (2026-09-17, Starter lane, routine "Starter lane check")
const LIVE = '```\nset_thread_title(title="Routine Starter Lane Check", description="Checking open tasks and room status.")\n```\n\nOpen tasks: eight.\nNewest task title: dependency audits.';

test('a fenced narrated call to an offered tool is dropped, the answer stays', () => {
  const r = stripPseudoToolCalls(LIVE, TOOLS);
  assert.equal(r.stripped, 1);
  assert.equal(r.text, 'Open tasks: eight.\nNewest task title: dependency audits.');
});

test('a bare narrated call on its own line is dropped too, with either prefix the bridges use', () => {
  const r = stripPseudoToolCalls('nm.create_task(title="x")\nDone.\nmcp__nm__add_backlog_item(title="y");', TOOLS);
  assert.equal(r.stripped, 2);
  assert.equal(r.text, 'Done.');
});

test('prose that mentions a tool, a fence with real content, and unknown names all stay untouched', () => {
  for (const t of [
    'I used set_thread_title to name this thread.',
    '```ts\nconst x = set_thread_title("a");\nreturn x;\n```',
    'frobnicate(title="x")',
    '```nms\n["Consolidate the duplicates", "Add missing requirements"]\n```',
  ]) {
    const r = stripPseudoToolCalls(t, TOOLS);
    assert.equal(r.stripped, 0, t);
    assert.equal(r.text, t);
  }
});

test('no tools offered, or no text: nothing happens', () => {
  assert.deepEqual(stripPseudoToolCalls(LIVE, []), { text: LIVE, stripped: 0 });
  assert.deepEqual(stripPseudoToolCalls('', TOOLS), { text: '', stripped: 0 });
});

test('a reply that was ONLY a narrated call empties out, so the caller stands down instead of posting noise', () => {
  const r = stripPseudoToolCalls('```\nset_thread_title(title="Only this")\n```', TOOLS);
  assert.equal(r.stripped, 1);
  assert.equal(r.text, '');
});

// ── rex's first reply on the sandbox (2026-10-27): the starter brain, gemini, the "NeuraMesh brain"
// pack. The stored message body, byte for byte up to the answer, whose last sentence the browser
// check cut at "turn…" (the page text carries it whole). The arguments came as a ```json fence and
// the call as a markdown link glued to the fence's closing backticks.
const REX_ANSWER = 'I am Rex, the orchestrator for this build room, coordinating the team and turning requests into shippable work.';
const REX = '```json\n{\n  "title": "Agent Introduction",\n  "description": "Introduce the agent role in the build channel"\n}\n```[set_thread_title](title="Agent Introduction", description="Introduce the agent role in the build channel")\n\n' + REX_ANSWER;
const REX_ARGS = { title: 'Agent Introduction', description: 'Introduce the agent role in the build channel' };
// what the turn hands the filter: each offered tool and its schema's parameter names
const OFFERED = [
  { name: 'set_thread_title', params: ['title', 'description'] },
  { name: 'create_task', params: ['title', 'plan', 'repoName'] },
  { name: 'add_backlog_item', params: ['title', 'detail'] },
];

test('rex\'s reply: the json fence and the link call both go, the answer stays, and the call keeps its arguments', () => {
  const r = parsePseudoToolCalls(REX, OFFERED);
  assert.equal(r.text, REX_ANSWER);
  assert.deepEqual(r.calls, [{ name: 'set_thread_title', args: REX_ARGS }]);
  assert.equal(r.stripped, 1, 'one call, in two pieces');
});

test('rex\'s reply with names only (the old signature): the link call names its own keys, so the fence still fits', () => {
  const r = stripPseudoToolCalls(REX, TOOLS);
  assert.equal(r.text, REX_ANSWER);
  assert.equal(r.stripped, 1);
});

test('a link call with no arguments of its own takes the fence beside it, when the tool takes its keys', () => {
  const empty = parsePseudoToolCalls(REX.replace(/\(title=[^)]*\)/, '()'), OFFERED);
  assert.equal(empty.text, REX_ANSWER);
  assert.deepEqual(empty.calls, [{ name: 'set_thread_title', args: REX_ARGS }]);
  // the fence after the call, not before it
  const after = parsePseudoToolCalls(`[set_thread_title]()\n\`\`\`json\n${JSON.stringify(REX_ARGS)}\n\`\`\`\n\n${REX_ANSWER}`, OFFERED);
  assert.equal(after.text, REX_ANSWER);
  assert.deepEqual(after.calls, [{ name: 'set_thread_title', args: REX_ARGS }]);
});

test('the other shapes models produce: tool_code, a named JSON envelope, the REST functionCall, a call opening a line of prose', () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ['```tool_code\nprint(default_api.set_thread_title(title="Agent Introduction"))\n```\n' + REX_ANSWER, { title: 'Agent Introduction' }],
    ['```json\n{"name": "set_thread_title", "arguments": {"title": "Agent Introduction"}}\n```\n' + REX_ANSWER, { title: 'Agent Introduction' }],
    ['```json\n{"tool": "set_thread_title", "arguments": "{\\"title\\": \\"Agent Introduction\\"}"}\n```\n' + REX_ANSWER, { title: 'Agent Introduction' }],
    ['```\n{"functionCall": {"name": "set_thread_title", "args": {"title": "Agent Introduction"}}}\n```\n' + REX_ANSWER, { title: 'Agent Introduction' }],
    ['```json\n{"tool": "set_thread_title", "title": "Agent Introduction"}\n```\n' + REX_ANSWER, { title: 'Agent Introduction' }],
    ['set_thread_title(title="Agent Introduction") ' + REX_ANSWER, { title: 'Agent Introduction' }],
    ['[set_thread_title](title="Agent Introduction")\n' + REX_ANSWER, { title: 'Agent Introduction' }],
    ['`set_thread_title("Agent Introduction")`\n' + REX_ANSWER, { title: 'Agent Introduction' }],
    ["set_thread_title(title='Rex\\'s room', description: \"Line one\")\n" + REX_ANSWER, { title: "Rex's room", description: 'Line one' }],
    ['set_thread_title({"title": "Agent Introduction"})\n\n' + REX_ANSWER, { title: 'Agent Introduction' }],
    ['```python\nset_thread_title(\n    title="Agent Introduction",\n)\n```\n' + REX_ANSWER, { title: 'Agent Introduction' }],
  ];
  for (const [text, args] of cases) {
    const r = parsePseudoToolCalls(text, OFFERED);
    assert.equal(r.text, REX_ANSWER, text);
    assert.deepEqual(r.calls, [{ name: 'set_thread_title', args }], text);
  }
});

test('bare JSON is somebody\'s answer unless a narrated call it fits sits right beside it', () => {
  const asked = '```json\n{\n  "title": "Agent Introduction"\n}\n```';
  for (const text of [
    asked, // alone
    `${asked}\nHere is the JSON you asked for.`, // beside prose
    `${asked}\n[create_task](title="x")\n`.replace('"title"', '"colour"'), // beside a call that does not take its keys
  ]) {
    const r = parsePseudoToolCalls(text, OFFERED);
    assert.ok(r.text.includes('```json'), `the fence went: ${text}`);
  }
  // prose ABOUT the tools stays whole: a call that opens a line only goes when a new sentence follows
  const prose = 'set_thread_title(title="x") and create_task(title="y") are the two tools.';
  assert.deepEqual(parsePseudoToolCalls(prose, OFFERED), { text: prose, calls: [], stripped: 0 });
});

test('a narrated call whose arguments do not parse is still dropped, and carries no arguments to run', () => {
  const r = parsePseudoToolCalls('set_thread_title(title=Agent Introduction)\n' + REX_ANSWER, OFFERED);
  assert.equal(r.text, REX_ANSWER);
  assert.deepEqual(r.calls, [{ name: 'set_thread_title', args: null }]);
});

test('only the thread title runs from narration', () => {
  assert.deepEqual([...RUN_NARRATED], ['set_thread_title']);
});

test('a narrated call runs only with arguments the tool\'s own schema accepts', () => {
  const schema = { title: z.string().min(1).max(60), description: z.string().max(200).optional() };
  assert.deepEqual(schemaArgs(schema, REX_ARGS), REX_ARGS);
  assert.deepEqual(schemaArgs(schema, { title: 'Plans', extra: 'dropped' }), { title: 'Plans' }, 'a key the tool does not take is left out');
  assert.equal(schemaArgs(schema, { description: 'no title' }), null);
  assert.equal(schemaArgs(schema, { title: 'x'.repeat(61) }), null);
  assert.equal(schemaArgs(schema, null), null);
});

test('the live bubble never types any piece of the narrated call, at any cut of the stream', () => {
  for (let n = 1; n <= REX.length; n++) {
    const shown = parsePseudoToolCalls(REX.slice(0, n), OFFERED, { streaming: true }).text;
    for (const piece of ['set_thread_title', '```json', '"title"', '[set_', 'description=']) {
      assert.ok(!shown.includes(piece), `at ${n} the bubble showed ${JSON.stringify(shown)}`);
    }
    assert.ok(REX_ANSWER.startsWith(shown), `at ${n} the bubble showed more than the answer: ${JSON.stringify(shown)}`);
  }
  assert.equal(parsePseudoToolCalls(REX, OFFERED, { streaming: true }).text, REX_ANSWER);
});

test('the bubble still types ordinary words and code at once', () => {
  assert.equal(parsePseudoToolCalls('You have two', OFFERED, { streaming: true }).text, 'You have two');
  assert.equal(parsePseudoToolCalls('```ts\nconst a = 1;', OFFERED, { streaming: true }).text, '```ts\nconst a = 1;');
});

// rex's first reply in a new session on the Cloud Run sandbox, verbatim shape (2026-10-30): the title
// as a bare ```json fence of set_thread_title's arguments with no call beside it, then the answer,
// then the follow-ups as a ```json list instead of an ```nms fence
const R6 = '```json\n{"title": "Kiwi reply", "description": "Reply with kiwi keyword"}\n```\n\nHere is your kiwi-mvveqytw response.\n\n```json\n[\n  "What else should I do?",\n  "Check task status"\n]\n```';
const TITLED = [{ name: 'set_thread_title', params: ['title', 'description'] }, { name: 'create_task', params: ['title', 'description', 'channel'] }];

test('a leading bare-arguments fence of set_thread_title runs as the narrated title, and leaves the room', () => {
  const r = parsePseudoToolCalls(R6, TITLED);
  assert.deepEqual(r.calls, [{ name: 'set_thread_title', args: { title: 'Kiwi reply', description: 'Reply with kiwi keyword' } }]);
  assert.ok(!r.text.includes('Kiwi reply'), r.text);
  assert.ok(r.text.startsWith('Here is your kiwi-mvveqytw response.'), r.text);
});

test('the exception stays narrow: not as the whole answer, not mid-reply, not for a tool that must not run from text', () => {
  const alone = '```json\n{"title": "A plan", "description": "the JSON the person asked for"}\n```';
  assert.equal(parsePseudoToolCalls(alone, TITLED).text, alone);
  const middle = 'Here is the record you asked for:\n\n```json\n{"title": "A plan"}\n```\n\nAnything else?';
  assert.equal(parsePseudoToolCalls(middle, TITLED).text, middle);
  const titleOnly = '```json\n{"title": "A plan"}\n```\n\nHere is the JSON you asked for.';
  assert.equal(parsePseudoToolCalls(titleOnly, TITLED).text, titleOnly, 'a lone title is an answer');
  const other = '```json\n{"title": "x", "channel": "general"}\n```\n\nDone.';
  assert.equal(parsePseudoToolCalls(other, TITLED).text, other, 'create_task keys never run from text');
});

test('follow-ups written as a trailing ```json list become the ```nms pills', () => {
  const clean = relabelPillFence(parsePseudoToolCalls(R6, TITLED).text);
  assert.ok(clean.endsWith('```nms\n["What else should I do?","Check task status"]\n```'), clean);
  assert.ok(clean.startsWith('Here is your kiwi-mvveqytw response.'), clean);
});

test('a list that is the answer, a long list, or a reply that already has pills stays as written', () => {
  for (const t of [
    '```json\n["a list", "the person asked for"]\n```',
    'The five:\n```json\n["one", "two", "three", "four", "five"]\n```',
    'Done.\n```json\n[1, 2]\n```',
    'Done.\n```nms\n["Next?", "Later?"]\n```\n```json\n["x1", "y1"]\n```',
    'Done.\n```ts\n["a1", "b1"]\n```',
  ]) assert.equal(relabelPillFence(t), t, t);
});

// rex's replies on the Cloud Run sandbox, verbatim shape (2026-11-02): the call written out as JSON, nothing else
const TOOLSET = [
  { name: 'create_task', params: ['title', 'description', 'kind', 'plan', 'offerTo'] },
  { name: 'create_whiteboard', params: ['title', 'mermaid', 'threadId'] },
  { name: 'set_thread_title', params: ['title', 'description'] },
];
test('a reply that is only a tool\'s arguments names the tool the model meant', () => {
  const task = '```json\n{\n  "title": "R6 agent task",\n  "description": "made by rex",\n  "kind": "chore",\n  "legs": ["build"],\n  "approach": "Create it."\n}\n```';
  assert.equal(argumentsOnlyReply(task, TOOLSET), 'create_task');
  const board = '```json\n{\n  "title": "R6 agent board",\n  "mermaid": "flowchart LR\\nplan --> build --> ship"\n}\n```';
  assert.equal(argumentsOnlyReply(board, TOOLSET), 'create_whiteboard');
});
test('words around the fence, one shared key, or a list make it an answer', () => {
  assert.equal(argumentsOnlyReply('Here it is:\n```json\n{"title": "a", "mermaid": "b"}\n```', TOOLSET), null);
  assert.equal(argumentsOnlyReply('```json\n{"title": "a", "colour": "b"}\n```', TOOLSET), null);
  assert.equal(argumentsOnlyReply('```json\n["title", "mermaid"]\n```', TOOLSET), null);
  assert.equal(argumentsOnlyReply('No JSON here.', TOOLSET), null);
});
