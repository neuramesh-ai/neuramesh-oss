// The capacity-cap flow, end to end through the REAL chain (docs/22 + v0.43.3).
//
// Every unit in this path had its own test and the flow still failed in George's live
// thread: the cap arrived as a successful turn's REPLY TEXT, so nothing ever ran the
// detector on it. This test wires the units together the way the daemon does —
//
//   reply text → isLimitNotice → composeFailover → buildFailoverCard → parseQuestions
//
// — using the real functions at every step, so the card the renderer receives is the
// card production builds. Run from apps/desktop: pnpm exec tsx --test src/main/failover-flow.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeFailover, buildFailoverCard, parseQuestions, planFailoverAgentUpdates, manualPinnedOnModel, PACKS, type AvailSnapshot, type AgentRole } from '@neuramesh/shared';
import { isLimitNotice } from './execpolicy';

// verbatim from the thread (2026-07-19) — bosun posted this as his own answer
const BOSUN_REPLY = "You've hit your monthly spend limit. Run /usage-credits to manage your limit and keep using Sonnet 5 or switch models to continue this chat.";

// the daemon's MODEL_LABEL, kept in step
const label = (id: string): string => ({
  'claude-fable-5-1': 'Fable 5.1', 'claude-opus-5': 'Opus 5',
  'claude-fable-5': 'Fable 5', 'claude-opus-4-8': 'Opus 4.8', 'claude-sonnet-5': 'Sonnet 5',
  'claude-sonnet-4-6': 'Sonnet 4.6', 'claude-haiku-4-5': 'Haiku 4.5', 'gpt-5.6-sol': 'GPT-5.6 Sol',
}[id] ?? id);

const ANTHROPIC_ONLY: AvailSnapshot = {
  anthropic: { installed: true, authed: true, method: 'subscription' },
  openai: { installed: false, authed: false, method: null },
  gemini: { installed: false, authed: false, method: null },
};
const BOTH: AvailSnapshot = { ...ANTHROPIC_ONLY, openai: { installed: true, authed: true, method: 'subscription' } };
const ultracode = { ...PACKS['ultracode']!.roles } as Record<AgentRole, string>;

test('a usage cap in reply text produces a switch card — the whole chain', () => {
  // 1. the guard the reply paths run before posting. Without this the raw provider
  //    notice goes out as the agent's own words (the actual v0.43.2 bug).
  assert.equal(isLimitNotice(BOSUN_REPLY), true);

  // 2. the workspace really is seated on this model, so a cap has something to move. After the
  //    2026-09 reseat ultracode's Anthropic seats are sonnet-5 (dev/worker/sales), so that is the
  //    model whose exhaustion moves anything here.
  assert.ok(Object.values(ultracode).includes('claude-sonnet-5'), 'ultracode seats Sonnet 5');

  // 3. one live login → same-provider fall-forward, never a dead end
  const rec = composeFailover({ exhaustedModel: 'claude-sonnet-5', activeRoles: ultracode, exhausted: ['claude-sonnet-5'], avail: ANTHROPIC_ONLY });
  assert.equal(rec.kind, 'fall_forward');
  // the chain lands on the CURRENT generation: a fall-forward must never drop an agent onto a
  // model that is itself superseded (2026-09 catalog pass)
  assert.equal((rec as { to: string }).to, 'claude-haiku-4-5');
  assert.ok((rec as { roles: AgentRole[] }).roles.length > 0, 'names the affected roles');

  // 4. the card the daemon posts
  const built = buildFailoverCard(rec, { exhaustedModel: 'claude-sonnet-5', avail: ANTHROPIC_ONLY, currentPack: 'ultracode', revert: true }, label);
  assert.match(built.body, /Sonnet 5/);
  assert.match(built.body, /```nmq/);

  // 5. what the RENDERER receives — parsed by the same function the client uses
  const [q] = parseQuestions(built.body);
  assert.ok(q, 'one question card');
  assert.ok(q.failover, 'carries the failover payload the rich card needs');
  assert.equal(q.failover!.exhaustedModel, 'claude-sonnet-5');
  assert.equal(q.failover!.recommendation.kind, 'fall_forward');
  assert.equal(q.failover!.currentPack, 'ultracode'); // what auto-revert restores
  const labels = (q.options ?? []).map((o) => o.label);
  assert.ok(labels.some((l) => l === 'Switch to Haiku 4.5'), labels.join(' | '));
  assert.ok(labels.some((l) => /Keep waiting/i.test(l)), labels.join(' | '));
  // the answer contract survives even if the rich renderer never runs
  assert.ok(q.question.length > 0);
});

test('a second cap converges instead of re-offering an exhausted model', () => {
  const rec = composeFailover({
    exhaustedModel: 'claude-opus-4-8',
    activeRoles: { ...ultracode, developer: 'claude-opus-4-8' },
    exhausted: ['claude-fable-5', 'claude-opus-4-8'],
    avail: ANTHROPIC_ONLY,
  });
  assert.equal(rec.kind, 'fall_forward');
  assert.equal((rec as { to: string }).to, 'claude-sonnet-5'); // skips both capped models
});

test('when the whole provider line is capped, the card offers a PACK switch', () => {
  // George's ask: "if this was fable, we should be able to swap to another pack that doesn't use fable"
  const rec = composeFailover({
    exhaustedModel: 'claude-haiku-4-5',
    activeRoles: { ...ultracode, developer: 'claude-haiku-4-5' },
    exhausted: ['claude-fable-5', 'claude-opus-4-8', 'claude-sonnet-5', 'claude-sonnet-4-6', 'claude-haiku-4-5'],
    avail: BOTH,
  });
  assert.equal(rec.kind, 'switch_pack');
  assert.equal((rec as { packId: string }).packId, 'openai-core');

  const built = buildFailoverCard(rec, { exhaustedModel: 'claude-haiku-4-5', avail: BOTH, currentPack: 'ultracode', revert: true }, label);
  const [q] = parseQuestions(built.body);
  assert.equal(q?.failover?.recommendation.kind, 'switch_pack');
  const labels = (q?.options ?? []).map((o) => o.label);
  assert.ok(labels.some((l) => l.includes(PACKS['openai-core']!.name)), labels.join(' | '));
});

test('with no other login and the line exhausted, the card is honest rather than inventing a move', () => {
  const rec = composeFailover({
    exhaustedModel: 'claude-haiku-4-5',
    activeRoles: { ...ultracode, developer: 'claude-haiku-4-5' },
    exhausted: ['claude-fable-5', 'claude-opus-4-8', 'claude-sonnet-5', 'claude-sonnet-4-6', 'claude-haiku-4-5'],
    avail: ANTHROPIC_ONLY, // nothing else signed in
  });
  assert.equal(rec.kind, 'no_fallback');
  const built = buildFailoverCard(rec, { exhaustedModel: 'claude-haiku-4-5', avail: ANTHROPIC_ONLY, currentPack: 'ultracode', revert: true }, label);
  const [q] = parseQuestions(built.body);
  assert.ok(q, 'still a card — the human is told, not left guessing');
  assert.equal(q.failover?.recommendation.kind, 'no_fallback');
});

// ── what CONFIRMING the card actually does ──────────────────────────────────
// The click posts an answer; the daemon's confirmFailover turns it into agent.update
// commands. planFailoverAgentUpdates is that decision, and it is where a human's pinned
// brain must survive a re-seat.
test('confirming a fall-forward moves only the pack-managed seats on the capped model', () => {
  const rec = composeFailover({ exhaustedModel: 'claude-sonnet-5', activeRoles: ultracode, exhausted: ['claude-sonnet-5'], avail: ANTHROPIC_ONLY });
  // the capped model is sonnet-5, which ultracode seats on developer, worker and sales
  const seats = [
    { id: 'a-dev', role: 'developer' as AgentRole, model: 'claude-sonnet-5', model_source: 'pack', kind: 'local', retired_at: null },
    { id: 'a-worker', role: 'worker' as AgentRole, model: 'claude-sonnet-5', model_source: 'pack', kind: 'local', retired_at: null },
    // a human pinned this one by hand — a re-seat must NOT move it
    { id: 'a-pinned', role: 'sales' as AgentRole, model: 'claude-sonnet-5', model_source: 'manual', kind: 'local', retired_at: null },
    // a remote agent runs on someone else's machine — not ours to re-point
    { id: 'a-remote', role: 'sales' as AgentRole, model: 'claude-sonnet-5', model_source: 'pack', kind: 'remote', retired_at: null },
    // a seat on a DIFFERENT model isn't affected by this cap at all
    { id: 'a-other', role: 'reviewer' as AgentRole, model: 'gpt-6-astra', model_source: 'pack', kind: 'local', retired_at: null },
  ];
  const updates = planFailoverAgentUpdates(rec, seats);
  const moved = updates.map((u) => u.id).sort();
  assert.deepEqual(moved, ['a-dev', 'a-worker'], `moved: ${moved.join(', ')}`);
  for (const u of updates) {
    assert.equal(u.model, 'claude-haiku-4-5');
    assert.equal(u.runtime, 'claude-code'); // same provider → no reconnect
  }
  // …and the human is TOLD about the pin rather than left with a silently stalled agent
  const pinned = manualPinnedOnModel('claude-sonnet-5', seats);
  assert.deepEqual(pinned.map((p) => p.id), ['a-pinned']);
});
