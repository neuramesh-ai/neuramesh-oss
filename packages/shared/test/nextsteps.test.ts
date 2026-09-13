// Next-step cards (marketing-os §13): the shape guard + block round-trip.
import { describe, expect, it } from 'vitest';
import { NEXT_STEPS_CAP, cleanNextItems, nextStepsBlock, parseNextSteps, stripNextSteps } from '../src/nextsteps';

describe('cleanNextItems — the distill trusts nothing', () => {
  it('drops junk, clamps lengths, caps the list, defaults per-kind fields', () => {
    const items = cleanNextItems([
      { kind: 'task', title: 'Add JSON-LD to the homepage', taskKind: 'chore', why: 'w'.repeat(500) },
      { kind: 'routine', title: 'Weekly re-measure', cadence: 'weekly' },
      { kind: 'research', title: 'Why Fathom wins' },
      { kind: 'nope', title: 'bad kind' },
      { title: 'no kind' },
      null,
      ...Array(50).fill({ kind: 'task', title: 'filler' }),
    ]);
    expect(items.length).toBe(NEXT_STEPS_CAP);
    expect(items[0]!.taskKind).toBe('chore');
    expect(items[0]!.why!.length).toBe(140);
    expect(items[1]!.weekday).toBe(1);
    expect(items[1]!.atTime).toBe('09:00');
    expect(items[1]!.prompt).toBe('Weekly re-measure');
    expect(items[2]!.opener).toBe('Why Fathom wins');
  });
  it('an unknown taskKind lands as research, never as a crash or a passthrough', () => {
    expect(cleanNextItems([{ kind: 'task', title: 't', taskKind: 'setup' }])[0]!.taskKind).toBe('research');
  });
});

describe('the nmnext block round-trip', () => {
  const data = {
    report: 'geo-report-2026-08-21.md', channel: 'ch1', anchor: { taskId: 'task1' },
    picked: 1, total: 9,
    items: [{ kind: 'task' as const, title: 'Fix the hero', src: 'Fix these first · #1' }],
  };
  it('parses what it writes; prose survives the strip', () => {
    const body = `Here's what I'd do:\n\n${nextStepsBlock(data)}`;
    const parsed = parseNextSteps(body)!;
    expect(parsed.report).toBe(data.report);
    expect(parsed.anchor).toEqual({ taskId: 'task1' });
    expect(parsed.items[0]!.title).toBe('Fix the hero');
    expect(stripNextSteps(body)).toBe("Here's what I'd do:");
  });
  it('a block with no valid items parses as null — no empty card ever renders', () => {
    expect(parseNextSteps(nextStepsBlock({ ...data, items: [] }))).toBeNull();
    expect(parseNextSteps('no block here')).toBeNull();
  });
});
