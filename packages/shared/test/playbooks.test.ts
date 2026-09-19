// The playbook registry (docs/design/marketing-os-2026-08): pure data + derivations rex's
// tools, the destination and the nmplays card all read — pinned so a registry edit that
// breaks a contract (an unfillable template, a chat playbook leaking into run_playbook's
// enum, a recs block that doesn't round-trip) fails here, not in a live room.
import { describe, expect, it } from 'vitest';
import {
  PLAYBOOKS,
  playbookFromAsk,
  UNIT_PLAYBOOK_IDS,
  parsePlaybookRecs,
  playbookAsk,
  playbookById,
  playbookFromReportName,
  playbookOfReport,
  playbookReportName,
  playbookPlan,
  playbookRecsBlock,
  playbookState,
  playbookUnitTitle,
  resolvePlaybookInputs,
  stripPlaybookRecs, RUNTIME_SLOTS } from '../src/playbooks';

describe('the registry', () => {
  it('ids are unique and every unit playbook declares a lean build leg + a DoD + an approach', () => {
    expect(new Set(PLAYBOOKS.map((p) => p.id)).size).toBe(PLAYBOOKS.length);
    for (const p of PLAYBOOKS.filter((x) => x.engine === 'unit')) {
      // round 3 (founder review): no review leg — a canned template needs no reviewer round;
      // the human's gate is ACCEPT on the deliverable, so the unit finishes straight to it
      expect(p.legs, p.id).toEqual(['build']);
      expect(p.dod.length, p.id).toBeGreaterThan(40);
      expect(p.approach.length, p.id).toBeGreaterThan(40);
      expect(p.skill, p.id).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it('chat playbooks are excluded from run_playbook by construction (the enum, not prose)', () => {
    expect(UNIT_PLAYBOOK_IDS).not.toContain('copylab');
    expect(UNIT_PLAYBOOK_IDS).not.toContain('hooks');
    expect(UNIT_PLAYBOOK_IDS).not.toContain('email');
    expect(UNIT_PLAYBOOK_IDS).not.toContain('ugc'); // UGC scripts are handed over in the thread (draft cards), never a unit
    expect(UNIT_PLAYBOOK_IDS.length).toBe(PLAYBOOKS.filter((p) => p.engine === 'unit').length);
  });

  it('every approach template slot is fillable — from the playbook’s inputs or the RUN itself', () => {
    for (const p of PLAYBOOKS) {
      const slots = [...p.approach.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
      const fillable = [...p.inputs.map((i) => i.key), ...RUNTIME_SLOTS];
      for (const s of slots) expect(fillable, `${p.id} uses {${s}}`).toContain(s);
    }
  });

  it('a playbook that declares connector needs is one whose run cannot proceed without them', () => {
    // the gate is data, not prose: an entry with `needs` is refused at create when unmet
    const gated = PLAYBOOKS.filter((p) => p.needs?.length);
    expect(gated.map((p) => p.id)).toEqual(['engage', 'release']);
    expect(gated[0]!.needs![0]).toMatchObject({ kind: 'connector', min: 1 });
  });

  it('scored playbooks are exactly the ones whose modules end in a 0–100', () => {
    expect(PLAYBOOKS.filter((p) => p.scored).map((p) => p.id).sort()).toEqual(['audit', 'geo']);
  });
});

describe('input resolution', () => {
  const audit = playbookById('audit')!;
  const profile = JSON.stringify({ website: 'https://www.joinflowe.com' });

  it('caller beats profile beats missing', () => {
    expect(resolvePlaybookInputs(audit, { url: 'https://x.dev' }, profile).values.url).toBe('https://x.dev');
    expect(resolvePlaybookInputs(audit, null, profile).values.url).toBe('https://www.joinflowe.com');
    const r = resolvePlaybookInputs(audit, null, null);
    expect(r.missing).toEqual(['url']);
  });

  it('an unreadable profile is an untouched profile, never a throw', () => {
    expect(resolvePlaybookInputs(audit, null, '{nope').missing).toEqual(['url']);
  });

  it('a single-input playbook adopts every mis-keyed value, joined (found live, twice)', () => {
    const teardown = playbookById('teardown')!;
    expect(resolvePlaybookInputs(teardown, { competitors: 'Headspace and Calm' }, null).values.competitor).toBe('Headspace and Calm');
    // rex's second shape: one name per key — on a one-slot form they are all the slot's value
    expect(resolvePlaybookInputs(teardown, { competitor1: 'Headspace', competitor2: 'Calm' }, null).values.competitor).toBe('Headspace, Calm');
    // the exact key still wins untouched
    expect(resolvePlaybookInputs(teardown, { competitor: 'Linear' }, null).values.competitor).toBe('Linear');
  });

  it('inputs arriving as a JSON STRING are parsed, never character-exploded (found live: codex bus)', () => {
    const teardown = playbookById('teardown')!;
    expect(resolvePlaybookInputs(teardown, '{"competitor":"Headspace and Calm"}' as never, null).values.competitor).toBe('Headspace and Calm');
    expect(resolvePlaybookInputs(teardown, '{"competitors":"Headspace, Calm"}' as never, null).values.competitor).toBe('Headspace, Calm');
    // unparseable string = nothing given — an honest MISSING_INPUT, never garbage
    expect(resolvePlaybookInputs(teardown, 'Headspace and Calm' as never, null).missing).toEqual(['competitor']);
  });

  it('subject shortens URLs to hostnames; titles and asks carry it', () => {
    const { values } = resolvePlaybookInputs(audit, null, profile);
    expect(playbookUnitTitle(audit, values)).toBe('Site & funnel audit — joinflowe.com');
    expect(playbookAsk(audit, values)).toBe('Run the site & funnel audit playbook on https://www.joinflowe.com.');
    const teardown = playbookById('teardown')!;
    expect(playbookUnitTitle(teardown, { competitor: 'Linear' })).toBe('Competitor teardown — Linear');
  });
});

describe('the plan template', () => {
  it('fills the approach, appends the fan-out, and carries legs/subtasks/DoD', () => {
    const audit = playbookById('audit')!;
    const plan = playbookPlan(audit, { url: 'https://joinflowe.com' });
    expect(plan.approach).toContain('https://joinflowe.com');
    expect(plan.approach).toContain('messaging · conversion · search · competitive · trust · growth');
    expect(plan.approach).not.toContain('{url}');
    expect(plan.legs).toEqual(['build']);
    expect(plan.definitionOfDone).toContain('Score: NN/100');
    expect(plan.definitionOfDone).toContain('What I couldn’t determine');
  });

  it('the launch plan proposes its asset stack as subtasks', () => {
    const plan = playbookPlan(playbookById('launch')!, { what: 'the companion app' });
    expect(plan.subtasks.length).toBeGreaterThanOrEqual(4);
    expect(plan.approach).toContain('the companion app');
  });
});

describe('the ask round-trip', () => {
  it('playbookFromAsk inverts playbookAsk for every playbook, with or without a subject', () => {
    for (const p of PLAYBOOKS) {
      expect(playbookFromAsk(playbookAsk(p)), p.id).toBe(p.id);
      expect(playbookFromAsk(playbookAsk(p, { [p.inputs[0]?.key ?? 'x']: 'https://joinflowe.com' })), p.id).toBe(p.id);
    }
    expect(playbookFromAsk('Daily post drafts')).toBeNull();
    expect(playbookFromAsk(null)).toBeNull();
  });
});

describe('report identity + per-room state', () => {
  it('identity rides the name contract, with the title as the rename fallback', () => {
    expect(playbookFromReportName(playbookReportName('audit', '2026-08-20T12:00:00Z'))).toBe('audit');
    expect(playbookFromReportName('geo-report-2026-08-20.md')).toBe('geo');
    expect(playbookFromReportName('audit-report.md')).toBe('audit');
    expect(playbookFromReportName('zzz-report.md')).toBeNull();
    expect(playbookFromReportName('business-profile.md')).toBeNull();
    expect(playbookOfReport('renamed.md', 'Site & funnel audit — joinflowe.com')).toBe('audit');
    expect(playbookOfReport('renamed.md', 'Weekly digest')).toBeNull();
  });

  it('derives last/prev score + armed cadence from rows alone', () => {
    const audit = playbookById('audit')!;
    const s = playbookState(
      audit,
      [
        { id: 'a1', name: 'audit-report-2026-07-20.md', created_at: '2026-07-20T00:00:00Z', score: 63 },
        { id: 'a2', name: 'audit-report-2026-08-20.md', created_at: '2026-08-20T00:00:00Z', score: 72 },
        { id: 'g1', name: 'geo-report-2026-08-21.md', created_at: '2026-08-21T00:00:00Z', score: 44 },
      ],
      [{ status: 'active', cadence: 'weekly', payload_playbook: 'audit' }],
    );
    expect(s.lastScore).toBe(72);
    expect(s.prevScore).toBe(63);
    expect(s.lastRunAt).toBe('2026-08-20T00:00:00Z');
    expect(s.armed).toBe('weekly');
    // a paused schedule never reads as armed
    expect(playbookState(audit, [], [{ status: 'paused', cadence: 'weekly', payload_playbook: 'audit' }]).armed).toBeNull();
  });
});

describe('the nmplays block', () => {
  it('round-trips, drops unknown ids, caps at three, and strips out of the prose', () => {
    const block = playbookRecsBlock('ch-1', [
      { id: 'audit', why: 'the number your work moves' },
      { id: 'geo', why: 'who gets cited today' },
      { id: 'nope', why: 'not a playbook' },
    ]);
    const body = `The foundation is in.\n\n${block}\n\nArm what you like.`;
    const recs = parsePlaybookRecs(body)!;
    expect(recs.channel).toBe('ch-1');
    expect(recs.plays.map((p) => p.id)).toEqual(['audit', 'geo']);
    expect(stripPlaybookRecs(body)).toBe('The foundation is in.\n\nArm what you like.');
    expect(parsePlaybookRecs('no block')).toBeNull();
    expect(parsePlaybookRecs('```nmplays\n{"channel":"c","plays":[{"id":"zzz","why":""}]}\n```')).toBeNull();
  });
});
