// Boot-time memory maintenance: NM_EMBED-gated warm + backfill loop. Embedder is
// mocked (no model download); the loop must drain batches until a zero round and
// stay fully inert when the embedder is off.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = { enabled: true, warmMs: 42 as number | null };
vi.mock('../src/embedder', () => ({
  embedderEnabled: () => state.enabled,
  warmEmbedder: async () => (state.enabled ? state.warmMs : null),
  embed: async (texts: string[]) => texts.map(() => new Array(384).fill(0)),
}));

import { startMemoryMaintenance } from '../src/maintenance';

beforeEach(() => {
  state.enabled = true;
  state.warmMs = 42;
});

describe('startMemoryMaintenance', () => {
  it('drains backfill batches until a zero round', async () => {
    const rounds = [
      { messages: 2, facts: 1 },
      { messages: 1, facts: 0 },
      { messages: 0, facts: 0 },
    ];
    const calls: number[] = [];
    const store = {
      backfillEmbeddings: async (batch: number) => {
        calls.push(batch);
        return rounds[Math.min(calls.length - 1, rounds.length - 1)]!;
      },
    };
    startMemoryMaintenance(store);
    await vi.waitFor(() => expect(calls.length).toBe(3), { timeout: 2000 });
    expect(calls.every((b) => b === 32)).toBe(true);
  });

  it('is inert when the embedder is off', async () => {
    state.enabled = false;
    let called = 0;
    startMemoryMaintenance({ backfillEmbeddings: async () => (called++, { messages: 0, facts: 0 }) });
    await new Promise((r) => setTimeout(r, 50));
    expect(called).toBe(0);
  });

  it('stops before backfill when warm-up fails (recall degrades to FTS)', async () => {
    state.warmMs = null;
    let called = 0;
    startMemoryMaintenance({ backfillEmbeddings: async () => (called++, { messages: 0, facts: 0 }) });
    await new Promise((r) => setTimeout(r, 50));
    expect(called).toBe(0);
  });

  it('tolerates a store with no backfill (memory store)', async () => {
    expect(() => startMemoryMaintenance({})).not.toThrow();
    await new Promise((r) => setTimeout(r, 20));
  });
});
