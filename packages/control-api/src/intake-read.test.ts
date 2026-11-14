// The intake read (round 9): the client that birthed a thread holds one request until the decision lands.
import { describe, expect, it } from 'vitest';
import { awaitThreadIntake, type ThreadIntakeRead } from './intake-read';

const row = (intake: boolean): ThreadIntakeRead => ({
  threadId: 't1', kind: intake ? 'coding' : 'chat', workspaceMode: intake ? 'scratch' : null, title: intake ? 'Palindrome checker' : 'build a palindrome html app',
  intake: intake ? { v: 1, kind: 'coding', confidence: 1, title: 'Palindrome checker', name: 'palindrome-checker', plan: ['a', 'b'], subtasks: [], workspace: 'scratch', source: 'starter' } : null,
});

describe('awaitThreadIntake', () => {
  it('answers at once when the decision is there', async () => {
    let reads = 0, wakes = 0;
    const out = await awaitThreadIntake({ read: async () => { reads++; return row(true); }, waitMs: 8000, wake: async () => { wakes++; } });
    expect(out?.intake?.kind).toBe('coding');
    expect([reads, wakes]).toEqual([1, 0]);
  });

  it('reads again after each wake, and returns the moment the decision lands', async () => {
    let at = 0, reads = 0;
    const out = await awaitThreadIntake({ read: async () => row(++reads >= 3), waitMs: 8000, wake: async (ms) => { at += Math.min(ms, 300); }, now: () => at });
    expect(out?.kind).toBe('coding');
    expect(out?.workspaceMode).toBe('scratch');
    expect(reads).toBe(3);
  });

  it('gives up at the deadline with the row as it is, and never waits past it', async () => {
    let at = 0;
    const waits: number[] = [];
    const out = await awaitThreadIntake({ read: async () => row(false), waitMs: 2500, wake: async (ms) => { waits.push(ms); at += ms; }, now: () => at });
    expect(out?.intake).toBeNull();
    expect(waits).toEqual([1000, 1000, 500]);
  });

  it('no wait: one read', async () => {
    let wakes = 0;
    expect((await awaitThreadIntake({ read: async () => row(false), waitMs: 0, wake: async () => { wakes++; } }))?.intake).toBeNull();
    expect(wakes).toBe(0);
  });

  it('no such thread: null at once with waitMs 0, and waits until the deadline when waitMs > 0 (outbox still in flight)', async () => {
    let wakes = 0;
    expect(await awaitThreadIntake({ read: async () => null, waitMs: 0, wake: async () => { wakes++; } })).toBeNull();
    expect(wakes).toBe(0);
    let at = 0, reads = 0;
    const landed = await awaitThreadIntake({
      read: async () => (++reads === 1 ? null : reads === 2 ? row(false) : row(true)),
      waitMs: 8000,
      wake: async (ms) => { at += Math.min(ms, 200); },
      now: () => at,
    });
    expect(landed?.intake?.kind).toBe('coding');
    expect(reads).toBe(3);
  });
});
