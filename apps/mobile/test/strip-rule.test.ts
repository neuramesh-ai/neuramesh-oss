// The phone's wait ladder. Every rung removes a way to cry wolf, and the two ends are the ones
// that matter: silence is the same shape as failure, and an orb that spins behind nothing is the
// same lie in the other direction.
import { describe, expect, it } from 'vitest';
import { WAIT_LIMIT_MS, WAIT_THINKING } from '@neuramesh/shared';
import { stripLineFor, type StripAgent } from '../src/strip-rule';

const NOW = Date.parse('2026-09-09T12:00:00Z');
const ago = (ms: number) => NOW - ms;
const iso = (ms: number) => new Date(NOW - ms).toISOString();

const rex: StripAgent = { id: 'a1', name: 'rex', emoji: '🦊', role: 'orchestrator', status: 'online' };
const patch: StripAgent = { id: 'a2', name: 'patch', emoji: null, role: 'developer', status: 'online' };

const line = (over: Partial<Parameters<typeof stripLineFor>[0]> = {}) =>
  stripLineFor({ crew: [rex, patch], awaitingAtMs: ago(10_000), pending: 0, run: null, machine: 'online', now: NOW, ...over });

describe('the ladder, top down', () => {
  it('1 — an agent that IS thinking outranks everything', () => {
    const l = line({ crew: [{ ...rex, status: 'thinking' }, patch], awaitingAtMs: ago(6 * 3600_000) });
    expect(l).toMatchObject({ rung: 'working', who: '🦊 rex', verb: WAIT_THINKING, still: false });
  });

  it("…but 'working' is a claimed task elsewhere and must never present itself as this answer", () => {
    expect(line({ crew: [{ ...patch, status: 'working' }] })?.rung).toBe('waiting');
  });

  it('2 — a send still in the upload queue speaks before any of it', () => {
    expect(line({ pending: 1 })?.rung).toBe('unsent');
  });

  it('3 — a wake that died says so in its OWN words, with no orb', () => {
    const l = line({ run: { agent_id: 'a2', state: 'failed', summary: 'starter brain unavailable (503)', started_at: iso(5_000) } });
    expect(l).toMatchObject({ rung: 'dead', who: 'patch', verb: 'starter brain unavailable (503)', still: true, warn: true });
  });

  it('4 — a machine that is not up gets its own words, in the desktop’s copy', () => {
    expect(line({ machine: 'waking' })).toMatchObject({ rung: 'machine', still: false });
    expect(line({ machine: 'no_credits' })).toMatchObject({ rung: 'machine', still: true });
  });

  it('6 — otherwise the orb, and who takes it', () => {
    expect(line()).toMatchObject({ rung: 'waiting', who: '🦊 rex', verb: WAIT_THINKING, still: false, retry: false });
  });

  it('an ANSWERED thread says nothing at all', () => {
    expect(line({ awaitingAtMs: null })).toBe(null);
  });

  it('a room with nobody in it says nothing either — the orb would promise a reply from no one', () => {
    expect(line({ crew: [] })).toBe(null);
  });
});

// George, 2026-09-09: "add a bounded time to the thinking state, if no response for up to x
// minutes, then it should show an error and user can retry".
describe('5 — the deadline', () => {
  it('inside it, the orb still promises', () => {
    expect(line({ awaitingAtMs: ago(WAIT_LIMIT_MS - 1000) })?.rung).toBe('waiting');
  });

  it('past it, the orb goes and a retry appears', () => {
    const l = line({ awaitingAtMs: ago(WAIT_LIMIT_MS) });
    expect(l).toMatchObject({ rung: 'timeout', still: true, warn: true, retry: true });
    expect(l?.verb).toBe('No answer for 2 minutes.');
  });

  it('A RUNNING RUN KEEPS THE ORB, however long it takes — the bound is on nothing having started', () => {
    const l = line({ awaitingAtMs: ago(45 * 60_000), run: { agent_id: 'a1', state: 'running', summary: null, started_at: iso(44 * 60_000) } });
    expect(l?.rung).toBe('waiting');
  });

  it('a run that started BEFORE the message does not count — that answer was to something else', () => {
    const l = line({ awaitingAtMs: ago(5 * 60_000), run: { agent_id: 'a1', state: 'running', summary: null, started_at: iso(20 * 60_000) } });
    expect(l?.rung).toBe('timeout');
  });

  it('…and a failure the human already answered by writing again cannot outrank the fresh wake', () => {
    const l = line({ awaitingAtMs: ago(10_000), run: { agent_id: 'a1', state: 'failed', summary: 'died', started_at: iso(20 * 60_000) } });
    expect(l?.rung).toBe('waiting');
  });

  it('the machine outranks the deadline: a box that is not up is the more specific truth', () => {
    expect(line({ awaitingAtMs: ago(45 * 60_000), machine: 'asleep' })?.rung).toBe('machine');
  });

  it('only the deadline rung offers a retry', () => {
    for (const l of [line(), line({ pending: 1 }), line({ machine: 'waking' })]) expect(l?.retry).toBe(false);
  });
});
