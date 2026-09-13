// The activity log's attribution contract (docs/29 §4c). Run: pnpm exec tsx --test src/main/agentlog.test.ts
//
// These tests exist because the SURFACE was verified against a fixture and the PRODUCER was not.
// The run card's leg unfold reads `agentLogs({ runId })`, and every one of those rows is written by
// `alog(agent, task, slug, runId)` — a logger the daemon builds per turn. Until this file, nothing
// asserted that a subagent's logger produces rows a caller can actually separate from its parent's,
// which is the entire premise of "view subagent activity".
//
// The bug being pinned shut: `orchSpawnFor` and `startDeepWork` passed every leg the PARENT's
// logger, so five subagents wrote under one agent_id and one run_id. The UI could not have
// attributed them because the data never carried the attribution.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentLog } from './agentlog';
import { toolHeadline, toolOutcome } from '../renderer/src/activity';

const REX = { agentId: 'a-rex', agentName: 'rex' };
const IRIS = { agentId: 'a-iris', agentName: 'iris' };

function fixture(): { log: AgentLog; dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'nm-alog-'));
  const log = new AgentLog(dir);
  return { log, dir, cleanup: () => { log.close(); rmSync(dir, { recursive: true, force: true }); } };
}

/** exactly what `alog(agent, null, slug, runId)` builds in agents.ts */
const loggerFor = (log: AgentLog, who: typeof REX, runId: string) =>
  log.for({ agentId: who.agentId, agentName: who.agentName, runId, taskId: null, taskNumber: null, channelSlug: 'marketing' });

test('a leg writes under its OWN run id, and reads back alone', () => {
  const f = fixture();
  try {
    // the shape orchSpawnFor produces: a parent turn, and a leg on its own run
    const parent = loggerFor(f.log, REX, 'run-parent');
    const legA = loggerFor(f.log, REX, 'run-leg-a');
    const legB = loggerFor(f.log, REX, 'run-leg-b');

    parent({ kind: 'wake', phase: 'channel', summary: 'woke on: research flowe' });
    legA({ kind: 'tool', phase: 'call', summary: 'WebSearch flowe competitors', toolUseId: 'tu1' });
    legA({ kind: 'tool', phase: 'result', summary: '→ 9 results', toolUseId: 'tu1' });
    legB({ kind: 'tool', phase: 'call', summary: 'Read brand-guidelines.md', toolUseId: 'tu2' });

    // this is the exact call the unfold makes: nm.agentLogs({ runId })
    const a = f.log.query({ runId: 'run-leg-a' });
    const b = f.log.query({ runId: 'run-leg-b' });
    assert.deepEqual(a.map((r) => r.summary), ['WebSearch flowe competitors', '→ 9 results']);
    assert.deepEqual(b.map((r) => r.summary), ['Read brand-guidelines.md']);
    assert.equal(f.log.query({ runId: 'run-parent' }).length, 1, 'the parent keeps only its own');
  } finally { f.cleanup(); }
});

test('the pre-fix shape is genuinely indistinguishable — which is why this matters', () => {
  // the regression this guards: sharing ONE logger across legs. Asserted explicitly so the test
  // fails loudly if someone "simplifies" the leg loggers back into the parent's.
  const f = fixture();
  try {
    const shared = loggerFor(f.log, REX, 'run-parent');
    shared({ kind: 'tool', phase: 'call', summary: 'leg A: WebSearch' });
    shared({ kind: 'tool', phase: 'call', summary: 'leg B: WebSearch' });
    const rows = f.log.query({ runId: 'run-parent' });
    assert.equal(rows.length, 2);
    assert.equal(new Set(rows.map((r) => r.run_id)).size, 1, 'one run id for two legs — nothing can split them');
  } finally { f.cleanup(); }
});

test('each leg becomes its own entry in the run picker', () => {
  // AgentActivity's `focusRunId` preselects a leg from `agentRuns(agentId)`. That only works if
  // runs() — which GROUPS agent_logs by run_id — surfaces the leg as a run of its own.
  const f = fixture();
  try {
    loggerFor(f.log, REX, 'run-parent')({ kind: 'wake', phase: 'channel', summary: 'woke on: research flowe' });
    loggerFor(f.log, REX, 'run-leg-a')({ kind: 'tool', phase: 'call', summary: 'WebSearch competitors' });
    loggerFor(f.log, REX, 'run-leg-b')({ kind: 'tool', phase: 'call', summary: 'Read brand-guidelines.md' });

    const runs = f.log.runs(REX.agentId);
    assert.deepEqual(runs.map((r) => r.run_id).sort(), ['run-leg-a', 'run-leg-b', 'run-parent']);
    // the picker labels a run by its FIRST row, so a leg has to be self-describing
    const legA = runs.find((r) => r.run_id === 'run-leg-a')!;
    assert.equal(legA.trigger, 'WebSearch competitors');
    assert.equal(legA.rows, 1);
  } finally { f.cleanup(); }
});

test('a leg seated on another agent files under THAT seat', () => {
  // orchSpawnFor seats a leg by role (`seatForRole`) and logs with `alog(seated, …)`, so a designer
  // leg's steps belong to the designer — which is what lets the panel title itself correctly.
  const f = fixture();
  try {
    loggerFor(f.log, REX, 'run-parent')({ kind: 'wake', phase: 'channel', summary: 'woke' });
    loggerFor(f.log, IRIS, 'run-leg-design')({ kind: 'tool', phase: 'call', summary: 'Read tokens.css' });

    assert.deepEqual(f.log.runs(IRIS.agentId).map((r) => r.run_id), ['run-leg-design']);
    assert.deepEqual(f.log.runs(REX.agentId).map((r) => r.run_id), ['run-parent'], 'the parent does not absorb it');
    assert.equal(f.log.query({ runId: 'run-leg-design' })[0]!.agent_name, 'iris');
  } finally { f.cleanup(); }
});

test('a leg row carries the tool_use_id its call/result pairing needs', () => {
  // groupActivity pairs a call to its result by tool_use_id — without it the unfold shows a call
  // with no outcome glyph, or worse pairs across parallel calls
  const f = fixture();
  try {
    const leg = loggerFor(f.log, REX, 'run-leg-a');
    leg({ kind: 'tool', phase: 'call', summary: 'WebFetch x.com', toolUseId: 'tu-x' });
    leg({ kind: 'tool', phase: 'call', summary: 'WebFetch reddit.com', toolUseId: 'tu-r' });
    leg({ kind: 'tool', phase: 'result', summary: '→ rate limited', level: 'warn', toolUseId: 'tu-x' });
    leg({ kind: 'tool', phase: 'result', summary: '→ 4 posts', toolUseId: 'tu-r' });

    const rows = f.log.query({ runId: 'run-leg-a' });
    const byId = (id: string) => rows.filter((r) => r.tool_use_id === id);
    assert.equal(byId('tu-x').length, 2);
    assert.equal(byId('tu-x').find((r) => r.phase === 'result')!.level, 'warn', 'the ⚠ glyph has something to read');
    assert.equal(byId('tu-r').length, 2);
  } finally { f.cleanup(); }
});

// ── The producer → renderer seam ──────────────────────────────────────────────────────────────
// The leg unfold renders `toolHeadline(call.summary)` as verb + argument. Those summaries are
// produced by `toolSummary` in agents.ts, and NOTHING asserted the two agree — the UI was verified
// against a fixture I wrote to match my own assumption about the format. These are the literal
// shapes `toolSummary` emits, run through the parser the unfold actually uses.
test('every summary the daemon writes parses into the verb + argument the unfold shows', () => {
  const cases: Array<[string, string, string]> = [
    // [ what toolSummary emits,            verb the unfold shows,  argument it shows ]
    ['WebSearch flowe app churn complaints', 'Searched the web',    'flowe app churn complaints'],
    ['Read brand-guidelines.md',             'Read',                'brand-guidelines.md'],
    ['WebFetch reddit.com/r/productivity',   'Fetched',             'reddit.com/r/productivity'],
    ['Glob **/*.md',                         'Searched',            '**/*.md'],
    ['Grep [Ff]ocusTrap',                    'Searched',            '[Ff]ocusTrap'],
    ['Bash: ls -la && git log',              'Ran',                 'ls -la && git log'], // the colon form
    ['Write out/report.md (1200b)',          'Wrote',               'out/report.md (1200b)'],
  ];
  for (const [summary, verb, arg] of cases) {
    const h = toolHeadline(summary);
    assert.equal(h.verb, verb, `verb for ${summary}`);
    assert.equal(h.arg, arg, `arg for ${summary}`);
  }
});

test('a summary with no argument degrades to a readable row rather than an empty one', () => {
  // toolSummary returns a bare name when the input is not an object, and rewrites nm tools to
  // `nm.<tool>` — neither matches "verb space argument", so the unfold falls back to `ran <summary>`
  for (const bare of ['WebSearch', 'nm.list_repos', 'mcp__claude-design__list_projects']) {
    const h = toolHeadline(bare);
    assert.equal(h.verb, '', `${bare} has no parseable verb`);
    assert.equal(h.arg, bare, 'so the whole summary becomes the argument, and the row still reads');
  }
});

test('the outcome glyph reflects what drainQuery actually records', () => {
  // drainQuery writes `level: b.is_error ? 'warn' : 'info'` on a tool result — these are the only
  // two it can produce, plus the absent-result case while a call is still in flight
  assert.deepEqual(toolOutcome({ level: 'info' }), { glyph: '✓', cls: 'o-ok' });
  assert.deepEqual(toolOutcome({ level: 'warn' }), { glyph: '⚠', cls: 'o-warn' });
  assert.equal(toolOutcome(null), null, 'an in-flight call shows no glyph, not a false ✓');
});
