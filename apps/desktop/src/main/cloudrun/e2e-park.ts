// THE END-TO-END PARK WITNESS (NM_E2E_PARK=1, called by machined-e2e.ts after the boot claim). It
// proves on a real Cloud Run machine that a turn parks, the machine sleeps while a human decides, and
// a later boot claims the answer and resumes — through the production gate (`durableApproval`) and
// registry, not a test double. State lives in the work dir, so it rides the drain snapshot:
//
//   <workDir>/.nm-e2e/park.json   {parkId, key, openedEpoch, resolution?, claimedEpoch?, resumedAt?}
//   <workDir>/.nm-e2e/parks.log   one line per resumed park:
//                                 parkId=<id> resolution=<approve|deny> claimedEpoch=<n> openedEpoch=<m>
//
// First boot: no park.json → open ONE approval park (a synthetic request, no card: the e2e driver
// answers it with POST /v1/parks/:id/resolve), wait the hot window, end parked. The park's TTL is the
// registry's (24 h by default), so it is NOT busy and an idle drain still puts the machine to sleep.
// Later boot: the boot claim took the resolution → re-issue the same ask, which applies it exactly as
// a resumed turn does (and marks the park done), then append the witness line.
import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { durableApproval, type DurableApprovalAsk, type ParkRegistry } from './parks';

export interface ParkProbeRecord {
  parkId: string;
  key: string;
  openedEpoch: number;
  resolution?: 'approve' | 'deny';
  claimedEpoch?: number | null;
  resumedAt?: string;
}

export interface ParkProbeOptions {
  workDir: string;
  registry: ParkRegistry;
  /** this incarnation's epoch (lifecycle.epoch) */
  epoch: number;
  log?: (line: string) => void;
  sleep?: (ms: number) => Promise<void>;
}

export type ParkProbeResult =
  | { step: 'opened'; parkId: string }
  | { step: 'resumed'; parkId: string; resolution: 'approve' | 'deny'; claimedEpoch: number | null }
  | { step: 'waiting'; parkId: string }
  | { step: 'done'; parkId: string }
  | { step: 'failed'; error: string };

export const E2E_DIR = '.nm-e2e';
const QUESTION = 'e2e.probe wants to run: end-to-end park witness. Approve?';

export async function runParkProbe(o: ParkProbeOptions): Promise<ParkProbeResult> {
  const log = o.log ?? ((line: string) => console.log(line));
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const dir = join(o.workDir, E2E_DIR);
  const file = join(dir, 'park.json');
  mkdirSync(dir, { recursive: true });
  const ask = (key: string, onParked?: DurableApprovalAsk['onParked']): DurableApprovalAsk => ({
    key, question: QUESTION,
    request: { tool: 'e2e.probe', reason: 'end-to-end park witness' },
    checkpoint: { kind: 'e2e', file: join(E2E_DIR, 'park.json') },
    // no card: the driver answers through the human park route. The message id only has to be a uuid
    postCard: async () => randomUUID(),
    // nothing can answer a card that does not exist: honour the hot window (NM_PARK_HOT_MS), then park
    // (capped at the hot window even when no park could be written: there is no card to wait on)
    awaitAnswer: async (_messageId, ms, stop) => {
      const until = Date.now() + Math.min(ms, o.registry.hotWaitMs);
      while (Date.now() < until && !stop()) await sleep(Math.min(500, Math.max(1, until - Date.now())));
      return null;
    },
    ...(onParked ? { onParked } : {}),
  });

  try {
    if (!existsSync(file)) {
      const key = `e2e:park-witness:${randomUUID()}`;
      let parkId = '';
      const out = await durableApproval(o.registry, ask(key, (park) => {
        parkId = park.id;
        const rec: ParkProbeRecord = { parkId: park.id, key, openedEpoch: o.epoch };
        writeFileSync(file, `${JSON.stringify(rec, null, 2)}\n`);
      }));
      if (!parkId) return { step: 'failed', error: `the probe did not park (${out.decision}${'reason' in out ? `: ${out.reason}` : ''})` };
      log(`[machined] e2e park opened ${parkId}`);
      return { step: 'opened', parkId };
    }

    const rec = JSON.parse(readFileSync(file, 'utf8')) as ParkProbeRecord;
    if (rec.resumedAt) return { step: 'done', parkId: rec.parkId };
    const prior = await o.registry.prior(rec.key);
    if (!prior) {
      log(`[machined] e2e park ${rec.parkId} is gone (done elsewhere or never written)`);
      return { step: 'done', parkId: rec.parkId };
    }
    if ('open' in prior) {
      log(`[machined] e2e park still open ${rec.parkId} (epoch ${o.epoch})`);
      return { step: 'waiting', parkId: rec.parkId };
    }
    // the resumed turn's path: the same ask under the same key applies the claimed resolution and
    // marks the park done, without a card and without a wait
    const claimedEpoch = prior.park.claimedEpoch;
    const out = await durableApproval(o.registry, ask(rec.key));
    const resolution = out.decision === 'allow' ? 'approve' : 'deny';
    appendFileSync(join(dir, 'parks.log'), `parkId=${rec.parkId} resolution=${resolution} claimedEpoch=${claimedEpoch ?? o.epoch} openedEpoch=${rec.openedEpoch}\n`);
    writeFileSync(file, `${JSON.stringify({ ...rec, resolution, claimedEpoch, resumedAt: new Date().toISOString() } satisfies ParkProbeRecord, null, 2)}\n`);
    log(`[machined] e2e park resumed ${rec.parkId} ${resolution}`);
    return { step: 'resumed', parkId: rec.parkId, resolution, claimedEpoch };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    log(`[machined] e2e park probe failed: ${error}`);
    return { step: 'failed', error };
  }
}
