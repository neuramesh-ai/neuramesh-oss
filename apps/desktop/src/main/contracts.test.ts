// The extraction's safety net.
//
// 14,559 characters of the orchestrator's behaviour moved out of a template literal and into
// defaults/agents/orchestrator.yaml. A diff that large is unreviewable, so the guarantee is
// mechanical instead: the composed prompt must equal, character for character, what the literal
// produced. The literal's text is pinned here as a fingerprint — length plus the exact opening
// and closing spans — so a contract edited by accident (or reformatted by a YAML tool that
// "helpfully" rewraps a block scalar) fails loudly rather than quietly changing an agent.
//
// This is deliberately a FINGERPRINT, not a full copy: pasting 14.5k characters into a test would
// just be the same unreviewable blob a second time.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { composePrompt } from '@neuramesh/shared';
import { contractFor, shippedContractKeys } from './contracts';
import { hostSource, rendererSource } from './srcscan';

const AGENT_ROLES = ['orchestrator', 'architect', 'developer', 'worker', 'reviewer', 'designer', 'marketer', 'shipper', 'curator', 'sales'];

test('every role has a shipped contract — the tripwire for adding a role and forgetting one', () => {
  const keys = new Set(shippedContractKeys());
  for (const role of AGENT_ROLES) {
    assert.ok(keys.has(role), `no defaults/agents/${role}.yaml — a role without a contract falls back to nothing`);
  }
});

test('the orchestrator contract carries every block the prompt assembles', () => {
  const c = contractFor('rex', 'orchestrator');
  assert.ok(c, 'orchestrator contract missing');
  for (const block of ['channel', 'powers', 'style']) {
    assert.ok((c!.prompt?.[block] ?? '').length > 100, `prompt.${block} is missing or stubbed`);
  }
  assert.ok((c!.description ?? '').length > 40, 'the orchestrator has no routing description');
});

test('BYTE FINGERPRINT: the channel contract is pinned', () => {
  const t = contractFor('rex', 'orchestrator')!.prompt!['channel']!;
  // the exact span the template opens with (unchanged since the literal era)
  assert.ok(t.startsWith('You are ${agent.name}, the orchestrator for #${ch.slug} in a NeuraMesh workspace.${projLine}'),
    'the channel contract no longer opens the way the literal did');
  // 16046 → 7480, DELIBERATELY (2026-08-18, the diet): the audit found three eras of routing
  // doctrine co-loaded and disagreeing (own-the-design vs route-to-designer; rex-drafts-the-plan
  // vs architect-drafts; take-default vs pre-named offers), every rule stated 2–6×, changelog
  // dates and a hardcoded seat name in live prose. Rewritten as ONE decision tree under the
  // one-home-per-rule rule: tool mechanics live in tool descriptions, judgment lives here.
  assert.equal(t.length, 7480, 'the channel contract changed length — if that was deliberate, update this number IN THE SAME COMMIT');
  assert.equal(t.split('\n').length, 39, 'the channel contract changed line count');
});

test('powers and style match their pinned size', () => {
  const c = contractFor('rex', 'orchestrator')!;
  // 6195 → 7192, DELIBERATELY (2026-08-06): the triage lives in `powers`, and this is where the
  // board stopped being the default answer — option 4 became propose_task with a named bar, and
  // "too big to answer" became a reason to spawn rather than to file. The fingerprint moving in
  // the same commit as the edit is the contract working, not a broken test.
  // 7192 → 7840, DELIBERATELY (2026-08-08): the named bar was still losing to "I have no way to
  // hand this over", so option 4 now says a DELIVERABLE YOU CAN PRODUCE IS NOT A TASK — and
  // draft_posts is the hands that makes it true for social drafts.
  // 7840 → 8790, DELIBERATELY (2026-08-08): the same rule for diagrams. "A diagram through
  // create_whiteboard" was one clause inside option 4 and it lost to a tool that actually existed
  // (propose_library_doc), so an ask for a whiteboard came back as markdown with a mermaid fence.
  // DIAGRAMS ARE DRAWN, NOT DESCRIBED is now its own power, next to the tool that landed with it.
  // 8790 → 8903, DELIBERATELY (2026-08-08): and the syntax is part of the instruction. Measured on
  // mermaid-to-excalidraw 2.2.2 — the same flowchart converts to 11 editable shapes without
  // `subgraph` and to a single flat image with it, which is the whole difference between a
  // whiteboard and a picture of one.
  // 8903 → 9541, DELIBERATELY (2026-08-10): option 4 gained the explicit-word exception — the
  // live e2e caught rex answering "yes create the task" with ANOTHER card, so the contract now
  // says creating (add_backlog_item → promote_backlog_item, link #N) IS the answer to explicit
  // consent, and a declined card is never re-sent.
  // 9541 → 9484, DELIBERATELY (2026-08-17, George): the proposal card RETIRED — one less blocking
  // point. Under plan-first the card asked permission to ask permission: a create lands in
  // plan_review, inert until the human approves the plan with full information (journey ·
  // subtasks · approach), so the plan gate IS the consent. Option 4 becomes create_task, direct;
  // the explicit-word carve-out dissolves (there is no card to decline); the three-reason bar
  // and the question-cards-first rule stand.
  // 9484 → 3396, DELIBERATELY (2026-08-18, the diet): powers is now the standing doctrine only —
  // the triage ladder, the deliverable rule, the gates, the subtask law. Everything that
  // restated a tool's own description (staffing ladder, whiteboard mermaid mechanics, backlog
  // trio, request_verdict lore, scheduling) moved to its one home; plan-first moved to the
  // channel tree. The 2026-08-08 whiteboard power stays as the one-line trigger — the mermaid
  // syntax rules live on WB_CREATE_DESC, beside the tool that runs them.
  // 3398 → 4010, DELIBERATELY (2026-08-26, George, live): RESOLVE DEPENDENCIES BEFORE YOU
  // DELEGATE. rex staffed a reply-radar run into a room with no connected account: the worker
  // had nothing to read with, wrote a Python package that would read X if it ever had a
  // credential, and the missing connector surfaced at the END as four tasks asking the human to
  // go connect one. The gate is now enforced at the create (run_playbook refuses and posts the
  // dependency card), and this is the doctrine that gate expresses — a dependency is something
  // the human clicks, never a unit of work filed for later.
  // 4010 → 4381 and 1385 → 1430, DELIBERATELY (2026-09-08, George: "a user should explicitly tell
  // the model in chat e.g. merge for those actions to happen, not a button click"): ACCEPT IS THE
  // HUMAN'S WORD, NEVER A BUTTON. GATES now names accept_task and the server's proof it rides on
  // (a human message newer than the verdict, in the thread), and the style rules stop calling
  // accept a button — and stop offering the word as a follow-up pill, which would be one again.
  assert.equal(c.prompt!['powers']!.length, 4381);
  assert.equal(c.prompt!['style']!.length, 1430);
});

test('the contract makes solving in-thread the default, and filing a proposal', () => {
  const c = contractFor('rex', 'orchestrator')!;
  const powers = c.prompt!['powers']!;
  const channel = c.prompt!['channel']!;
  assert.match(powers, /THE DEFAULT IS TO SOLVE IT HERE/);
  // 2026-08-17: creation is DIRECT and plan-first — the human's consent moved to the plan gate
  // (2026-08-18: the plan-first law lives in the channel tree; the ladder stays in powers)
  assert.match(channel, /born in plan_review, inert until they approve/);
  assert.match(powers, /create_task, directly/);
  // the bar is named, so "this feels big" cannot quietly become a task
  assert.match(powers, /they asked for tracked work/);
  assert.match(powers, /OUTLIVE this conversation/);
  assert.match(powers, /"This feels big" is not the bar/);
  // and the alternative to filing is fanning out
  assert.match(powers, /that is a reason to SPAWN, not a reason to file/);
  // the three contradictions the diet resolved must not quietly return: ONE design doctrine
  // (owned rounds; routed legs come from the plan), ONE planner (rex drafts, architect subagent
  // feeds it), ONE ownership default (take it; pre-name only for durable owners)
  assert.ok(!/Do NOT offer a design task to the seated designer/.test(channel + powers), 'the own-it-vs-route-it contradiction is back');
  assert.ok(!/request_plan \(the architect drafts a plan/.test(channel + powers), 'the who-drafts-the-plan contradiction is back');
  assert.match(channel, /Pre-name offerTo ONLY when the work wants a durable named owner/);
});

test('composing substitutes every variable the channel block asks for', () => {
  const t = contractFor('rex', 'orchestrator')!.prompt!['channel']!;
  const out = composePrompt(t, {
    'agent.name': 'rex', 'ch.slug': 'dev', projLine: '', powers: 'P', style: 'S',
    skillsNote: '', convoNamer: '', marketingNote: '', marketingSchedulingContext: '', HIRE_CARD_SPEC: 'H',
  });
  assert.ok(out.startsWith('You are rex, the orchestrator for #dev'), 'identity did not substitute');
  assert.ok(!/\$\{/.test(out), `an unsubstituted placeholder survived: ${/\$\{[^}]+\}/.exec(out)?.[0]}`);
});

// ROLE_DESCRIPTION (shared, TS) and the contracts (YAML) both state what a role does, because
// the renderer's onboarding crew and seed.ts cannot read a file and the daemon can. Two statements
// of one fact drift; this is the same tripwire the tokens.css ↔ client-core parity test is.
test('every contract’s description matches ROLE_DESCRIPTION exactly', async () => {
  const { ROLE_DESCRIPTION } = await import('@neuramesh/shared');
  for (const [role, text] of Object.entries(ROLE_DESCRIPTION)) {
    const c = contractFor(role, role);
    assert.ok(c, `no contract for ${role}`);
    assert.equal((c!.description ?? '').trim(), text.trim(),
      `defaults/agents/${role}.yaml describes the role differently from ROLE_DESCRIPTION — update BOTH`);
  }
});

// The ENFORCED half of "the board is not the default answer", INVERTED DELIBERATELY
// (2026-08-17, George): create_task is BACK — but the safety moved down a layer, from "the tool
// is not there" to "the server refuses a plan-less agent create" (createtask.ts PLAN_FIRST) and
// "a created unit is born inert in plan_review until the human approves the plan". The card was
// a second consent in front of a stronger one. This test now guards the NEW invariants: the
// tool exists, it REQUIRES the plan fields, and the proposal tool stays gone.
test('the orchestrator registry creates directly — plan-first, no proposal card', async () => {
  const host = hostSource(import.meta.dirname);
  assert.match(host, /\{ name: 'create_task'/);
  assert.ok(!/\{ name: 'propose_task'/.test(host), 'the proposal card path is back — the plan gate is the one consent');
  const create = host.slice(host.indexOf("{ name: 'create_task'"));
  const cbody = create.slice(0, create.indexOf('} },'));
  assert.match(cbody, /approach: z\.string\(\)\.min\(40\)/, 'create_task must REQUIRE the plan approach');
  assert.match(cbody, /legs: z\.array/, 'create_task must REQUIRE the declared journey');
  assert.match(cbody, /originThread: convoThreadId/, 'the created unit must anchor to the conversation that asked');
  // the alternatives stay open on purpose: parking an idea is the CHEAP alternative to a task,
  // and a subtask rides a parent the human already accepted
  assert.match(host, /\{ name: 'add_backlog_item'/);
  assert.match(host, /\{ name: 'add_subtask'/);

  // and it files into the room the conversation was moved to, not the one it started in
  assert.match(cbody, /channel: here\(\)/, 'the create targets ch.id, ignoring file_conversation');
});

// GRANTED ON THE BUS, UNDELIVERED BY THE REGISTRY — the defect class this guards.
//
// The shared catalogue is the contract every surface agrees through, but the orchestrator's tools
// are hand-built, so a tool can be granted there and simply not exist in the turn. It happened
// twice: `spawn` (listed for 'triage' from the start, never registered — the orchestrator could
// not fan out) and `create_whiteboard` (rex's own contract said "a diagram through
// create_whiteboard" while the registry had no such tool, so an ask for a whiteboard came back as
// a markdown file with a mermaid fence in it). The model reaches for the nearest tool that DOES
// exist, which is why the failure reads as a bad answer rather than an error.
test('every nm tool the catalogue grants a triage turn is really in the orchestrator registry', async () => {
  const { toolsForKind } = await import('@neuramesh/shared');
  const host = hostSource(import.meta.dirname);
  // scoped to the registry itself, so a name that only appears in a comment or a prompt block
  // elsewhere in the file cannot pass for a registration
  const start = host.indexOf('async function buildOrchestratorTools');
  const registry = host.slice(start, host.indexOf('function buildScheduleCard', start));
  assert.ok(start > 0 && registry.length > 1000, 'could not find the orchestrator registry');
  const defined = new Set([...registry.matchAll(/name: '([a-z_]+)'/g)].map((m) => m[1]));
  for (const t of toolsForKind('triage')) {
    assert.ok(defined.has(t), `TOOL_KINDS grants '${t}' to a triage turn, but the orchestrator registry never defines it`);
  }
});

// ── the local layer ──────────────────────────────────────────────────────────────────────────
// Both of these guard REGRESSIONS THAT WERE REAL: the first version of writeLocalInstructions
// wrote `header + instructions:` over the whole file, so a Save in the overlay silently deleted
// anything the human had hand-added — the exact failure a hand-editable file must not have.
test('a save preserves keys it does not own, and never truncates a hand-edited file', async () => {
  const { mkdtempSync, writeFileSync, readFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { initContracts, writeLocalInstructions, localInstructions, localContractPath } = await import('./contracts');
  const { load } = await import('js-yaml');

  initContracts(mkdtempSync(join(tmpdir(), 'nm-contracts-')));
  const f = localContractPath('rex');
  writeFileSync(f, 'instructions: from the file\nnote: keep me\nprompt:\n  channel: hand written\n');

  writeLocalInstructions('rex', 'edited in the overlay');
  const doc = load(readFileSync(f, 'utf8')) as Record<string, unknown>;
  assert.equal(doc['instructions'], 'edited in the overlay');
  assert.equal(doc['note'], 'keep me', 'a hand-added key was destroyed by Save');
  assert.deepEqual(doc['prompt'], { channel: 'hand written' }, 'a hand-added block was destroyed by Save');
  assert.equal(localInstructions('rex'), 'edited in the overlay', 'the cache did not follow the write');
});

test('the local file says only what is true of it — instructions only, prompt blocks repo-only', async () => {
  const { mkdtempSync, readFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { initContracts, writeLocalInstructions, localContractPath } = await import('./contracts');

  initContracts(mkdtempSync(join(tmpdir(), 'nm-contracts-')));
  writeLocalInstructions('iris', 'be brief');
  const head = readFileSync(localContractPath('iris'), 'utf8').split('\n').filter((l) => l.startsWith('#')).join('\n');

  // It must NOT promise to override the shipped contract: contractFor reads defaults/agents only,
  // so a `prompt:` block written here is never consulted. Telling someone otherwise costs them
  // an afternoon editing a block that cannot take effect.
  assert.ok(!/wins over.*shipped contract/i.test(head), 'the header still overclaims');
  assert.ok(/ONLY key read from this file/i.test(head), 'the header does not name its scope');
  assert.ok(/cannot be overridden per machine/i.test(head), 'the header does not say prompt blocks are repo-only');
});

test('an unparseable local file is copied aside before the save rewrites it', async () => {
  const { mkdtempSync, writeFileSync, readFileSync, existsSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { initContracts, writeLocalInstructions, localContractPath } = await import('./contracts');

  initContracts(mkdtempSync(join(tmpdir(), 'nm-contracts-')));
  const f = localContractPath('rex');
  // a duplicate key — exactly what a hand-edit or an appended block produces, and what js-yaml
  // refuses to parse. Without the copy, the next Save silently ate it.
  writeFileSync(f, 'instructions: one\nhand_added: keep me\nhand_added: keep me\n');

  writeLocalInstructions('rex', 'from the overlay');
  assert.ok(existsSync(`${f}.bak`), 'the unparseable file was overwritten with no copy kept');
  assert.match(readFileSync(`${f}.bak`, 'utf8'), /hand_added/, 'the copy does not hold the original');
  assert.match(readFileSync(f, 'utf8'), /from the overlay/, 'the save did not land');
});

test('the shipped contracts are actually PACKAGED — the empty-prompt trap', async () => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const pkg = JSON.parse(readFileSync(join(import.meta.dirname, '../../package.json'), 'utf8'));

  // contracts.ts resolves the packaged copy at `process.resourcesPath/defaults/agents`. Nothing
  // else puts it there: electron-builder's `files` only carries out/**, so without this entry a
  // signed build finds no contract, `contract?.prompt?.channel ?? ''` yields an EMPTY string, and
  // the orchestrator ships with no instructions at all — working perfectly in dev the whole time.
  const res = (pkg.build?.extraResources ?? []) as Array<{ from: string; to: string }>;
  const carries = res.some((r) => /defaults\/agents$/.test(r.from ?? '') && /defaults\/agents$/.test(r.to ?? ''));
  assert.ok(carries, 'defaults/agents is not in electron-builder extraResources — the packaged app would have no contracts');
});

// ── the role contracts' prompt blocks ────────────────────────────────────────────────────────
// The worker's turn has its own byte-identity net (runtime/codingcontract.test.ts) because it is
// assembled from eight optional pieces. These are the flat ones: what matters is that the words
// still exist and still reach the turn, since a missing key composes to '' — an agent silently
// running with no instructions is exactly the failure this whole slice exists to prevent.
test('every extracted role contract carries the blocks its turn reads', async () => {
  const { shippedContract } = await import('./contracts');
  const expected: Record<string, string[]> = {
    orchestrator: ['channel', 'powers', 'style', 'thread', 'sweep.digest', 'sweep.watchdog', 'sweep.monitor', 'sweep.note'],
    worker: ['system', 'system.instructions', 'turn', 'where.repo', 'where.scratch', 'brief',
             'checklist', 'channel', 'skills', 'skills.load', 'rework', 'rework.beats',
             'rework.lesson', 'nm_tools'],
    reviewer: ['verdict.system', 'verdict.user', 'verdict.design_note'],
  };
  for (const [role, keys] of Object.entries(expected)) {
    const prompt = shippedContract(role)?.prompt ?? {};
    for (const k of keys) {
      assert.ok((prompt[k] ?? '').trim().length > 0, `${role}.yaml is missing prompt.${k} — the turn would compose it to an empty string`);
    }
  }
});

test('the reviewer contract still says the things its strictness depends on', async () => {
  const { shippedContract } = await import('./contracts');
  const sys = shippedContract('reviewer')?.prompt?.['verdict.system'] ?? '';
  // each of these is a bounce rule that was fought for; losing one silently loosens the gate
  assert.match(sys, /Approve ONLY if every item in the acceptance contract is demonstrably satisfied/);
  assert.match(sys, /treat that item as UNMET — do not accept the worker's prose claim in place of the artifact/);
  assert.match(sys, /do NOT request changes because CI is pending/);
  assert.match(sys, /Output ONLY one JSON object/);
});

// ── honesty of the owning turn's settle line ─────────────────────────────────────────────────
// Source-level guards for two founder-reported reads of the same screenshot: a run that died at
// 2:20 of a 25-minute budget settled as "the turn ran out of time" (the canned text from the one
// incident that birthed the path), on a row titled with the bare task so its DONE badge read as
// the TASK being done while the header said designing.
test('the advanced-then-died settle carries the real reason, not a canned timeout', async () => {
  const src = hostSource(import.meta.dirname);
  assert.ok(!src.includes('the turn ran out of time afterwards'),
    'the canned timeout text is back — it claims a budget death for every error class');
  const i = src.indexOf("phase advanced to ${after!.state}");
  assert.ok(i > 0, 'the advanced-settle path is gone');
  const around = src.slice(Math.max(0, i - 600), i);
  assert.match(around, /timed out/i, 'the settle no longer distinguishes a real timeout from any other death');
  assert.match(around, /\$\{why\}/, 'the settle no longer carries the actual error');
});

test('the owning run row is verb-titled, never the bare task', async () => {
  const src = hostSource(import.meta.dirname);
  assert.match(src, /title: `Owning #\$\{t\.number\} — \$\{t\.title\}`/,
    'the work-run title lost its verb — a task-titled row wearing DONE reads as the task being done');
});

// ── one session on the main surface (2026-08-11, George live) ────────────────────────────────
// Opening a task from the nav and then clicking the parent thread did NOTHING: the surface
// renders `openThreadId && !openTask`, and every thread opener set the thread while leaving the
// task open — so the click changed state nothing could show (and when the row was the thread you
// were already on, the id never changed at all). The rule is structural: a session opens by
// REPLACING the one before it, so there is exactly ONE door and it clears the task.
test('every thread opener goes through openConversation, which closes the open task', async () => {
  const app = rendererSource(import.meta.dirname);

  const door = app.slice(app.indexOf('const openConversation ='), app.indexOf('const openConversation =') + 700);
  assert.match(door, /setOpenTaskId\(null\)/, 'the one door must close the open task — that IS the fix');
  assert.match(door, /setOpenThreadId\(threadId\)/);

  // …and nobody bypasses it. Setting the thread to NULL is a close and stays free; setting it to
  // a THREAD is an open, and openConversation is the only place allowed to do that.
  const opens = [...app.matchAll(/setOpenThreadId\(([^)]*)\)/g)]
    .map((m) => m[1]!.trim())
    .filter((arg) => arg !== 'null');
  assert.deepEqual(opens, ['threadId'],
    `a thread is opened outside openConversation (${JSON.stringify(opens)}) — that call will not close an open task, which is the live bug`);
});
