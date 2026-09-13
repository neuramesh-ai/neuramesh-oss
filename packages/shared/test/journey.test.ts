import { describe, expect, it } from 'vitest';
import { executionLegLabel, journeyFor } from '../src/journey';

const roster = { designer: 'iris', architect: 'atlas', developer: 'patch', reviewer: 'scout', shipper: 'bosun' };

describe('the phase spectrum derivation (docs/24)', () => {
  it('a full-ceremony repo task in build: design/plan done, build live with beats fill, road ahead todo', () => {
    const legs = journeyFor(
      { state: 'in_progress', hasDesignRound: true, hasPlanDoc: true, repoBacked: true, shipGate: true, assigneeName: 'patch' },
      roster,
      { done: 3, total: 7 },
    );
    expect(legs.map((l) => `${l.key}:${l.status}`)).toEqual([
      'design:done', 'plan:done', 'build:live', 'review:todo', 'ship:todo', 'accept:todo',
    ]);
    expect(legs[2]!.fill).toBeCloseTo(3 / 7);
    expect(legs[2]!.owner).toBe('patch');
    expect(legs[5]!.owner).toBe('you');
  });

  it('a fast-path bug renders only the legs it was routed through', () => {
    const legs = journeyFor({ state: 'in_review', hasDesignRound: false, hasPlanDoc: false, repoBacked: true, shipGate: true }, roster);
    expect(legs.map((l) => l.key)).toEqual(['build', 'review', 'ship', 'accept']);
    expect(legs[1]!.status).toBe('live');
  });

  it('the gate off (or no repo) drops the ship leg entirely', () => {
    const off = journeyFor({ state: 'in_progress', hasDesignRound: false, hasPlanDoc: false, repoBacked: true, shipGate: false }, roster);
    expect(off.map((l) => l.key)).toEqual(['build', 'review', 'accept']);
    const scratch = journeyFor({ state: 'in_progress', hasDesignRound: false, hasPlanDoc: false, repoBacked: false, shipGate: true }, roster);
    expect(scratch.map((l) => l.key)).toEqual(['build', 'review', 'accept']);
  });

  it('an unstaffed future leg is a GAP — surfaced before it bites', () => {
    const legs = journeyFor({ state: 'in_review', hasDesignRound: false, hasPlanDoc: false, repoBacked: true, shipGate: true }, { ...roster, shipper: null });
    const ship = legs.find((l) => l.key === 'ship')!;
    expect(ship.status).toBe('gap');
    expect(ship.owner).toBeNull();
    // a PAST leg never gaps — the work already happened
    const past = journeyFor({ state: 'ship_review', hasDesignRound: false, hasPlanDoc: false, repoBacked: true, shipGate: true }, { ...roster, reviewer: null });
    expect(past.find((l) => l.key === 'review')!.status).toBe('done');
  });

  it('done sits between review and the road ahead — nothing live; accepted completes every leg', () => {
    const done = journeyFor({ state: 'done', hasDesignRound: false, hasPlanDoc: false, repoBacked: true, shipGate: true }, roster);
    expect(done.map((l) => `${l.key}:${l.status}`)).toEqual(['build:done', 'review:done', 'ship:todo', 'accept:todo']);
    const accepted = journeyFor({ state: 'accepted', hasDesignRound: true, hasPlanDoc: true, repoBacked: true, shipGate: true }, roster);
    expect(accepted.every((l) => l.status === 'done')).toBe(true);
  });

  it('blocked resolves via blockedFrom — a task blocked mid-plan is live on plan', () => {
    const legs = journeyFor({ state: 'blocked', blockedFrom: 'planning', hasDesignRound: false, hasPlanDoc: true, repoBacked: false, shipGate: true }, roster);
    expect(legs.find((l) => l.key === 'plan')!.status).toBe('live');
  });

  it('ship-stage states light the ship leg', () => {
    for (const s of ['shipping', 'ship_review', 'releasing']) {
      const legs = journeyFor({ state: s, hasDesignRound: false, hasPlanDoc: false, repoBacked: true, shipGate: true }, roster);
      expect(legs.find((l) => l.key === 'ship')!.status).toBe('live');
      expect(legs.find((l) => l.key === 'review')!.status).toBe('done');
    }
  });
});

describe('plan-first declared journeys (2026-08-17)', () => {
  const roster = { designer: 'iris', architect: 'atlas', developer: 'patch', reviewer: 'scout', shipper: 'bosun' };
  const base = { blockedFrom: null, hasDesignRound: false, hasPlanDoc: false, repoBacked: false, shipGate: true, assigneeName: null };

  it('declared legs drive the bar: a lean research unit shows plan · build · accept — no review', () => {
    const legs = journeyFor({ ...base, state: 'in_progress', workPlanLegs: ['build'] }, roster);
    expect(legs.map((l) => l.key)).toEqual(['plan', 'build', 'accept']);
  });

  it('a declared design leg shows GHOSTED before any round exists (never a surprise)', () => {
    const legs = journeyFor({ ...base, state: 'plan_review', workPlanLegs: ['design', 'build', 'review'] }, roster);
    expect(legs.map((l) => l.key)).toEqual(['plan', 'design', 'build', 'review', 'accept']); // plan FIRST — the born-into gate
    expect(legs.find((l) => l.key === 'design')!.status).toBe('todo');
    expect(legs.find((l) => l.key === 'plan')!.status).toBe('live'); // born into the gate
  });

  it('done on a lean unit reads past build, not past a review it never had', () => {
    const legs = journeyFor({ ...base, state: 'done', workPlanLegs: ['build'] }, roster);
    expect(legs.find((l) => l.key === 'build')!.status).toBe('done');
    expect(legs.find((l) => l.key === 'accept')!.status).toBe('todo');
  });

  it('legacy tasks (no work plan) keep the evidence-derived journey byte for byte', () => {
    const legs = journeyFor({ ...base, state: 'in_progress' }, roster);
    expect(legs.map((l) => l.key)).toEqual(['build', 'review', 'accept']);
  });
});

describe('the execution leg is named by what the work IS (2026-08-19)', () => {
  const roster = { designer: 'iris', architect: 'atlas', developer: 'patch', reviewer: 'scout', shipper: 'bosun' };
  const base = { state: 'in_progress', hasDesignRound: false, hasPlanDoc: false, repoBacked: false, shipGate: false };

  it('a research task RESEARCHES — build is a code word', () => {
    expect(executionLegLabel('research')).toBe('Research');
    expect(executionLegLabel('spike')).toBe('Research');
    expect(executionLegLabel('content')).toBe('Draft');
    expect(executionLegLabel('docs')).toBe('Write');
    expect(executionLegLabel('bug')).toBe('Build');
    expect(executionLegLabel(null)).toBe('Build');
  });

  it('journeyFor labels the build leg through the same mapping', () => {
    const legs = journeyFor({ ...base, kind: 'research', workPlanLegs: ['build'] }, roster);
    const exec = legs.find((l) => l.key === 'build')!;
    expect(exec.label).toBe('Research');
    // the KEY stays 'build' — one execution stage in the FSM, only the label moves
    expect(exec.key).toBe('build');
    const legacy = journeyFor({ ...base, kind: 'feature', workPlanLegs: ['build'] }, roster);
    expect(legacy.find((l) => l.key === 'build')!.label).toBe('Build');
  });
});
