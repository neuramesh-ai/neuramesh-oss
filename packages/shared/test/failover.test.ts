import { describe, it, expect } from 'vitest';
import {
  composeFailover, nextFallForward, bestAlternativeProvider, FALL_FORWARD, CORE_PACK,
  planFailoverAgentUpdates, manualPinnedOnModel, buildFailoverCard,
  type AvailSnapshot, type AgentSeat, type Recommendation,
} from '../src/failover';
import { parseQuestions } from '../src/cards';
import { CURRENT_MODELS, PACKS } from '../src/model-packs';

/** everything the catalog still OFFERS — a fall-forward target must always be in here */
const CURRENT = [...CURRENT_MODELS['claude-code'], ...CURRENT_MODELS.codex, ...CURRENT_MODELS.gemini];
import type { AgentRole } from '../src/states';

// the workspace running Ultracode: fable-5 on orchestrator+architect, opus on developer, etc.
const ULTRACODE = PACKS['ultracode']!.roles as Record<AgentRole, string>;

const avail = (a: Partial<Record<'anthropic' | 'openai' | 'gemini', boolean>>): AvailSnapshot => ({
  anthropic: { installed: true, authed: !!a.anthropic, method: a.anthropic ? 'subscription' : null },
  openai: { installed: true, authed: !!a.openai, method: a.openai ? 'subscription' : null },
  gemini: { installed: true, authed: !!a.gemini, method: a.gemini ? 'subscription' : null },
});

describe('nextFallForward', () => {
  it('walks the family chain, skipping already-exhausted models', () => {
    expect(nextFallForward('claude-fable-5-1', new Set())).toBe('claude-opus-5');
    expect(nextFallForward('claude-fable-5-1', new Set(['claude-opus-5']))).toBe('claude-sonnet-5');
    expect(nextFallForward('claude-fable-5-1', new Set(['claude-opus-5', 'claude-sonnet-5']))).toBe('claude-haiku-4-5');
  });
  it('walks the OpenAI chain from the 2026-09 flagship', () => {
    expect(nextFallForward('gpt-6-astra', new Set())).toBe('gpt-5.6-sol');
    expect(nextFallForward('gpt-6-astra', new Set(['gpt-5.6-sol']))).toBe('gpt-5.6-terra');
  });
  it('lands a superseded model on the CURRENT generation, never back onto its own', () => {
    // an agent still seated on a retired id must fall forward, not sideways into another retirement
    expect(nextFallForward('claude-fable-5', new Set())).toBe('claude-opus-5');
    expect(nextFallForward('claude-opus-4-8', new Set())).toBe('claude-sonnet-5');
    expect(nextFallForward('gemini-3.5-flash', new Set())).toBe('gemini-3.8-flash');
  });
  it('returns null when the whole chain is exhausted or the model has none', () => {
    expect(nextFallForward('claude-fable-5-1', new Set(FALL_FORWARD['claude-fable-5-1']))).toBeNull();
    expect(nextFallForward('gpt-5.4-mini', new Set())).toBeNull(); // cheapest tier, nowhere to fall
  });
});

describe('bestAlternativeProvider', () => {
  it('excludes the exhausted provider and prefers Anthropic → OpenAI → Gemini', () => {
    expect(bestAlternativeProvider('anthropic', avail({ openai: true, gemini: true }))).toBe('openai');
    expect(bestAlternativeProvider('anthropic', avail({ gemini: true }))).toBe('gemini');
    expect(bestAlternativeProvider('openai', avail({ anthropic: true, gemini: true }))).toBe('anthropic');
  });
  it('is null when no other provider is signed in', () => {
    expect(bestAlternativeProvider('anthropic', avail({ anthropic: true }))).toBeNull();
    expect(bestAlternativeProvider('anthropic', avail({}))).toBeNull();
  });
});

describe('composeFailover — single-model exhaustion (Case 1: fall forward)', () => {
  // After the 2026-09 reseat ultracode seats claude-sonnet-5 on developer/worker/sales, so THAT is
  // the model whose exhaustion moves seats in this pack. A fixture naming a model the pack does not
  // seat would return no_fallback and quietly test nothing.
  it('Sonnet 5 out → reseat ONLY the roles on it, same provider', () => {
    const r = composeFailover({ exhaustedModel: 'claude-sonnet-5', activeRoles: ULTRACODE, exhausted: [], avail: avail({ anthropic: true }) });
    expect(r.kind).toBe('fall_forward');
    if (r.kind !== 'fall_forward') throw new Error('kind');
    expect(r.from).toBe('claude-sonnet-5');
    expect(r.to).toBe('claude-haiku-4-5');
    expect(r.provider).toBe('anthropic');
    expect([...r.roles].sort()).toEqual(['developer', 'sales', 'worker']);
  });
  it('does not disturb roles that were not on the dead model', () => {
    const r = composeFailover({ exhaustedModel: 'claude-sonnet-5', activeRoles: ULTRACODE, exhausted: [], avail: avail({ anthropic: true }) });
    if (r.kind !== 'fall_forward') throw new Error('kind');
    // ultracode's orchestrator and reviewer are OpenAI seats — a Claude cap must not touch them
    expect(r.roles).not.toContain('orchestrator');
    expect(r.roles).not.toContain('reviewer');
  });
  it('a RETIRED model still falls forward onto a current one', () => {
    // an agent seated on last generation before the reseat must not be stranded, and must never
    // land on another retired id
    for (const dead of ['claude-fable-5', 'claude-opus-4-8', 'claude-sonnet-4-6', 'gpt-5.5', 'gpt-5.5-pro', 'gemini-3.5-flash']) {
      const next = nextFallForward(dead, new Set());
      expect(next, `${dead} has nowhere to go`).toBeTruthy();
      expect(CURRENT, `${dead} falls onto retired ${next}`).toContain(next);
    }
  });
});

describe('composeFailover — convergence on repeated exhaustion', () => {
  it('Fable already fell to Opus, now Opus caps too → fall forward again to Sonnet 5', () => {
    // the workspace is now on opus for orch+arch (post first failover); opus + fable both exhausted
    const rolesNow = { ...ULTRACODE, orchestrator: 'claude-opus-4-8', architect: 'claude-opus-4-8' };
    const r = composeFailover({ exhaustedModel: 'claude-opus-4-8', activeRoles: rolesNow, exhausted: ['claude-fable-5'], avail: avail({ anthropic: true }) });
    expect(r.kind).toBe('fall_forward');
    if (r.kind !== 'fall_forward') throw new Error('kind');
    expect(r.to).toBe('claude-sonnet-5');
  });
  it('whole Anthropic chain exhausted + OpenAI live → switch to OpenAI Core (Case 2)', () => {
    const chain = ['claude-fable-5', ...FALL_FORWARD['claude-fable-5']!]; // fable + opus + sonnet-5 + sonnet-4.6 + haiku
    const r = composeFailover({ exhaustedModel: 'claude-fable-5', activeRoles: ULTRACODE, exhausted: chain, avail: avail({ anthropic: true, openai: true }) });
    expect(r.kind).toBe('switch_pack');
    if (r.kind !== 'switch_pack') throw new Error('kind');
    expect(r.provider).toBe('openai');
    expect(r.packId).toBe('openai-core');
    expect(r.packId).toBe(CORE_PACK.openai);
  });
  it('Anthropic out, only Gemini live → Gemini Core', () => {
    const chain = ['claude-fable-5', ...FALL_FORWARD['claude-fable-5']!];
    const r = composeFailover({ exhaustedModel: 'claude-fable-5', activeRoles: ULTRACODE, exhausted: chain, avail: avail({ gemini: true }) });
    if (r.kind !== 'switch_pack') throw new Error('kind');
    expect(r.packId).toBe('gemini-core');
  });
  it('Anthropic out and nothing else signed in → no_fallback (connect / wait, hold the work)', () => {
    const chain = ['claude-fable-5', ...FALL_FORWARD['claude-fable-5']!];
    const r = composeFailover({ exhaustedModel: 'claude-fable-5', activeRoles: ULTRACODE, exhausted: chain, avail: avail({ anthropic: true }) });
    expect(r.kind).toBe('no_fallback');
    if (r.kind !== 'no_fallback') throw new Error('kind');
    expect(r.from).toBe('anthropic');
  });
});

describe('planFailoverAgentUpdates — per-role execution (docs/22 §9)', () => {
  const seats: AgentSeat[] = [
    { id: 'a-rex', role: 'orchestrator', model: 'claude-fable-5', model_source: 'pack' },
    { id: 'a-atlas', role: 'architect', model: 'claude-fable-5', model_source: 'pack' },
    { id: 'a-patch', role: 'developer', model: 'claude-opus-4-8', model_source: 'pack' },
    { id: 'a-pin', role: 'orchestrator', model: 'claude-fable-5', model_source: 'manual' }, // human-pinned
    { id: 'a-remote', role: 'architect', model: 'claude-fable-5', model_source: 'pack', kind: 'remote' },
    { id: 'a-gone', role: 'orchestrator', model: 'claude-fable-5', model_source: 'pack', retired_at: '2026-07-01' },
  ];
  const fallForward: Recommendation = { kind: 'fall_forward', provider: 'anthropic', from: 'claude-fable-5', to: 'claude-opus-4-8', roles: ['orchestrator', 'architect'] };

  it('re-seats ONLY the pack-managed non-remote agents on the exhausted model whose role matches', () => {
    const ups = planFailoverAgentUpdates(fallForward, seats);
    expect(ups.map((u) => u.id).sort()).toEqual(['a-atlas', 'a-rex']); // developer (not on fable), manual, remote, retired all excluded
    for (const u of ups) { expect(u.model).toBe('claude-opus-4-8'); expect(u.runtime).toBe('claude-code'); }
  });
  it('a switch_pack or no_fallback yields no per-role updates (the caller uses whole-pack apply / holds)', () => {
    expect(planFailoverAgentUpdates({ kind: 'switch_pack', from: 'anthropic', provider: 'openai', packId: 'openai-core' }, seats)).toEqual([]);
    expect(planFailoverAgentUpdates({ kind: 'no_fallback', from: 'anthropic' }, seats)).toEqual([]);
  });
  it('surfaces manual pins on the dead model separately (a pack switch can’t move them)', () => {
    expect(manualPinnedOnModel('claude-fable-5', seats).map((a) => a.id)).toEqual(['a-pin']);
    expect(manualPinnedOnModel('claude-opus-4-8', seats)).toEqual([]);
  });
});

describe('buildFailoverCard — the daemon/mock card (docs/22)', () => {
  const label = (id: string) => ({ 'claude-fable-5': 'Fable 5', 'claude-opus-4-8': 'Opus 4.8' }[id] ?? id);
  const av = avail({ anthropic: true, openai: true });

  it('a fall-forward card names the roles + target and round-trips through parseQuestions with its payload', () => {
    const rec: Recommendation = { kind: 'fall_forward', provider: 'anthropic', from: 'claude-fable-5', to: 'claude-opus-4-8', roles: ['orchestrator', 'architect'] };
    const card = buildFailoverCard(rec, { exhaustedModel: 'claude-fable-5', avail: av, currentPack: 'ultracode' }, label);
    expect(card.question).toContain('Fable 5');
    expect(card.question).toContain('Opus 4.8');
    expect(card.options[0]!.label).toBe('Switch to Opus 4.8');
    // the fenced nmq block parses back with the rich failover payload intact
    const parsed = parseQuestions(card.body);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.question).toBe(card.question);
    expect(parsed[0]!.failover?.recommendation.kind).toBe('fall_forward');
    expect(parsed[0]!.failover?.currentPack).toBe('ultracode');
  });
  it('a switch_pack card names the target pack + confirms the live provider', () => {
    const rec: Recommendation = { kind: 'switch_pack', from: 'anthropic', provider: 'openai', packId: 'openai-core' };
    const card = buildFailoverCard(rec, { exhaustedModel: 'claude-fable-5', avail: av, currentPack: 'ultracode' }, label);
    expect(card.question).toContain('OpenAI Core');
    expect(card.options[0]!.label).toBe('Switch to OpenAI Core');
    expect(parseQuestions(card.body)[0]!.failover?.recommendation.kind).toBe('switch_pack');
  });
  it('a no_fallback card offers only a wait and never claims a switch', () => {
    const rec: Recommendation = { kind: 'no_fallback', from: 'anthropic' };
    const card = buildFailoverCard(rec, { exhaustedModel: 'claude-fable-5', avail: avail({ anthropic: true }), currentPack: 'ultracode' }, label);
    expect(card.options).toHaveLength(1);
    expect(card.options[0]!.label).not.toMatch(/switch/i);
  });
});

describe('composeFailover — OpenAI Core (Sol on orchestrator) exhaustion', () => {
  it('GPT-5.6 Sol out → fall forward to GPT-5.6 Terra, staying on OpenAI', () => {
    const OPENAI = PACKS['openai-core']!.roles as Record<AgentRole, string>;
    const r = composeFailover({ exhaustedModel: 'gpt-5.6-sol', activeRoles: OPENAI, exhausted: [], avail: avail({ openai: true }) });
    if (r.kind !== 'fall_forward') throw new Error('kind');
    expect(r.to).toBe('gpt-5.6-terra');
    expect(r.provider).toBe('openai');
    // after the 2026-09 reseat Sol also holds designer, shipper and marketer in openai-core
    expect([...r.roles].sort()).toEqual(['designer', 'marketer', 'orchestrator', 'shipper']);
  });
});
