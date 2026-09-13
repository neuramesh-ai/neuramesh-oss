// The designer boot-seed decision table (docs/14 rollout): pre-v0.11 workspaces
// get iris registered once, with the active pack's designer brain, and a human's
// same-named agent is never clobbered. Also the orchestrator-hire decision table
// + the hire card/confirm-regex round-trip (they share this pure module so the
// card the LLM/echo emits and the line the watch parses cannot drift).
// Run from apps/desktop:
//   pnpm exec tsx --test src/main/seed.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PACKS } from '@neuramesh/shared';
import { planDesignerSeed, descriptionFor, type AgentHireFacts } from './seed';
import { planAgentHire, buildHireCard, buildPlanningArchitectCard, HIRE_CONFIRM_RE, resolveHireRole } from './hirecards';
import { hireQuestion, hireAcceptLabel, HIRE_DECLINE_LABEL, HIREABLE_ROLES } from './hire';

const base = { hasDesigner: false, irisRole: null, packRoles: null, workspace: 'ws1', machineId: 'm1', channelId: 'c-dev' };

test('a workspace with a designer is left alone', () => {
  const p = planDesignerSeed({ ...base, hasDesigner: true });
  assert.equal(p.action, 'skip');
});

test("a human's same-named agent is never repointed (register upserts by name)", () => {
  const p = planDesignerSeed({ ...base, irisRole: 'developer' });
  assert.equal(p.action, 'skip');
  assert.match((p as { reason: string }).reason, /iris.*developer/);
});

test('seeds iris 🦋 as designer into the dev room, bound to this machine', () => {
  const p = planDesignerSeed(base);
  assert.equal(p.action, 'register');
  const cmd = (p as { cmd: Record<string, unknown> }).cmd;
  assert.equal(cmd['type'], 'agent.register');
  assert.equal(cmd['name'], 'iris');
  assert.equal(cmd['role'], 'designer');
  assert.equal(cmd['emoji'], '🦋');
  assert.deepEqual(cmd['channels'], ['c-dev']);
  assert.equal(cmd['machineId'], 'm1');
});

test('the brain comes from the active pack (derived from the live catalog, never a literal)', () => {
  for (const packId of Object.keys(PACKS)) {
    const p = planDesignerSeed({ ...base, packRoles: PACKS[packId]!.roles });
    const cmd = (p as { cmd: Record<string, unknown> }).cmd;
    assert.equal(cmd['model'], PACKS[packId]!.roles.designer, packId);
    assert.ok(cmd['runtime'], `${packId} resolves a runtime`);
  }
});

test('a custom brain seeds the designer from its designer seat, same as a builtin pack', () => {
  const p = planDesignerSeed({ ...base, packRoles: { ...PACKS['claude-core']!.roles, designer: 'gpt-5.5' } });
  const cmd = (p as { cmd: Record<string, unknown> }).cmd;
  assert.equal(cmd['model'], 'gpt-5.5');
  assert.equal(cmd['runtime'], 'codex');
});

test('an unmanaged workspace (no pack roles — the sentinel/unknown resolve to null upstream) omits model/runtime', () => {
  const p = planDesignerSeed({ ...base, packRoles: null });
  const cmd = (p as { cmd: Record<string, unknown> }).cmd;
  assert.equal(p.action, 'register');
  assert.ok(!('model' in cmd) && !('runtime' in cmd));
});

// ── planAgentHire decision table ─────────────────────────────────────────────

const hire: AgentHireFacts = {
  name: 'seo-analyst',
  role: 'worker',
  brief: 'SEO/competitive analysis — report-style deliverables',
  existing: null,
  packRoles: null,
  orchestrator: { model: 'claude-sonnet-4-6', runtime: 'claude-code' },
  workspace: 'ws1',
  machineId: 'm1',
  channelId: 'c-marketing',
};
const asCmd = (p: ReturnType<typeof planAgentHire>) => (p as { cmd: Record<string, unknown> }).cmd;
const reasonOf = (p: ReturnType<typeof planAgentHire>) => (p as { reason: string }).reason;

test('fresh hire: full register cmd bound to this machine + channel, brief carried', () => {
  const p = planAgentHire(hire);
  assert.equal(p.action, 'register');
  assert.equal((p as { rehire: boolean }).rehire, false);
  const cmd = asCmd(p);
  assert.equal(cmd['type'], 'agent.register');
  assert.equal(cmd['workspace'], 'ws1');
  assert.equal(cmd['machineId'], 'm1');
  assert.equal(cmd['name'], 'seo-analyst');
  assert.equal(cmd['role'], 'worker');
  assert.deepEqual(cmd['channels'], ['c-marketing']);
  assert.equal(cmd['brief'], hire.brief);
});

test('the brain comes from the active pack for the hired role (live catalog, never a literal)', () => {
  for (const packId of Object.keys(PACKS)) {
    for (const role of ['worker', 'reviewer', 'architect'] as const) {
      const p = planAgentHire({ ...hire, role, packRoles: PACKS[packId]!.roles });
      const cmd = asCmd(p);
      assert.equal(cmd['model'], PACKS[packId]!.roles[role], `${packId}/${role}`);
      assert.ok(cmd['runtime'], `${packId}/${role} resolves a runtime`);
    }
  }
});

test('a custom brain drives the hire brain exactly like a builtin pack', () => {
  const custom = { ...PACKS['balanced']!.roles, worker: 'gemini-3.1-flash-lite', developer: 'gemini-3.1-flash-lite' };
  const p = planAgentHire({ ...hire, role: 'worker', packRoles: custom });
  assert.equal(asCmd(p)['model'], 'gemini-3.1-flash-lite');
  assert.equal(asCmd(p)['runtime'], 'gemini');
});

test("no/unmanaged pack falls back to the ORCHESTRATOR's brain — never the server default", () => {
  const p = planAgentHire({ ...hire, packRoles: null });
  const cmd = asCmd(p);
  // explicitly present: the server default (claude-opus-4-8) may name a provider
  // this workspace has no credentials for; the orchestrator's brain is proven live
  assert.equal(cmd['model'], 'claude-sonnet-4-6');
  assert.equal(cmd['runtime'], 'claude-code');
});

test('active same-name in THIS channel → refuse (offer them the task instead)', () => {
  const p = planAgentHire({ ...hire, existing: { role: 'worker', retired: false, inChannel: true } });
  assert.equal(p.action, 'refuse');
  assert.match(reasonOf(p), /already registered to this channel/);
});

test('active same-name elsewhere, same role → degrade to add_to_channel', () => {
  const p = planAgentHire({ ...hire, existing: { role: 'worker', retired: false, inChannel: false } });
  assert.equal(p.action, 'add_to_channel');
  assert.match(reasonOf(p), /adding them to the channel/);
});

test('active same-name elsewhere, role mismatch → refuse naming the real role (never repoint)', () => {
  const p = planAgentHire({ ...hire, existing: { role: 'designer', retired: false, inChannel: false } });
  assert.equal(p.action, 'refuse');
  assert.match(reasonOf(p), /designer/);
});

test('retired same-name, same role → register with rehire: true (history reattaches)', () => {
  const p = planAgentHire({ ...hire, existing: { role: 'worker', retired: true, inChannel: false } });
  assert.equal(p.action, 'register');
  assert.equal((p as { rehire: boolean }).rehire, true);
});

test('retired same-name, role mismatch → refuse (register never changes role)', () => {
  const p = planAgentHire({ ...hire, existing: { role: 'sales', retired: true, inChannel: false } });
  assert.equal(p.action, 'refuse');
  assert.match(reasonOf(p), /sales/);
});

test('orchestrator and curator are never hireable — defense past the tool enum', () => {
  for (const role of ['orchestrator', 'curator', 'ceo']) {
    const p = planAgentHire({ ...hire, role });
    assert.equal(p.action, 'refuse', role);
  }
});

test('name is normalized (trim + lowercase); junk names refuse', () => {
  const ok = planAgentHire({ ...hire, name: '  SEO-Analyst ' });
  assert.equal(asCmd(ok)['name'], 'seo-analyst');
  for (const bad of ['9 lives', '@seo', '-lead', '']) {
    assert.equal(planAgentHire({ ...hire, name: bad }).action, 'refuse', JSON.stringify(bad));
  }
});

// ── hire card ⇄ confirm regex round-trip ─────────────────────────────────────

// QuestionFlow's answer format: "**<question>** → <picked label>"
const answerLine = (q: string, label: string) => `**${q}** → ${label}`;
// mirrors the add-to-channel confirm in agents.ts (the 2798 watch branch)
const ADD_CONFIRM_RE = /\*\*Add @?([a-z0-9][a-z0-9._-]*) to #[^*\n]+\?\*\*\s*(?:→|->)\s*Add\b/i;

test('buildHireCard emits one parseable nmq block honoring the QuestionFlow contract', () => {
  const body = buildHireCard({ chanSlug: 'marketing', name: 'seo-analyst', role: 'worker', taskNumber: 1005, remit: 'SEO analysis' });
  const m = /```nmq\s*\n([\s\S]*?)```/.exec(body);
  assert.ok(m, 'contains an nmq fenced block');
  const card = JSON.parse(m![1]!) as { question: string; options: Array<{ label: string; description?: string }>; allowOther: boolean; hire: Record<string, unknown> };
  assert.equal(card.question, hireQuestion('marketing', 1005));
  assert.equal(card.options[0]!.label, hireAcceptLabel('seo-analyst', 'worker'));
  assert.equal(card.options[1]!.label, HIRE_DECLINE_LABEL);
  assert.equal(card.allowOther, true);
  // the machine payload the deterministic confirm recovers the brief from
  assert.deepEqual(card.hire, { name: 'seo-analyst', role: 'worker', brief: 'SEO analysis', taskNumber: 1005 });
});

test('planning handoff proposes adding an existing workspace architect with a task-linked explanation', () => {
  const body = buildPlanningArchitectCard({ chanSlug: 'build', taskNumber: 1005, existingArchitect: 'atlas' });
  const m = /```nmq\s*\n([\s\S]*?)```/.exec(body);
  assert.ok(m);
  const card = JSON.parse(m![1]!) as { question: string; options: Array<{ label: string }> };
  assert.match(body, /Planning handoff for #1005/);
  assert.equal(card.question, 'Add @atlas to #build?');
  assert.equal(card.options[0]!.label, 'Add @atlas');
  assert.ok(ADD_CONFIRM_RE.test(answerLine(card.question, card.options[0]!.label)));
});

test('planning handoff proposes a room-scoped architect hire without offering the planning task', () => {
  const body = buildPlanningArchitectCard({ chanSlug: 'build', taskNumber: 1005, hireName: 'atlas' });
  const m = /```nmq\s*\n([\s\S]*?)```/.exec(body);
  assert.ok(m);
  const card = JSON.parse(m![1]!) as { question: string; options: Array<{ label: string }>; hire: { role: string; taskNumber: number | null } };
  assert.match(body, /Planning handoff for #1005/);
  assert.equal(card.question, hireQuestion('build'));
  assert.equal(card.options[0]!.label, hireAcceptLabel('atlas', 'architect'));
  assert.equal(card.hire.role, 'architect');
  assert.equal(card.hire.taskNumber, null, 'the roster join—not task.offer—wakes planning');
  const confirm = HIRE_CONFIRM_RE.exec(answerLine(card.question, card.options[0]!.label));
  assert.ok(confirm);
  assert.equal(confirm![1], undefined);
});

test('the clicked accept round-trips through HIRE_CONFIRM_RE with task, name, role', () => {
  const line = answerLine(hireQuestion('marketing', 1005), hireAcceptLabel('seo-analyst', 'worker'));
  const m = HIRE_CONFIRM_RE.exec(line);
  assert.ok(m, line);
  assert.equal(m![1], '1005');
  assert.equal(m![2], 'seo-analyst');
  assert.equal(m![3], 'worker');
});

test('no-task variant leaves the task group undefined; every hireable role matches', () => {
  for (const role of HIREABLE_ROLES) {
    const m = HIRE_CONFIRM_RE.exec(answerLine(hireQuestion('dev'), hireAcceptLabel('a1', role)));
    assert.ok(m, role);
    assert.equal(m![1], undefined);
    assert.equal(m![3], role);
  }
});

test('ASCII arrow and mixed case still match (renderer/runtime drift tolerance)', () => {
  const line = `**HIRE A NEW AGENT FOR #dev to take #7?** -> Hire @Bot.2 (Developer)`;
  const m = HIRE_CONFIRM_RE.exec(line);
  assert.ok(m);
  assert.equal(m![2]!.toLowerCase(), 'bot.2');
});

test('declines, free text, skips, and the add-card answer do NOT fire the hire confirm', () => {
  const q = hireQuestion('marketing', 1005);
  for (const line of [
    answerLine(q, HIRE_DECLINE_LABEL),
    answerLine(q, '(skipped)'),
    answerLine(q, 'call it growth-hacker instead'),
    answerLine('Add @scout to #marketing?', 'Add @scout'),
  ]) {
    assert.equal(HIRE_CONFIRM_RE.exec(line), null, line);
  }
});

test('the hire accept never cross-fires the add-to-channel confirm (and vice versa)', () => {
  const hireLine = answerLine(hireQuestion('marketing', 1005), hireAcceptLabel('seo-analyst', 'worker'));
  assert.equal(ADD_CONFIRM_RE.exec(hireLine), null, 'hire accept must not look like an add accept');
  const addLine = answerLine('Add @scout to #marketing?', 'Add @scout');
  assert.equal(HIRE_CONFIRM_RE.exec(addLine), null, 'add accept must not look like a hire accept');
});

// The #1010 regression: rex hand-composed the card with the SPECIALTY in the
// parens — "(marketing strategist)" — so the old enum-only regex dropped the
// human's click, and the LLM fallback stood down (clicked accepts are the
// system's to execute). A hire-card click must ALWAYS land: the regex now
// captures any parenthesized text and resolveHireRole maps it to a real role.
test('a drifted role label ("marketing strategist") still fires the confirm', () => {
  const line = '**Hire a new agent for #research to take #1010?** → Hire @nova (marketing strategist)';
  const m = HIRE_CONFIRM_RE.exec(line);
  assert.ok(m, 'the observed #1010 answer line must match');
  assert.equal(m![1], '1010');
  assert.equal(m![2], 'nova');
  assert.equal(m![3], 'marketing strategist');
});

test('resolveHireRole: a valid answer-line role passes through untouched', () => {
  for (const role of HIREABLE_ROLES) {
    assert.deepEqual(resolveHireRole(role), { role, fellBack: false });
    assert.deepEqual(resolveHireRole(` ${role.toUpperCase()} `), { role, fellBack: false }); // trim + case
  }
});

test('resolveHireRole: a drifted label defers to the card JSON role, then worker', () => {
  // the card's machine `hire.role` was valid → use it (fellBack still flags the drifted label)
  assert.deepEqual(resolveHireRole('marketing strategist', 'developer'), { role: 'developer', fellBack: true });
  // both drifted → worker (the research/analysis/report class), label preserved as brief by the caller
  assert.deepEqual(resolveHireRole('marketing strategist', 'growth hacker'), { role: 'worker', fellBack: true });
  assert.deepEqual(resolveHireRole('marketing strategist', null), { role: 'worker', fellBack: true });
  // never resolves to a non-hireable role, even if the card JSON names one
  assert.deepEqual(resolveHireRole('marketing strategist', 'orchestrator'), { role: 'worker', fellBack: true });
});

// ── shipper seed (docs/23 rollout) ───────────────────────────────────────────
import { planShipperSeed } from './seed';
import { planMarketerSeed } from './seed';

const shipBase = { hasShipper: false, bosunRole: null, packRoles: null, workspace: 'ws1', machineId: 'm1', channelId: 'c-dev' };

test('a workspace with a shipper (retired included) is left alone', () => {
  const p = planShipperSeed({ ...shipBase, hasShipper: true });
  assert.equal(p.action, 'skip');
});

test("a human's same-named 'bosun' is never repointed", () => {
  const p = planShipperSeed({ ...shipBase, bosunRole: 'developer' });
  assert.equal(p.action, 'skip');
  assert.match((p as { reason: string }).reason, /bosun.*developer/);
});

test('registers bosun with the pack shipper brain and a specialty brief', () => {
  const p = planShipperSeed({ ...shipBase, packRoles: { shipper: 'claude-sonnet-5' } as never });
  assert.equal(p.action, 'register');
  const cmd = (p as { cmd: Record<string, unknown> }).cmd;
  assert.equal(cmd['name'], 'bosun');
  assert.equal(cmd['role'], 'shipper');
  assert.equal(cmd['model'], 'claude-sonnet-5');
  assert.equal(cmd['runtime'], 'claude-code');
  assert.match(String(cmd['brief']), /readiness/i);
});

test('an old custom brain without a shipper seat falls back to the developer seat', () => {
  const p = planShipperSeed({ ...shipBase, packRoles: { developer: 'gpt-5.5' } as never });
  assert.equal(p.action, 'register');
  assert.equal((p as { cmd: Record<string, unknown> }).cmd['model'], 'gpt-5.5');
  assert.equal((p as { cmd: Record<string, unknown> }).cmd['runtime'], 'codex');
});

test('an unmanaged workspace registers with the server-default brain', () => {
  const p = planShipperSeed({ ...shipBase });
  assert.equal(p.action, 'register');
  assert.equal('model' in (p as { cmd: Record<string, unknown> }).cmd, false);
});

// ── marketer seed (marketing-channel plan §4.4): plume 🦚 into the marketing room ──
const mkBase = { hasMarketer: false, plumeRole: null, packRoles: null, workspace: 'ws1', machineId: 'm1', channelId: 'c-marketing' };

test('a workspace with a marketer (retired included) is left alone', () => {
  const p = planMarketerSeed({ ...mkBase, hasMarketer: true });
  assert.equal(p.action, 'skip');
});

test("a human's same-named 'plume' is never repointed", () => {
  const p = planMarketerSeed({ ...mkBase, plumeRole: 'developer' });
  assert.equal(p.action, 'skip');
  assert.match((p as { reason: string }).reason, /plume.*developer/);
});

test('registers plume with the pack marketer brain and a never-publish brief', () => {
  const p = planMarketerSeed({ ...mkBase, packRoles: { marketer: 'claude-sonnet-5' } as never });
  assert.equal(p.action, 'register');
  const cmd = (p as { cmd: Record<string, unknown> }).cmd;
  assert.equal(cmd['name'], 'plume');
  assert.equal(cmd['role'], 'marketer');
  assert.equal(cmd['emoji'], '🦚');
  assert.equal(cmd['model'], 'claude-sonnet-5');
  assert.match(String(cmd['brief']), /never publish/i);
});

test('an old custom brain without a marketer seat falls back designer → developer', () => {
  const viaDesigner = planMarketerSeed({ ...mkBase, packRoles: { designer: 'claude-opus-4-8', developer: 'gpt-5.5' } as never });
  assert.equal((viaDesigner as { cmd: Record<string, unknown> }).cmd['model'], 'claude-opus-4-8');
  const viaDev = planMarketerSeed({ ...mkBase, packRoles: { developer: 'gpt-5.5' } as never });
  assert.equal((viaDev as { cmd: Record<string, unknown> }).cmd['model'], 'gpt-5.5');
});

// ── The two agent strings (0110) ─────────────────────────────────────────────
// `description` ROUTES (the orchestrator reads it in list_agents to pick an agent); `brief`
// INSTRUCTS (injected into the agent's own turns). The orchestrator writes both at hire — but
// the deterministic confirm path has no LLM turn to ask, so descriptionFor derives one from
// the brief, the same split migration 0110 applies to existing rows.
test('descriptionFor: an explicit description wins, capped at 280', () => {
  assert.equal(descriptionFor('Owns the sync layer. Route replication work here.', 'anything'),
    'Owns the sync layer. Route replication work here.');
  assert.equal(descriptionFor('x'.repeat(400), null)!.length, 280);
});

test('descriptionFor: derives the capability clause from a brief written as one string', () => {
  // the real seeded briefs — capability clause, colon, then behaviour
  assert.equal(
    descriptionFor(null, 'Production-readiness plans and release coordination: study the approved change, surface every manual prod step with its owner.'),
    'Production-readiness plans and release coordination',
  );
  assert.equal(
    descriptionFor(null, 'Brand and growth: study the product and its market for real, write the brand docs.'),
    'Brand and growth',
  );
  assert.equal(
    descriptionFor(null, 'SEO and competitive analysis. Route keyword research here.'),
    'SEO and competitive analysis',
  );
});

test('descriptionFor: a brief with no delimiter is the description, capped', () => {
  assert.equal(descriptionFor(null, 'SEO/competitive analysis — report-style deliverables'),
    'SEO/competitive analysis — report-style deliverables');
  assert.equal(descriptionFor(null, 'y'.repeat(400))!.length, 280);
});

test('descriptionFor: nothing to derive from stays null — a description is optional', () => {
  assert.equal(descriptionFor(null, null), null);
  assert.equal(descriptionFor('  ', '   '), null);
});

test('a hire carries both strings, and derives the description when only a brief was given', () => {
  const withBoth = asCmd(planAgentHire({ ...hire, description: 'Audits accessibility. Route a11y work here.', brief: 'Test with a screen reader before you claim a fix.' }));
  assert.equal(withBoth['description'], 'Audits accessibility. Route a11y work here.');
  assert.equal(withBoth['brief'], 'Test with a screen reader before you claim a fix.');
  // brief only (the confirm path): the capability clause becomes the routing string
  const derived = asCmd(planAgentHire({ ...hire, brief: 'SEO and competitive analysis: cite every ranking claim.' }));
  assert.equal(derived['description'], 'SEO and competitive analysis');
  // neither: the ROLE's default (0111). Before, a briefless hire landed undescribed and the next
  // staffing turn could not tell it from any other agent of that role — a floor is better than a
  // blank, and the human rewrites it.
  assert.match(String(asCmd(planAgentHire({ ...hire, brief: null }))['description']), /^Research, analysis and report-style/);
});

test('descriptionFor: falls back to the role default only when there is nothing to derive', () => {
  // an explicit description always wins, then the brief's capability clause, then the role
  assert.match(String(descriptionFor(null, null, 'designer')), /^Designs user-facing work/);
  assert.equal(descriptionFor(null, 'SEO and competitive analysis. Route keyword work here.', 'worker'), 'SEO and competitive analysis');
  assert.equal(descriptionFor('Mine.', 'A brief.', 'developer'), 'Mine.');
  // an unknown role has nothing useful to say — null stays legal
  assert.equal(descriptionFor(null, null, 'wizard'), null);
  assert.equal(descriptionFor(null, null, null), null);
});
