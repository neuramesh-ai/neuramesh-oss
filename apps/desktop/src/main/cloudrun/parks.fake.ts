// A test double for control-api's machine park routes (machine-parks.ts), shared by parks.test.ts and
// e2e-park.test.ts. Not a test file itself (no `.test.`), so the runner never executes it alone.
import type { Park, ParkApi, ParkCreate } from './parks';
import { EpochFencedError } from './snapshot';

/** control-api's park lifecycle in memory, with the epoch fence: open → resolved → claimed → done */
export class FakeServer {
  epoch = 1;
  parks = new Map<string, Park>();
  calls: string[] = [];
  private seq = 0;
  now = 1_000_000;
  apiFor(epoch: number): ParkApi {
    const fence = () => { if (epoch !== this.epoch) throw new EpochFencedError(`epoch ${epoch} is behind ${this.epoch}`); };
    const find = (id: string) => { const p = this.parks.get(id); if (!p) throw new Error('HTTP 404'); return p; };
    return {
      create: async (c: ParkCreate) => {
        fence();
        this.calls.push(`create ${c.key}`);
        const live = [...this.parks.values()].find((p) => p.key === c.key && p.status !== 'done');
        if (live) return { created: false, park: { ...live } };
        const park: Park = {
          id: `p${++this.seq}`, key: c.key, kind: c.kind, status: 'open', resolution: null,
          expiresAt: new Date(this.now + (c.ttlMs ?? 86_400_000)).toISOString(), messageId: c.messageId ?? null, question: c.question ?? null,
          taskId: c.taskId ?? null, threadId: c.threadId ?? null, request: c.request, checkpoint: c.checkpoint, claimedEpoch: null,
        };
        this.parks.set(park.id, park);
        return { created: true, park: { ...park } };
      },
      // reads are fenced too: a replaced token earns 409 STALE_EPOCH at the bearer (machineFromBearer)
      byKey: async (key) => { fence(); const p = [...this.parks.values()].find((x) => x.key === key && x.status !== 'done'); return p ? { ...p } : null; },
      claimable: async () => { fence(); return [...this.parks.values()].filter((p) => p.status === 'resolved' || p.status === 'expired' || (p.status === 'claimed' && (p.claimedEpoch ?? 0) < this.epoch)).map((p) => ({ ...p })); },
      open: async () => { fence(); return [...this.parks.values()].filter((p) => p.status === 'open').map((p) => ({ ...p })); },
      claim: async (id) => {
        fence();
        const p = find(id);
        const ok = p.status === 'resolved' || p.status === 'expired' || (p.status === 'claimed' && (p.claimedEpoch ?? 0) <= epoch);
        if (!ok) throw new Error(`HTTP 409 CONFLICT (${p.status})`);
        p.status = 'claimed'; p.claimedEpoch = epoch;
        this.calls.push(`claim ${id} e${epoch}`);
        return { ...p };
      },
      done: async (id, resolution) => {
        fence();
        const p = find(id);
        p.status = 'done'; p.resolution = p.resolution ?? resolution ?? null;
        this.calls.push(`done ${id}`);
        return { ...p };
      },
      resolve: async (id, resolution) => {
        fence();
        const p = find(id);
        if (p.status !== 'open') throw new Error('HTTP 409 CONFLICT');
        p.status = 'resolved'; p.resolution = resolution;
        return { ...p };
      },
    };
  }
  /** the human answers (decision.answer, a reply line, POST /v1/parks/:id/resolve) */
  answer(id: string, answer: string): void {
    const p = this.parks.get(id)!;
    p.status = 'resolved';
    p.resolution = { answer, approved: answer === 'Approve', source: 'human' };
  }
  expire(id: string): void {
    const p = this.parks.get(id)!;
    p.status = 'expired';
    p.resolution = { answer: null, approved: false, reason: 'timeout', source: 'expiry' };
  }
}
