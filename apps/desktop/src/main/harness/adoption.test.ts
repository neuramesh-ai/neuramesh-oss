// P1 adoption guards (docs/harness/05 invariants E4/E5).
//
// These assert PROPERTIES OF THE SOURCE, not of a function — because the failure mode they prevent is
// a future edit quietly reintroducing what the adoption removed: a flow that starts without asking the
// queue, or a wall-clock literal at a call site. Both look harmless in a diff and both undo the work.
//
// Run: pnpm exec tsx --test src/main/harness/adoption.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TURN_BUDGETS, TURN_KINDS, toolAvailable } from '@neuramesh/shared';
import { hostSource, syncSource, toolDef, walkSources, workerToolNames } from '../srcscan';

const MAIN = join(import.meta.dirname, '..');
const HOST = hostSource(MAIN);
const lines = HOST.split('\n');

/** Source lines that are not comments — the only place a violation actually matters. */
const code = lines.filter((l) => {
  const t = l.trim();
  return t && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
});

test('E5 — no bare wall-clock literal bounds a model turn any more', () => {
  // `withTimeout(promise, <literal>, msg)` was the old idiom, eleven times over with no shared policy.
  // The budget table is now the single authority; a literal here means someone added a twelfth.
  const offenders = code.filter((l) => /withTimeout\(/.test(l) && /\d+\s*\*\s*60_000|[^_]\b\d{4,}\b\s*,/.test(l) && !l.includes('TURN_BUDGETS'));
  assert.deepEqual(offenders.map((l) => l.trim().slice(0, 90)), [], 'bound this turn with TURN_BUDGETS[kind].wallMs instead of a literal');
});

test('the budget table is actually the thing being used', () => {
  assert.ok(HOST.includes('TURN_BUDGETS'), 'the host must read the budget table');
  const refs = (HOST.match(/TURN_BUDGETS\.(\w+)/g) ?? []).map((m) => m.split('.')[1]!);
  assert.ok(refs.length >= 8, `expected the migrated call sites to reference budgets, saw ${refs.length}`);
  for (const kind of new Set(refs)) {
    assert.ok((TURN_KINDS as readonly string[]).includes(kind), `TURN_BUDGETS.${kind} is not a turn kind`);
    assert.ok(TURN_BUDGETS[kind as keyof typeof TURN_BUDGETS].wallMs > 0);
  }
});

test('E4 — every heavy flow is admitted by the queue, never started on sight', () => {
  // A flow that spawns a runtime CLI must go through admission or the ceiling is decorative. If a new
  // flow is added, it belongs in this list AND behind the queue.
  const queued = ['claimFlow', 'ownFlow', 'resumeFlow', 'remoteDelegate', 'reviewFlow', 'architectFlow', 'designerFlow', 'shipperFlow', 'curatorImport'];
  for (const flow of queued) {
    const direct = code.filter((l) => new RegExp(`void\\s+${flow}\\(`).test(l));
    assert.deepEqual(direct.map((l) => l.trim().slice(0, 80)), [], `${flow} is dispatched directly — wrap it in execQueue.run`);
    assert.ok(new RegExp(`=>\\s*${flow}\\(`).test(HOST), `${flow} should be invoked as a queued thunk`);
  }
});

test('every wake goes through the queue helper, at message priority', () => {
  const direct = code.filter((l) => /\bvoid wake\(/.test(l));
  assert.deepEqual(direct.map((l) => l.trim().slice(0, 80)), [], 'use queueWake() so a reply is admitted at priority 1');
  assert.ok(HOST.includes("cause: 'message'"), 'a wake must be offered as a message-cause trigger');
});

test('the queue and the durable guards are both constructed at host start', () => {
  assert.ok(/new HostQueue\(/.test(HOST), 'the host builds a queue');
  assert.ok(/durableStore\(/.test(HOST), 'the host builds the durable guard store');
  assert.ok(/new DurableSet<string>\(hostGuards, 'merged'\)/.test(HOST), 'merged is durable');
  assert.ok(/new DurableSet<number>\(hostGuards, 'reclaimed'\)/.test(HOST), 'reclaimed is durable');
});

test('`claimed` stays EPHEMERAL — the crash-recovery property, guarded', () => {
  // The resume watch picks up work whose host died mid-execution by testing `claimed`. If someone makes
  // it durable, every such task is stranded permanently. This test is the tripwire for that mistake.
  //
  // The guards now live in host/guards.ts as a registry, so this reads the FIELD rather than a
  // local declaration — same invariant, stated where the durability choice is now made.
  assert.match(HOST, /claimedIds: Set<string>;/, 'claimedIds must be declared as a plain in-memory Set');
  assert.match(HOST, /claimedIds: new Set<string>\(\)/, '…and built as one');
  // \b so this does not match `reclaimed`, which IS meant to be durable
  assert.ok(!/\bclaimed\w*: DurableSet/.test(HOST), 'claimed must NEVER be durable (docs/harness/05 §2.1 correction)');
  assert.ok(!/\bclaimed\w* = new DurableSet/.test(HOST), 'claimed must NEVER be durable, however it is built');
});

test('a failed merge RELEASES its durable guard — durability records success, not attempts', () => {
  // Without this, a transient merge failure becomes permanent: the guard says "handled" forever while
  // the PR sits unmerged behind a "merge it yourself" message.
  // `merged` is built in the guard registry now, so the old slice anchor (its declaration) is
  // gone. Count the releases against the merge watch itself, which is where the failure paths are.
  const watch = HOST.slice(HOST.indexOf('merged.add('), HOST.indexOf('async function reviewFlow'));
  assert.ok(watch.length > 200, 'could not find the merge watch');
  const releases = (watch.match(/merged\.delete\(/g) ?? []).length;
  assert.ok(releases >= 2, `both merge failure paths must release the guard, found ${releases}`);
  assert.match(HOST, /merged: new DurableSet<string>\(hostGuards, 'merged'\)/, 'and it stays durable');
});

// ── The orchestrator's fan-out (the gap that made triage routing-only) ────────────────────────
test('the ORCHESTRATOR can spawn — its registry is separate from the bus, so it needs its own wiring', () => {
  // TOOL_KINDS.spawn has always listed 'triage'. But buildOrchestratorTools is a registry entirely
  // separate from the tool bus, so the capability the catalogue granted was never delivered: the
  // orchestrator could route work and run start_deep_work, and could not fan out at all. No prompt
  // could reach it. This test exists because the catalogue and the wiring disagreed silently once.
  assert.ok(toolAvailable('spawn', 'triage'), 'the catalogue grants triage a fan-out');
  // The registry is a SET of modules now (host/orchtools.ts + host/tools-*.ts), so this reads the
  // set — the srcscan rule for a slice whose anchors stopped sharing a file.
  const reg = walkSources(join(MAIN, 'host'))
    .filter((f) => /orchtools\.ts$|tools-\w+\.ts$/.test(f))
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n');
  assert.match(reg, /async function buildOrchestratorTools/, 'the registry entry lives in host/orchtools.ts');
  assert.match(reg, /export function boardTools/, 'and its groups in host/tools-*.ts');
  assert.match(reg, /name: 'spawn'/, 'and the orchestrator registry must actually contain it');
  assert.match(reg, /spawn: spawnLeg/, 'fed from a closure the caller owns');
});

test('the orchestrator spawn closure is actually PASSED at the wake call site', () => {
  // Registering the tool is half the job; a registry entry with no closure is an absent tool that
  // merely looks present — which is the same failure one layer down.
  assert.match(HOST, /spawn: orchSpawnFor\(/, 'the wake turn builds the closure');
  // the trailing onDelta closure is the live-bubble feed (2026-08-06 — before it, an
  // orchestrator's reply never streamed and popped in whole)
  assert.match(HOST, /orchestratorTurn\(agent, ch, transcript, token, undefined, olog, skills, att\.list, m\.thread_id \?\? null, wakeRun, \(t\) => emitChat\(t, false\)\)/,
    'and passes its run + the stream feed, so legs parent onto it and tokens reach the bubble');
});

test('a fan-out draws on the budget of the TURN, not of the role', () => {
  // A routing turn that could spend a worker's budget on subagents would starve the loop it exists
  // to move; the tighter budget is the point of the kind. `own` is the other half of the same rule —
  // an owning turn funds real work, so the fan-out has to read its budget from the kind rather than
  // from a constant (which is what it did while `triage` was the only orchestrator turn there was).
  assert.ok(TURN_BUDGETS.triage.wallMs < TURN_BUDGETS.work.wallMs);
  assert.ok(TURN_BUDGETS.own.wallMs > TURN_BUDGETS.triage.wallMs, 'owning funds more than routing');
  assert.match(HOST, /let remaining = \{ \.\.\.TURN_BUDGETS\[kind\] \}/, 'orchSpawnFor slices from the turn kind');
  assert.match(HOST, /orchSpawnFor\([^)]*thread \? 'own' : 'triage'\)/, 'and the caller passes which kind this turn is');
});

test('the orchestrator prompt now tells it WHEN to fan out, not just that it can', () => {
  // A tool nothing mentions is a tool nothing calls — the second half of the same gap.
  // 2026-08-18 (the diet, one home per rule): the WHEN — the spawn-vs-deep-work-vs-create ladder —
  // lives in the CONTRACT's triage procedure (asserted below); the tool description keeps the
  // MECHANICS. What must survive here: the description still sells the capability (full working
  // tools, parallel fan-out) and the ownership boundary.
  const reg = toolDef(MAIN, 'spawn');
  assert.match(reg, /FULL working tools/i, 'names what a subagent can actually do');
  assert.match(reg, /in parallel/i, 'names the fan-out');
  assert.match(reg, /cannot create, offer or route board work/i, 'names the ownership boundary');
});

test('the orchestrator prompt carries a TRIAGE PROCEDURE, not just a tool list', () => {
  // The gap was two-layered. Wiring `spawn` into the registry made it reachable; it did NOT make the
  // orchestrator consider it, because the prompt's triage covered routing only — designer-first,
  // architect for plans, developer for scoped work — and never named answering vs fanning out vs
  // researching as a decision. A tool that no procedure reaches for is a tool nobody calls.
  // The prompt moved out of agents.ts and into defaults/agents/orchestrator.yaml (the contract is
  // the deliverable, 2026-08-06). The assertion is unchanged in intent — the procedure must exist
  // and be reachable — so it now reads the contract, which is where behaviour is stated.
  const CONTRACT = readFileSync(join(import.meta.dirname, '..', '..', '..', '..', '..', 'defaults', 'agents', 'orchestrator.yaml'), 'utf8');
  // 2026-08-18 (the diet): the ladder anchors on "TRIAGE every request" in the rewritten powers
  // block — same four ordered routes, one statement each, decomposition first.
  const anchor = CONTRACT.indexOf('TRIAGE every request');
  assert.ok(anchor > 0, 'the triage procedure must actually be in the contract');
  const orch = CONTRACT.slice(anchor, anchor + 3_400);
  // all four routes present and ORDERED, so the agent takes the first that fits
  assert.match(orch, /1\. \*\*You can answer it now/);
  assert.match(orch, /2\. \*\*Understanding it splits into independent pieces/);
  assert.match(orch, /3\. \*\*It needs web research that outlives this reply/);
  assert.match(orch, /4\. \*\*It genuinely belongs on the board\*\* → create_task/);
  // the posture line sits ABOVE the numbered list, so it is asserted against the whole contract
  assert.match(CONTRACT, /THE DEFAULT IS TO SOLVE IT HERE/, 'the default posture must lead the triage');
  // decomposition first — a request's PARTS are what get routed, not the message
  assert.match(orch, /decomposing it first/);
  // and the judgment names both costs — spawning spends budget, serial work costs more
  assert.match(orch, /Spawning spends your budget/);
  assert.match(orch, /costs more/);
});

// ── Migrated paths must have NO consumers left on the old spelling ────────────────────────────
test('nothing writes the pre-migration working directories any more', () => {
  // The migration moved worktrees/repos/design/plan into cache/ but left eight call sites spelling
  // the OLD path, so the app recreated `~/.neuramesh/worktrees` beside the migrated
  // `~/.neuramesh/cache/worktrees`, orphaned every existing clone and re-cloned from scratch — which
  // surfaced as "worktree is not on this machine" in the terminal while the work sat one dir over.
  // Second time this class bit (the first was the sign-out wipe), hence a test rather than care.
  const SYNC = syncSource(MAIN);
  for (const [file, src] of [['agents.ts(+host/)', HOST], ['sync.ts(+sync/)', SYNC]] as const) {
    for (const dir of ['worktrees', 'repos', 'design', 'plan']) {
      const stale = src.split('\n').filter((l) =>
        new RegExp(`'\\.neuramesh',\\s*'${dir}'`).test(l) && !l.trim().startsWith('//'));
      assert.deepEqual(stale.map((l) => l.trim().slice(0, 78)), [],
        `${file} still builds a pre-migration ${dir}/ path — use cachePath('${dir}')`);
    }
  }
});

// The v0.73.0 field bug: the guard above watched only `.neuramesh` + a cache subdir in two files, so
// four sites spelling the ROOT itself (`join(home, '.neuramesh', …)`, `join(homedir(), '.neuramesh')`)
// slipped through. They bypassed brainRoot(), so every profile — the installed app and a dev build —
// resolved to ONE state/replica.db. PowerSync keeps its checkpoint (ps_buckets) and outbound queue
// (ps_crud) in that file, so the two clients re-synced each other every few minutes. The root is a
// single decision; only brain.ts is allowed to spell it.
test('only brain.ts spells the root — everything else goes through brainRoot()', () => {
  // recursive since the split: host/ and sync/ modules are exactly where a stray
  // hardcoded root would land next
  const offenders: string[] = [];
  for (const f of walkSources(MAIN).filter((f) => !f.endsWith('harness/brain.ts'))) {
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      const code = line.trim();
      if (code.startsWith('//') || code.startsWith('*')) continue;
      if (/['"]\.neuramesh['"]/.test(code)) offenders.push(`${f.slice(MAIN.length + 1)}: ${code.slice(0, 66)}`);
    }
  }
  assert.deepEqual(offenders, [], 'a hardcoded root ignores NM_USERDATA and collapses profiles onto one replica');
});

test('the terminal opens the SAME directory the flow writes', () => {
  // A reader and a writer that disagree about where work lives is the bug above, restated.
  const SYNC = syncSource(MAIN);
  assert.match(SYNC, /cachePath\('worktrees'/, 'the terminal resolves worktrees through the helper');
  assert.match(SYNC, /deliverablePath\(/, '…and scratch deliverables through its own');
  assert.match(HOST, /cachePath\('worktrees'/, 'and so does the flow that creates them');
});

// ── A designer LEG draws the way the seated designer draws (docs/29 §4d) ─────────────────────
// Rex owns the whole flow and hires a designer into its design phase. If that leg ran the generic
// subagent prompt it would still produce something — plain HTML, no Claude Design project, no
// design system prompt — and the failure would look like "the designer did a worse job" rather
// than like a routing bug. These assert the wiring that keeps the two routes equivalent.

test('a designer leg gets the DESIGN turn, not the generic subagent one', () => {
  const spawn = readFileSync(join(MAIN, 'host', 'turncontext.ts'), 'utf8');
  assert.match(spawn, /function orchSpawnFor/, 'the fan-out closure lives in host/turncontext.ts');
  assert.match(spawn, /i\.role === 'designer'/, 'the spawn path branches on the designer role');
  assert.match(spawn, /designerOverride\(/, 'and routes it through the design override');
});

test('the override carries all three things that make a design turn a design turn', () => {
  const fn = HOST.slice(HOST.indexOf('async function designerOverride'), HOST.indexOf('async function taskOf'));
  assert.match(fn, /buildDesignPrompt\(/, 'the real brief, not a one-line instruction');
  assert.match(fn, /designSystemPrompt\(/, "the designer's own stance");
  // the load-bearing one: claudeDesign is the ONLY thing that puts mcp__claude-design__* in the
  // toolset, so without it "Claude Design mode" is a prompt asking for tools that are not there
  assert.match(fn, /claudeDesign: provider === 'claude-design'/, 'and the flag that unlocks the MCP tools');
  assert.match(fn, /designProviderFor\(/, "the provider follows the human's choice, as the seated flow does");
});

test('the Claude Design project URL is announced by the OWNER', () => {
  // A leg has no board identity to post with (docs/harness/04 I2), and the URL arrives in a TOOL
  // RESULT before the model's summary — so it is watched during the run and posted by rex, or the
  // human never gets the link to the project they are meant to edit in.
  const spawn = readFileSync(join(MAIN, 'host', 'turncontext.ts'), 'utf8');
  assert.match(spawn, /claudeDesignProjectWatch\(\)/, 'the run watches for the project link');
  assert.match(spawn, /Open the editable project/, 'and the owner posts it');
});

test('an owned design round can actually REACH the human — collect, attach, propose', () => {
  // The gap this closes: a designer leg drew mockups into the brain workspace and nothing carried
  // them to the board, so an owned round produced files no human ever saw. `task.propose_design`
  // creates the artifacts FROM the mockups it is handed, so the owner has to collect and pass them.
  const reg = HOST.slice(HOST.indexOf("name: 'propose_design_round'"), HOST.indexOf("name: 'take_task'"));
  assert.match(reg, /\.nm-evidence', 'design'/, 'collects from where the design prompt tells legs to write');
  assert.match(reg, /type: 'task\.propose_design'/, 'and proposes them as a real board round');
  assert.match(reg, /mockups/, 'carrying the files, since the command is what mints the artifacts');
  // an empty round must REFUSE rather than move the task — design_review with nothing to look at
  // is worse than a failed round that says so
  assert.match(reg, /do not propose an empty round/i, 'and refuses to propose nothing');
});

test('a second design round EDITS the first rather than redrawing it', () => {
  // Without staging, an owned round 2 loses everything the human liked about round 1 — the worst
  // kind of "revision". The seated flow has always staged; the leg path has to as well.
  const fn = HOST.slice(HOST.indexOf('async function designerOverride'), HOST.indexOf('async function taskOf'));
  assert.match(fn, /stagePriorDesignRound\(/, 'the prior round is put back on disk for the leg to edit');
  assert.match(fn, /priorMockups: prior\.names/, 'and the brief names those files');
});

// A wrong KEY here is invisible in review and loud in production: `thread` in the orchestrator
// registry is the TASK ({id, number, title, state}), and the server creates-and-titles any thread
// it is asked for by an id that does not exist. Passing thread.id as threadId therefore spawned a
// fresh session per proposal, named after the document — which read as duplicate threads per task.
test('a proposed library doc posts to its TASK, never to a thread id that does not exist', () => {
  const reg = HOST.slice(HOST.indexOf("name: 'propose_library_doc'"), HOST.indexOf("name: 'list_projects'"));
  assert.ok(reg.length > 400, 'the propose_library_doc tool must be in the registry');
  assert.match(reg, /thread\?\.id \? \{ taskId: thread\.id \}/, 'a task context posts with taskId');
  assert.doesNotMatch(reg, /thread\?\.id \? \{ threadId: thread\.id \}/, 'and never as a threadId');
});

// The worker's own tool inventory. It moved files once (agents.ts → runtime/nmtools.ts) with no
// runtime test under it — the e2e runs in echo mode, so nothing exercises the SDK tool server.
// This is the cheap guard that a future move drops one on the floor silently.
test('a Claude worker gets exactly its 16 tools', () => {
  assert.deepEqual(workerToolNames(MAIN), [
    'add_backlog_item', 'add_subtask', 'advance_beat', 'create_whiteboard', 'declare_beats',
    'draft_replies', 'list_whiteboards', 'load_skill', 'park', 'propose_skill', 'read_whiteboard',
    'record_lesson', 'screenshot', 'search_x', 'spawn', 'update_whiteboard',
  ]);
});
