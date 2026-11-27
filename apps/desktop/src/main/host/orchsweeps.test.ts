// ONE SWEEPER PER TICK (orchsweeps.ts claimTick). Shared compute hosts every agent on every machine of a
// workspace, so without a claim each machine ran the same orchestrator sweep (r6: three machines flagged
// the same stalled task after a team reshape). Two hosts over one shared claim set stand in for two
// machines over Postgres' insert-if-absent: only one sweeps a tick, the next bucket is claimable again,
// a failed claim read still sweeps, and a host with no shared store sweeps as before.
// Run: pnpm exec tsx --test src/main/host/orchsweeps.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeOrchSweeps, sweepTickKey } from './orchsweeps';

const CH = { id: 'ch-1', slug: 'general', workspace_id: 'ws-1' };

/** one host: its sweep, and how many channel passes it ran (the routine resume runs once per pass) */
function host(claimTick?: (key: string) => Promise<boolean>) {
  let passes = 0;
  const db = {
    getAll: async (sql: string) => (/join agent_channels/.test(sql) ? [CH] : []),
    get: async () => null,
  };
  const ctx = {
    db, post: async () => new Response('{}'), claimed: { has: () => false },
    agents: new Map([['o-1', { id: 'o-1', name: 'rex', role: 'orchestrator', model: 'm', runtime: 'gemini', brief: null, modelSource: null, channels: new Set([CH.id]) }]]),
    guards: { firedStalls: new Set(), sweptSummaries: new Set(), monitorSince: new Map(), designed: new Set(), planned: new Set(), reviewed: new Set() },
    apiUrl: 'http://api', ownerActorId: 'u-1', startedAt: new Date(0).toISOString(),
    buildOrchestratorTools: () => ({}), SUMMARY_MARKER: {}, sweepPeriod: () => null, summaryPostedToday: async () => true,
    channelMonitorSignals: async () => ({}), sweepTranscript: async () => '', dispatchOrchestrator: async () => '', discoverSkills: async () => [],
    arun: () => ({ log: () => {}, runId: 'r' }),
    resumeStrandedRoutines: async () => { passes += 1; },
    ...(claimTick ? { claimTick } : {}),
    tickMs: { full: 15 * 60_000, watchdog: 5 * 60_000 },
  };
  const { runOrchestratorSweeps } = makeOrchSweeps(ctx as unknown as Parameters<typeof makeOrchSweeps>[0]);
  return { run: runOrchestratorSweeps, passes: () => passes };
}

/** Postgres' insert-if-absent, as the machines of one workspace share it */
function sharedClaims() {
  const taken = new Set<string>();
  return { taken, claim: async (key: string) => { if (taken.has(key)) return false; taken.add(key); return true; } };
}

test('the tick key names the orchestrator, the channel, the cadence and the wall-clock bucket', () => {
  assert.equal(sweepTickKey('o-1', 'ch-1', 'watchdog', 10 * 60_000 + 5, 5 * 60_000), 'orch-sweep:o-1/ch-1/watchdog/2');
  assert.equal(sweepTickKey('o-1', 'ch-1', 'full', 10 * 60_000 + 5, 15 * 60_000), 'orch-sweep:o-1/ch-1/full/0');
  // two machines whose own timers fire a minute apart inside one bucket agree on the key
  assert.equal(sweepTickKey('o-1', 'ch-1', 'watchdog', 11 * 60_000, 5 * 60_000), sweepTickKey('o-1', 'ch-1', 'watchdog', 12 * 60_000, 5 * 60_000));
});

test('three machines over one shared claim: only one sweeps the tick', async () => {
  const shared = sharedClaims();
  const hosts = [host(shared.claim), host(shared.claim), host(shared.claim)];
  await Promise.all(hosts.map((h) => h.run('watchdog')));
  assert.equal(hosts.reduce((n, h) => n + h.passes(), 0), 1);
  assert.equal(shared.taken.size, 1);
  assert.match([...shared.taken][0]!, /^orch-sweep:o-1\/ch-1\/watchdog\/\d+$/);
  // the full pass is its own tick: one of them sweeps that too
  await Promise.all(hosts.map((h) => h.run('full')));
  assert.equal(hosts.reduce((n, h) => n + h.passes(), 0), 2);
});

test('a claim that cannot be read still sweeps, and a host with no shared store sweeps as before', async () => {
  const broken = host(async () => { throw new Error('the API is down'); });
  await broken.run('watchdog');
  assert.equal(broken.passes(), 1);
  const a = host(); const b = host();
  await Promise.all([a.run('watchdog'), b.run('watchdog')]);
  assert.equal(a.passes() + b.passes(), 2);
});
