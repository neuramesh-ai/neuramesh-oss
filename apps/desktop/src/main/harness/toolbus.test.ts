// The tool bus (docs/harness/03). Run: pnpm exec tsx --test src/main/harness/toolbus.test.ts
//
// The test that matters most is "parity": the SAME toolset for a turn kind regardless of runtime.
// That is the invariant whose absence made record_lesson / add_backlog_item / declare_beats
// Claude-only, and it is the one a future refactor is most likely to break silently.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { TURN_KINDS, toolsForKind, toolAvailable, sliceBudget, TURN_BUDGETS, BUDGET_FLOOR, capabilitiesFor, AgentMessageSchema } from '@neuramesh/shared';
import { allToolDefs, toolsForTurn, invokeTool, bridgeToolsForTurn, outputToText, type ToolHost } from './toolbus';
import { jsonSchemaFor } from './toolschema';

// A host that can service everything, with call recording.
function fullHost(): ToolHost & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    dir: '/tmp/nm-test',
    skills: [{ name: 'ship-a-pr', description: 'how we ship', body: '1. branch 2. push' }],
    proposeSkill: async (i) => { calls.push(`propose:${i.name}:${i.scope}`); return { ok: true }; },
    recordLesson: async (i) => { calls.push(`lesson:${i.lesson}`); return { ok: true }; },
    addBacklogItem: async (i) => { calls.push(`backlog:${i.title}:${i.parent ? 'sub' : 'park'}`); return { ok: true, number: 42 }; },
    beats: { declare: (s) => { calls.push(`declare:${s.length}`); return `declared ${s.length}`; }, complete: (n, b) => { calls.push(`advance:${n}:${b}`); return `step ${n}`; } },
    screenshot: async (i) => { calls.push(`shot:${i.file ?? i.url}`); return { png: Buffer.from('PNG-BYTES'), outName: 'out.png' }; },
    spawn: async (i) => { calls.push(`spawn:${i.role}:${i.label}`); return { ok: true, summary: `${i.label} did the thing` }; },
    park: async (i) => { calls.push(`park:${i.until}:${i.prNumber ?? i.afterMinutes}`); return { ok: true }; },
  };
}

test('every catalogued tool has a definition, and none is duplicated', () => {
  const defs = allToolDefs();
  const names = defs.map((d) => d.name);
  assert.equal(new Set(names).size, names.length, 'duplicate definition');
  // the module-load assertion in toolbus.ts covers missing names; this pins the count so a tool
  // added to the catalogue without a test being considered shows up here
  // 15 = the original ten + the four whiteboard tools (docs/38) + search_x on legs (marketing-os)
  assert.equal(defs.length, 16);
});

test('whiteboard tools (docs/38): availability, serviceability, and the write guards', async () => {
  const calls: string[] = [];
  const whiteboards = {
    list: async (i: { all?: boolean }) => { calls.push(`list:${!!i.all}`); return { ok: true, lines: '- "wake pipeline" · id wb-1 · rev 2' }; },
    read: async (i: { id: string }) => { calls.push(`read:${i.id}`); return { ok: true, text: '# wake pipeline' }; },
    create: async (i: { title: string; mermaid?: string; elements?: string }) => { calls.push(`create:${i.title}`); return { ok: true, id: 'wb-9' }; },
    update: async (i: { id: string; baseRev: number }) => { calls.push(`update:${i.id}@${i.baseRev}`); return { ok: true, rev: i.baseRev + 1 }; },
  };
  const host = { dir: '/tmp', whiteboards };
  // a chat turn draws — and so does a triage turn, since 2026-08-08: rex asked for a diagram has
  // nobody to route it to, and without the tool it proposed a markdown file with a mermaid fence
  assert.ok(toolsForTurn('chat', host).some((d) => d.name === 'create_whiteboard'));
  assert.ok(toolsForTurn('triage', host).some((d) => d.name === 'create_whiteboard'));
  assert.ok(toolsForTurn('triage', host).some((d) => d.name === 'read_whiteboard'));
  // a leg still cannot: a subagent's diagram is its parent's to file (same stance as add_subtask)
  assert.ok(!toolsForTurn('leg', host).some((d) => d.name === 'create_whiteboard'));
  // no closures → not advertised (a tool that always answers "unavailable" teaches distrust)
  assert.ok(!toolsForTurn('work', { dir: '/tmp' }).some((d) => d.name === 'create_whiteboard'));
  // exactly one source: none or both is a refusal the model can correct, not a throw
  const both = await invokeTool('work', host, 'create_whiteboard', { title: 'x', mermaid: 'flowchart', elements: '[]' });
  assert.match(outputToText(both.output), /exactly one/);
  const none = await invokeTool('work', host, 'create_whiteboard', { title: 'x' });
  assert.match(outputToText(none.output), /exactly one/);
  const good = await invokeTool('work', host, 'create_whiteboard', { title: 'wake', mermaid: 'flowchart LR; a-->b' });
  assert.match(outputToText(good.output), /created \(id wb-9\)/);
  const upd = await invokeTool('work', host, 'update_whiteboard', { id: 'wb-1', baseRev: 2, mermaid: 'flowchart TD; x' });
  assert.match(outputToText(upd.output), /rev 3/);
  assert.deepEqual(calls, ['create:wake', 'update:wb-1@2']);
});

test('PARITY — a turn kind resolves the same toolset no matter which runtime runs it', () => {
  // The runtime is not an input to resolution, by construction: there is no runtime parameter to
  // pass. This test states the invariant so a future signature change that reintroduces one fails.
  const host = fullHost();
  for (const kind of TURN_KINDS) {
    const viaBus = toolsForTurn(kind, host).map((d) => d.name).sort();
    const viaBridge = bridgeToolsForTurn(kind, host).map((t) => t.name).sort();
    assert.deepEqual(viaBridge, viaBus, `${kind}: the CLI bridge must advertise exactly the in-process toolset`);
  }
});

test('a work turn gets the tools that were Claude-only before the bus', () => {
  const names = toolsForTurn('work', fullHost()).map((d) => d.name);
  for (const t of ['record_lesson', 'add_backlog_item', 'declare_beats', 'advance_beat', 'screenshot'] as const) {
    assert.ok(names.includes(t), `a worker must have ${t} on every runtime`);
  }
});

test('a subagent (leg) may not create board rows, and a design turn may not park backlog items', () => {
  const host = fullHost();
  const leg = toolsForTurn('leg', host).map((d) => d.name);
  assert.ok(!leg.includes('add_subtask'), 'a subtask is a board row — the parent owns it (docs/harness/04)');
  assert.ok(!leg.includes('add_backlog_item'), 'a leg parks nothing; its findings go to its parent');
  assert.ok(leg.includes('record_lesson'), 'but a leg may still teach the channel a lesson');

  const design = toolsForKind('design');
  assert.ok(!design.includes('add_backlog_item'), 'a design round proposes; it does not file board rows');
  assert.ok(!design.includes('add_subtask'));
});

test('a chat turn has no screenshot and no beats — it is a conversation, not a phase', () => {
  assert.ok(!toolAvailable('screenshot', 'chat'));
  assert.ok(!toolAvailable('declare_beats', 'chat'));
  assert.ok(toolAvailable('add_backlog_item', 'chat'), 'but a chat may still park a discovery');
});

test('a tool the host cannot service is NOT advertised', async () => {
  // A tool that exists and always answers "unavailable here" teaches the model to distrust its
  // toolset — so absence of a closure means absence of the tool.
  const bare: ToolHost = { dir: '/tmp/nm-test' };
  const names = toolsForTurn('work', bare).map((d) => d.name);
  assert.deepEqual(names, [], 'a host with no closures advertises nothing');
  const r = await invokeTool('work', bare, 'record_lesson', { lesson: 'this should not run at all' });
  assert.equal(r.rejected, 'unavailable');
});

test('an unavailable tool is a HARD error, never a silent no-op', async () => {
  const host = fullHost();
  const r = await invokeTool('design', host, 'add_subtask', { title: 'nope' });
  assert.equal(r.rejected, 'unavailable');
  assert.match(outputToText(r.output), /no such tool/);
  assert.deepEqual(host.calls, [], 'the underlying closure must never fire');
});

test('invalid input is returned to the model with the reason, not thrown', async () => {
  const host = fullHost();
  const r = await invokeTool('work', host, 'record_lesson', { lesson: 'too short' }); // min(12)
  assert.equal(r.rejected, 'invalid');
  assert.match(outputToText(r.output), /invalid input for record_lesson/);
  assert.deepEqual(host.calls, []);
});

test('a valid call reaches its closure and reports the outcome', async () => {
  const host = fullHost();
  const r = await invokeTool('work', host, 'add_backlog_item', { title: 'drop the dead flag' });
  assert.equal(r.rejected, undefined);
  assert.match(outputToText(r.output), /#42/);
  assert.deepEqual(host.calls, ['backlog:drop the dead flag:park']);
});

test('add_subtask and add_backlog_item share a closure but differ by parent', async () => {
  const host = fullHost();
  await invokeTool('work', host, 'add_subtask', { title: 'cross-check the numbers' });
  assert.deepEqual(host.calls, ['backlog:cross-check the numbers:sub']);
});

test('a throwing tool fails the CALL, not the turn', async () => {
  const host = fullHost();
  host.recordLesson = async () => { throw new Error('server exploded'); };
  const r = await invokeTool('work', host, 'record_lesson', { lesson: 'a lesson long enough to pass' });
  assert.equal(r.rejected, undefined);
  assert.match(outputToText(r.output), /record_lesson failed: server exploded/);
});

test('screenshot returns an image on the rich path and degrades to its note on the bridge', async () => {
  const host = fullHost();
  const r = await invokeTool('work', host, 'screenshot', { file: 'mock.html' });
  assert.equal(r.output.kind, 'image');
  assert.equal(outputToText(r.output), 'captured out.png', 'the bridge carries the note, never a broken image block');
});

// ── JSON Schema advertisement ────────────────────────────────────────────────────────────────
test('jsonSchemaFor expresses every shape the catalogue actually uses', () => {
  for (const d of allToolDefs()) {
    const s = jsonSchemaFor(d.params); // throws on an unsupported type
    assert.equal(s.type, 'object');
    assert.ok(Object.keys(s.properties).length > 0, `${d.name} advertises no params`);
  }
});

test('jsonSchemaFor marks optionals correctly and carries descriptions', () => {
  const s = jsonSchemaFor({
    a: z.string().describe('required one'),
    b: z.number().optional().describe('optional one'),
    c: z.enum(['x', 'y']).optional(),
    d: z.array(z.string()),
    e: z.boolean().optional(),
  });
  assert.deepEqual(s.required, ['a', 'd']);
  assert.deepEqual(s.properties['a'], { type: 'string', description: 'required one' });
  assert.deepEqual(s.properties['b'], { type: 'number', description: 'optional one' });
  assert.deepEqual(s.properties['c'], { type: 'string', enum: ['x', 'y'] });
  assert.deepEqual(s.properties['d'], { type: 'array', items: { type: 'string' } });
  assert.deepEqual(s.properties['e'], { type: 'boolean' });
});

// The codex approval key rides the ONE builder both spawn sites call — losing it starves a
// codex worker of its entire nm bus, silently ("user cancelled MCP tool call", found live).
test('the codex nm server entry always pre-approves its own tools', async () => {
  const { codexNmServer } = await import('../runtime/orchmcp');
  const entry = codexNmServer('node', '/tmp/shim.mjs', { NM_ORCH_URL: 'u', NM_ORCH_TURN: 't', NM_ORCH_SECRET: 's' });
  assert.equal(entry['default_tools_approval_mode'], 'approve');
  assert.deepEqual(entry['args'], ['/tmp/shim.mjs']);
});

// Found live 2026-08-26: a codex-seated worker's draft_replies call was rejected at validation
// because codex sends structured arguments as JSON STRINGS. The model was told "the MCP call was
// cancelled by the tool layer" and wrote its replies into a markdown report instead.
test('a stringified array argument is normalized, not rejected (the codex bus shape)', async () => {
  let got: unknown = null;
  const host = { draftReplies: async (i: unknown) => { got = i; return 'ok'; } } as never;
  const row = { target: { platform: 'x', source: 'connector', handle: 'a', url: 'https://x.com/a/status/1', text: 't' }, draft: 'd' };
  const out = await invokeTool('work', host, 'draft_replies', { replies: JSON.stringify([row]) });
  assert.equal(out.rejected, undefined);
  assert.equal((got as { replies: unknown[] }).replies.length, 1);
});

test('a genuine string argument is left exactly as sent', async () => {
  // the normalization must not touch a field the schema actually wants as a string
  let got: unknown = null;
  const host = { searchX: async (i: unknown) => { got = i; return 'hits'; } } as never;
  await invokeTool('leg', host, 'search_x', { query: '["not","an","array"]' });
  assert.equal((got as { query: string }).query, '["not","an","array"]');
});

test('jsonSchemaFor renders a NESTED object (reply-radar: a target inside each reply row)', () => {
  const out = jsonSchemaFor({ row: z.object({ target: z.object({ url: z.string(), age: z.string().optional() }) }) });
  assert.deepEqual((out.properties['row'] as { properties: Record<string, unknown> }).properties['target'], {
    type: 'object', properties: { url: { type: 'string' }, age: { type: 'string' } }, required: ['url'],
  });
});

test('jsonSchemaFor still throws loudly on a type it cannot express', () => {
  assert.throws(() => jsonSchemaFor({ bad: z.map(z.string(), z.string()) }), /cannot express/);
});

// ── Capabilities: the honest statement of what can be gated ──────────────────────────────────
test('only claude-code can gate its NATIVE tools per call', () => {
  // Verified against the vendor SDKs 2026-07-31: codex exposes approvalPolicy as a policy STRING
  // with no approval event to answer, and agy's argv must stay exactly `--print <prompt>`.
  assert.equal(capabilitiesFor('claude-code').gatesNativeTools, true);
  assert.equal(capabilitiesFor('codex').gatesNativeTools, false);
  assert.equal(capabilitiesFor('gemini').gatesNativeTools, false);
  // …but bus tools reach every runtime, which is what the parity test above proves.
  assert.equal(capabilitiesFor('codex').toolTransport, 'mcp-loopback');
  assert.equal(capabilitiesFor('claude-code').toolTransport, 'in-process');
});

test('an unknown runtime falls back to the reasoning default rather than crashing a turn', () => {
  assert.deepEqual(capabilitiesFor('not-a-runtime'), capabilitiesFor('claude-code'));
});

// ── Budgets: the recursion terminator ────────────────────────────────────────────────────────
test('a subtree cannot exceed its root — slicing halves and eventually refuses', () => {
  let b = sliceBudget(TURN_BUDGETS.work);
  const seen: number[] = [];
  let depth = 0;
  while (b && depth < 50) { seen.push(b.wallMs); b = sliceBudget(b); depth += 1; }
  assert.ok(depth > 0 && depth < 50, 'slicing must terminate, and not immediately');
  assert.equal(b, null, 'the last slice refuses rather than returning a token budget');
  for (let i = 1; i < seen.length; i += 1) assert.ok(seen[i]! < seen[i - 1]!, 'each level is strictly smaller');
});

test('a budget at the floor refuses to fund a child', () => {
  assert.equal(sliceBudget(BUDGET_FLOOR), null);
  assert.equal(sliceBudget({ wallMs: 60_000, contextTokens: 1_000 }), null, 'either dimension can refuse');
});

test('every turn kind has a budget', () => {
  for (const k of TURN_KINDS) {
    assert.ok(TURN_BUDGETS[k].wallMs > 0 && TURN_BUDGETS[k].contextTokens > 0, `${k} has no budget`);
  }
  assert.ok(TURN_BUDGETS.triage.wallMs < TURN_BUDGETS.work.wallMs, 'triage is a routing budget, deliberately tight');
});

// ── The message envelope ─────────────────────────────────────────────────────────────────────
const envelope = (over: Record<string, unknown> = {}) => ({
  id: '01J0', v: 1 as const,
  from: { kind: 'subagent' as const, id: 'leg-1', turnId: 't1' },
  to: { kind: 'parent' as const },
  kind: 'result' as const,
  subject: { workspaceId: 'w', channelId: 'c', taskId: 't' },
  body: { text: 'three rounds drafted', data: { rounds: 3 } },
  at: '2026-07-31T12:00:00.000Z',
  ...over,
});

test('a valid result envelope parses', () => {
  assert.ok(AgentMessageSchema.safeParse(envelope()).success);
});

test('a human-visible envelope with no prose is rejected at validation, not at render', () => {
  const r = AgentMessageSchema.safeParse(envelope({ body: { data: { rounds: 3 } } }));
  assert.equal(r.success, false);
  assert.match(JSON.stringify(r.error?.issues), /requires body\.text/);
});

test('progress envelopes may be data-only — nothing renders them as prose', () => {
  assert.ok(AgentMessageSchema.safeParse(envelope({ kind: 'progress', body: { data: { step: 2 } } })).success);
});

test('an absolute file ref is rejected — a brain export must not carry a host path', () => {
  const bad = AgentMessageSchema.safeParse(envelope({ refs: [{ kind: 'file', path: '/home/someone/secret.md' }] }));
  assert.equal(bad.success, false);
  assert.ok(AgentMessageSchema.safeParse(envelope({ refs: [{ kind: 'file', path: 'workspace/report.md' }] })).success);
});

// ── Hooks (P5) ───────────────────────────────────────────────────────────────────────────────
test('a pre hook can DENY a call, and the closure never fires', async () => {
  const host = fullHost();
  const hooks = { pre: [async (c: { name: string }) => (c.name === 'record_lesson' ? { deny: 'lessons are frozen this sprint' } : undefined)] };
  const r = await invokeTool('work', host, 'record_lesson', { lesson: 'a lesson long enough to pass' }, hooks);
  assert.equal(r.rejected, 'denied');
  assert.match(outputToText(r.output), /lessons are frozen this sprint/);
  assert.deepEqual(host.calls, [], 'a denied call must not reach its effect');
});

test('a hook may DENY but never GRANT — it cannot resurrect an unavailable tool', async () => {
  // The rule that keeps hooks from becoming a privilege-escalation path around evaluatePolicy.
  const host = fullHost();
  const permissive = { pre: [async () => undefined] };
  const r = await invokeTool('design', host, 'add_subtask', { title: 'nope' }, permissive);
  assert.equal(r.rejected, 'unavailable', 'availability is decided before hooks and cannot be widened by one');
  assert.deepEqual(host.calls, []);
});

test('a post hook observes the result without changing it', async () => {
  const host = fullHost();
  const seen: string[] = [];
  const hooks = { post: [async (c: { name: string; output: { kind: string } }) => { seen.push(`${c.name}:${c.output.kind}`); }] };
  const r = await invokeTool('work', host, 'add_backlog_item', { title: 'observed' }, hooks);
  assert.match(outputToText(r.output), /#42/, 'the output is untouched');
  assert.deepEqual(seen, ['add_backlog_item:text']);
});

test('a THROWING hook is neither a veto nor an outage', async () => {
  const host = fullHost();
  const broken = {
    pre: [async () => { throw new Error('lint binary missing'); }],
    post: [async () => { throw new Error('reporter died'); }],
  };
  const r = await invokeTool('work', host, 'add_backlog_item', { title: 'still works' }, broken);
  assert.equal(r.rejected, undefined, 'a broken hook must not block work');
  assert.deepEqual(host.calls, ['backlog:still works:park']);
});

test('hooks apply to the CLI bridge too — a runtime is not a way around them', async () => {
  const host = fullHost();
  const hooks = { pre: [async () => ({ deny: 'blocked everywhere' })] };
  const tools = bridgeToolsForTurn('work', host, hooks);
  const out = await tools.find((t) => t.name === 'record_lesson')!.run({ lesson: 'a lesson long enough to pass' });
  assert.match(out, /blocked everywhere/);
  assert.deepEqual(host.calls, []);
});

// ── spawn: the headline capability, now reachable (docs/harness/04) ───────────────────────────
test('spawn is available to every working kind INCLUDING a leg — depth is budget-bounded, not rule-bounded', () => {
  for (const kind of ['work', 'review', 'design', 'plan', 'triage', 'deep', 'leg'] as const) {
    assert.ok(toolAvailable('spawn', kind), `${kind} must be able to fan out`);
  }
  // a conversation answers; a chat that silently spawns a fleet is not a chat
  assert.ok(!toolAvailable('spawn', 'chat'));
});

test('PARITY — spawn reaches the CLI bridge, not just the in-process path', () => {
  const host = fullHost();
  assert.ok(bridgeToolsForTurn('work', host).map((t) => t.name).includes('spawn'),
    'a Codex/Gemini worker must be able to fan out too, or the drift is back');
});

test('a spawn returns the child result to the parent', async () => {
  const host = fullHost();
  const r = await invokeTool('work', host, 'spawn', { role: 'designer', prompt: 'draft direction B for the settings screen', label: 'direction B' });
  assert.equal(r.rejected, undefined);
  assert.match(outputToText(r.output), /subagent "direction B" \(designer\) finished/);
  assert.deepEqual(host.calls, ['spawn:designer:direction B']);
});

test('a REFUSED spawn returns the reason, so the model stops fanning out instead of retrying', async () => {
  // "budget exhausted" tells the model to do the work itself; a bare failure would have it retry the
  // same spawn until its wall expires.
  const host = fullHost();
  host.spawn = async () => ({ ok: false, error: 'not enough budget left to run a designer subagent' });
  const r = await invokeTool('work', host, 'spawn', { role: 'designer', prompt: 'draft another direction please' });
  assert.match(outputToText(r.output), /could not fan out .*not enough budget/);
});

test('an unknown role is rejected before any closure runs', async () => {
  const host = fullHost();
  const r = await invokeTool('work', host, 'spawn', { role: 'ceo', prompt: 'do the whole thing for me please' });
  assert.equal(r.rejected, 'invalid');
  assert.deepEqual(host.calls, []);
});

test('a too-short prompt is rejected — a subagent needs an actionable brief', async () => {
  const host = fullHost();
  const r = await invokeTool('work', host, 'spawn', { role: 'developer', prompt: 'go' });
  assert.equal(r.rejected, 'invalid');
});

// ── park: the capability the worker prompt used to deny (docs/harness/05 §3.8) ─────────────────
test('park is available only to turns that own real work', () => {
  for (const k of ['work', 'review', 'ship', 'deep'] as const) assert.ok(toolAvailable('park', k), `${k} may park`);
  // a parked child holding its parent's turn open is a new failure shape (docs/harness/04 OQ2)
  assert.ok(!toolAvailable('park', 'leg'), 'a subagent may not park');
  assert.ok(!toolAvailable('park', 'chat'), 'a conversation answers; it does not wait');
  assert.ok(!toolAvailable('park', 'triage'));
});

test('park reaches every runtime, in-process and over the bridge', () => {
  const host = fullHost();
  assert.ok(toolsForTurn('work', host).map((d) => d.name).includes('park'));
  assert.ok(bridgeToolsForTurn('work', host).map((t) => t.name).includes('park'));
});

test('a CI park needs its PR, and a delay park needs its duration', async () => {
  const host = fullHost();
  const noPr = await invokeTool('work', host, 'park', { until: 'ci', note: 'waiting on the checks to land' });
  assert.match(outputToText(noPr.output), /needs the prNumber/);
  const noDelay = await invokeTool('work', host, 'park', { until: 'delay', note: 'waiting a little while' });
  assert.match(outputToText(noDelay.output), /needs afterMinutes/);
  assert.deepEqual(host.calls, [], 'neither reached the host');
});

test('a valid park tells the model to STOP — it cannot be interrupted mid-turn', async () => {
  const host = fullHost();
  const r = await invokeTool('work', host, 'park', { until: 'ci', prNumber: 231, note: 'CI is running on the PR I just pushed; I merge when it is green' });
  assert.equal(r.rejected, undefined);
  assert.match(outputToText(r.output), /END YOUR TURN NOW/);
  assert.deepEqual(host.calls, ['park:ci:231']);
});

test('a refused park tells the model to carry on rather than retry', async () => {
  const host = fullHost();
  host.park = async () => ({ ok: false, error: 'a leg turn cannot park' });
  const r = await invokeTool('work', host, 'park', { until: 'delay', afterMinutes: 5, note: 'just waiting a moment' });
  assert.match(outputToText(r.output), /carry on and finish what you can/);
});
