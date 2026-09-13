// The thread brain override (mockups/brain-config.html, docs/10 §15): a per-role model override
// that rides ONE conversation.
//
// The whole feature is one new layer in an existing precedence chain — `pin > thread > project >
// workspace` — so these tests are mostly about the layer NOT leaking: an override must never
// outrank a human's manual pin, must never survive a role it does not name, and must never store
// a model the server would refuse to run.
import { describe, it, expect } from 'vitest';
import {
  brainCast,
  brainOverrideCount,
  parseBrainOverride,
  seatModel,
  serializeBrainOverride,
  CURRENT_MODELS,
  type BrainOverride,
} from '../src/model-packs';
import { AGENT_ROLES } from '../src/states';

const OPUS = 'claude-opus-5';
const SONNET = 'claude-sonnet-5';
const FABLE = 'claude-fable-5-1';
const GPT = 'gpt-5.6-sol';

describe('parseBrainOverride', () => {
  it('reads a role→model map out of the jsonb column, as text or as an object', () => {
    expect(parseBrainOverride({ developer: OPUS })).toEqual({ developer: OPUS });
    expect(parseBrainOverride(`{"developer":"${OPUS}"}`)).toEqual({ developer: OPUS });
    expect(parseBrainOverride({ developer: OPUS, reviewer: SONNET })).toEqual({ developer: OPUS, reviewer: SONNET });
  });

  it('is null for every shape that is not an override', () => {
    for (const raw of [null, undefined, '', 'null', '{}', {}, '[]', [], 'not json', 42, { developer: '' }]) {
      expect(parseBrainOverride(raw)).toBeNull();
    }
  });

  it('drops what it cannot honour instead of storing it', () => {
    // an unknown ROLE — nothing would ever read it, and it would show in the count as a phantom
    expect(parseBrainOverride({ developer: OPUS, wizard: OPUS })).toEqual({ developer: OPUS });
    // an unknown MODEL — the server allow-list would refuse to run it, so it is not storable
    expect(parseBrainOverride({ developer: 'claude-imaginary-9' })).toBeNull();
    expect(parseBrainOverride({ developer: OPUS, reviewer: 'gpt-nope' })).toEqual({ developer: OPUS });
    // ...and a map that drops to nothing is an ABSENT override, not an empty one: `{}` on the
    // column would read as "an override exists" everywhere that tests for null
    expect(parseBrainOverride({ wizard: OPUS })).toBeNull();
  });

  it('covers EVERY role including the orchestrator (ruling 6)', () => {
    for (const role of AGENT_ROLES) {
      expect(parseBrainOverride({ [role]: OPUS })).toEqual({ [role]: OPUS });
    }
    expect(parseBrainOverride({ orchestrator: OPUS })).toEqual({ orchestrator: OPUS });
  });

  it('round-trips through the column', () => {
    const o: BrainOverride = { developer: OPUS, orchestrator: GPT };
    expect(parseBrainOverride(serializeBrainOverride(o))).toEqual(o);
    // ruling 7: Reset is the WHOLE override — there is no per-role clear, so a cleared override
    // serializes to null and the column goes empty rather than holding `{}`
    expect(serializeBrainOverride(null)).toBeNull();
    expect(serializeBrainOverride({})).toBeNull();
  });
});

describe('the cast reads orchestrator-first', () => {
  const agents = [
    { name: 'scout', role: 'reviewer', model: OPUS },
    { name: 'plume', role: 'marketer', model: OPUS },
    { name: 'rex', role: 'orchestrator', model: OPUS },
    { name: 'bosun', role: 'shipper', model: OPUS },
    { name: 'atlas', role: 'architect', model: OPUS },
    { name: 'patch', role: 'developer', model: OPUS },
    { name: 'iris', role: 'designer', model: OPUS },
  ];

  it('puts the orchestrator first whatever order the agents arrive in', () => {
    // the room's owner, and the model most work is routed through
    expect(brainCast({ agents }).map((s) => s.role)[0]).toBe('orchestrator');
    expect(brainCast({ agents: [...agents].reverse() }).map((s) => s.role)[0]).toBe('orchestrator');
  });

  it('follows the order the pack cards already preview in, so both tabs describe one team', () => {
    expect(brainCast({ agents }).map((s) => s.role)).toEqual([
      'orchestrator', 'architect', 'developer', 'reviewer', 'designer', 'marketer', 'shipper',
    ]);
  });

  it('is NOT the wire enum order — that put the reviewer above the orchestrator', () => {
    const roles = brainCast({ agents }).map((s) => s.role);
    expect(roles.indexOf('orchestrator')).toBeLessThan(roles.indexOf('reviewer'));
    expect(AGENT_ROLES.indexOf('orchestrator')).toBeGreaterThan(AGENT_ROLES.indexOf('reviewer'));
  });

  it('sorts a role outside the preview/support sets LAST rather than first', () => {
    const withWorker = brainCast({ agents: [{ name: 'temp', role: 'worker', model: OPUS }, ...agents] });
    expect(withWorker[0]?.role).toBe('orchestrator');
    expect(withWorker[withWorker.length - 1]?.role).toBe('worker');
  });
});

describe('seatModel — the thread layer', () => {
  const base = { role: 'developer' as const, currentModel: SONNET };

  it('a thread override wins over the project pack and the workspace model', () => {
    expect(seatModel({ ...base, projectPack: 'claude-core', threadOverride: { developer: OPUS } })).toBe(OPUS);
    expect(seatModel({ ...base, threadOverride: { developer: OPUS } })).toBe(OPUS);
  });

  it('a human PIN still outranks it — the override is a pack layer, not a pin (ruling: pin > thread)', () => {
    expect(seatModel({ ...base, modelSource: 'manual', threadOverride: { developer: OPUS } })).toBe(SONNET);
  });

  it('an override that does not name this role changes nothing', () => {
    // the reviewer's seat is untouched by the developer's override — no fallback to `developer`
    // the way a PACK fills gaps, because an override is a list of deliberate exceptions and
    // spilling one role's choice onto another would be a change nobody asked for
    expect(seatModel({ role: 'reviewer', currentModel: SONNET, threadOverride: { developer: OPUS } })).toBe(SONNET);
    expect(seatModel({ role: 'reviewer', currentModel: SONNET, projectPack: 'claude-core', threadOverride: { developer: OPUS } }))
      .toBe(seatModel({ role: 'reviewer', currentModel: SONNET, projectPack: 'claude-core' }));
  });

  it('is inert when absent, so every existing caller keeps its answer', () => {
    for (const threadOverride of [null, undefined, {}]) {
      expect(seatModel({ ...base, projectPack: 'claude-core', threadOverride })).toBe(seatModel({ ...base, projectPack: 'claude-core' }));
    }
  });

  it('never resolves to a model outside the catalog', () => {
    // the parse gate is what makes this true — seatModel trusts a PARSED override
    const dirty = parseBrainOverride({ developer: 'claude-not-real' });
    expect(seatModel({ ...base, threadOverride: dirty })).toBe(SONNET);
    const model = seatModel({ ...base, threadOverride: parseBrainOverride({ developer: OPUS }) });
    expect([...CURRENT_MODELS['claude-code'], ...CURRENT_MODELS.codex, ...CURRENT_MODELS.gemini]).toContain(model);
  });
});

describe('brainCast — who holds each seat, and what each will run', () => {
  const agents = [
    { name: 'rex', role: 'orchestrator', model: FABLE, emoji: '🦉' },
    { name: 'patch', role: 'developer', model: FABLE, emoji: '🐝' },
    { name: 'scout', role: 'reviewer', model: SONNET, emoji: '🔎' },
  ];

  it('answers with the RESOLVED model, so the table and the next wake cannot disagree', () => {
    const cast = brainCast({ agents, threadOverride: { developer: OPUS } });
    // orchestrator-first (see the cast-order block above), then the pack-preview order
    expect(cast.map((s) => [s.name, s.model])).toEqual([
      ['rex', FABLE], ['patch', OPUS], ['scout', SONNET],
    ]);
    expect(cast.find((s) => s.name === 'patch')?.changed).toBe(true);
    expect(cast.find((s) => s.name === 'scout')?.changed).toBe(false);
  });

  it('a pinned seat is marked pinned and is NOT counted as changed — the override cannot move it', () => {
    const cast = brainCast({
      agents: [{ name: 'patch', role: 'developer', model: SONNET, modelSource: 'manual' }],
      threadOverride: { developer: OPUS },
    });
    expect(cast[0]).toMatchObject({ name: 'patch', model: SONNET, pinned: true, changed: false });
  });

  it('one agent per role, and roles that nobody holds are simply absent', () => {
    const cast = brainCast({ agents: [...agents, { name: 'patch2', role: 'developer', model: FABLE }] });
    expect(cast.filter((s) => s.role === 'developer').map((s) => s.name)).toEqual(['patch']);
    expect(cast.some((s) => s.role === 'shipper')).toBe(false);
  });

  it('ignores a row whose role is not a role at all', () => {
    expect(brainCast({ agents: [{ name: 'ghost', role: 'wizard', model: OPUS }] })).toEqual([]);
  });
});

describe('brainOverrideCount — what the pill says', () => {
  it('counts the roles actually changed', () => {
    expect(brainOverrideCount(null)).toBe(0);
    expect(brainOverrideCount({})).toBe(0);
    expect(brainOverrideCount({ developer: OPUS })).toBe(1);
    expect(brainOverrideCount({ developer: OPUS, reviewer: GPT })).toBe(2);
  });

  it('counts what the model would HONOUR, not what was typed at it', () => {
    // "2 changed here" must be true, so the count is of the parsed override — a phantom role in
    // the column cannot inflate it
    expect(brainOverrideCount(parseBrainOverride({ developer: OPUS, wizard: FABLE }))).toBe(1);
  });
});
