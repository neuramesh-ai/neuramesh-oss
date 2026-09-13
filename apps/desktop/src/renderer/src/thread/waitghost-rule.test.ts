// WHAT A THREAD SAYS BETWEEN YOUR MESSAGE AND THE ANSWER.
//
// The orb exists because silence is the same shape as failure: a person who sends a message and
// sees nothing cannot tell "nothing is happening" from "something is happening you cannot see".
// But an orb that shows when nothing is actually coming is the same lie in the other direction,
// so every condition here removes a way to cry wolf.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { PROGRESS, responderFor, STALLED, THINKING, waitGhostFor, type WaitTask } from './waitghost-rule';
import { WAIT_LIMIT_MS } from '@neuramesh/shared';
import type { AgentRow } from '../bridge/rows-crew';

const rex = { id: 'a1', name: 'rex', role: 'orchestrator', channel_ids: 'c1,c2' } as AgentRow;
const dev = { id: 'a2', name: 'patch', role: 'developer', channel_ids: 'c1' } as AgentRow;
const human = [{ author_kind: 'human' as const }];
const answered = [{ author_kind: 'human' as const }, { author_kind: 'agent' as const }];

/** the machine rung, as it was called before the ladder grew around it */
const machineGhostFor = (
  rows: { author_kind: string; body?: string }[], agents: AgentRow[], channelId: string, machine: string | undefined,
) => {
  const g = waitGhostFor({ rows, agents, channelId, machine: machine as never });
  return g && g.line !== THINKING ? { agent: g.agent, progress: g.line, stalled: g.stalled } : null;
};

describe('when the thread may say it is waiting on a machine', () => {
  test('a human spoke last and the machine is coming up — the case the orb is for', () => {
    const r = machineGhostFor(human, [rex], 'c1', 'waking');
    assert.equal(r?.agent.name, 'rex');
    assert.match(r!.progress, /Starting the cloud machine/i);
  });

  test('an ANSWERED thread says nothing — it is not waiting on anything', () => {
    assert.equal(machineGhostFor(answered, [rex], 'c1', 'waking'), null);
  });

  test('online hands the machine line over: the wait is the AGENT now, not the box', () => {
    assert.equal(machineGhostFor(human, [rex], 'c1', 'online'), null);
  });

  test('capped says nothing here — that has a card, which says far more than an orb', () => {
    assert.equal(machineGhostFor(human, [rex], 'c1', 'capped'), null);
  });

  test('a room with NO agent says nothing — a machine coming up would change nothing', () => {
    assert.equal(machineGhostFor(human, [rex], 'c9', 'waking'), null);
    assert.equal(machineGhostFor(human, [], 'c1', 'waking'), null);
  });

  test('the face is the orchestrator when one is here, because that is who the wake picks', () => {
    assert.equal(machineGhostFor(human, [dev, rex], 'c1', 'waking')?.agent.name, 'rex');
    // …and whoever IS here otherwise, rather than nothing
    assert.equal(machineGhostFor(human, [dev], 'c1', 'waking')?.agent.name, 'patch');
  });

  test('asleep and unreachable each get their own words, never a generic spinner', () => {
    assert.match(machineGhostFor(human, [rex], 'c1', 'asleep')!.progress, /Waking the cloud machine/i);
    assert.match(machineGhostFor(human, [rex], 'c1', 'unreachable')!.progress, /answer/i);
  });
});

describe('a machine that cannot start must not look like one that is starting', () => {
  test('out of credits says so, and is marked STALLED so no spinner is drawn', () => {
    const g = machineGhostFor(human, [rex], 'c1', 'no_credits');
    assert.ok(g);
    assert.equal(g.stalled, true);
    assert.match(g.progress, /No credits/i);
    // the exact lie that was on screen: an asleep machine's copy, under a spinner, forever
    assert.doesNotMatch(g.progress, /waking/i);
  });

  test('the states that ARE moving stay unstalled — the orb still belongs to them', () => {
    for (const s of ['waking', 'asleep', 'unreachable'] as const) {
      assert.equal(machineGhostFor(human, [rex], 'c1', s)?.stalled, false, s);
      assert.equal(STALLED[s], undefined, s);
    }
  });

  test('every PROGRESS entry is reachable — a status with copy nobody can see is dead weight', () => {
    for (const k of Object.keys(PROGRESS)) {
      assert.ok(machineGhostFor(human, [rex], 'c1', k as never), k);
    }
  });
});

// ── The rung this module grew for (2026-09-09) ──────────────────────────────────────────────
// The machine is UP and there is still nothing to show, because the wake has to reach the runner
// and its `thinking` status has to come back. On the browser that is two PowerSync round trips
// with no local stream to short-circuit them, so the thread sat blank for seconds after every
// send and read as broken.
describe('the machine is up and the answer has not started', () => {
  test('a fresh message gets the orb AND the name of who takes it — the whole point', () => {
    const g = waitGhostFor({ rows: human, agents: [rex], channelId: 'c1', machine: 'online' });
    assert.equal(g?.line, THINKING);
    assert.equal(g?.stalled, false);
    assert.equal(g?.agent.name, 'rex');
  });

  test('and it makes no second line — the orb and the name already said it', () => {
    assert.equal(waitGhostFor({ rows: human, agents: [rex], channelId: 'c1', machine: 'online' })?.note, undefined);
  });

  test('the machine still outranks it: one wait, and the specific words win', () => {
    assert.match(waitGhostFor({ rows: human, agents: [rex], channelId: 'c1', machine: 'asleep' })!.line, /Waking/i);
  });

  test('an answered thread is silent here too — this is a WAIT, not a status light', () => {
    assert.equal(waitGhostFor({ rows: answered, agents: [rex], channelId: 'c1', machine: 'online' }), null);
  });

  test('an unknown machine state still gets the orb: not knowing about the box says nothing about the wake', () => {
    assert.equal(waitGhostFor({ rows: human, agents: [rex], channelId: 'c1', machine: undefined })?.line, THINKING);
  });

  test('a named teammate wears the orb, because naming somebody is what the wake reads', () => {
    const named = [{ author_kind: 'human', body: 'hey @patch can you look' }];
    assert.equal(waitGhostFor({ rows: named, agents: [rex, dev], channelId: 'c1', machine: 'online' })?.agent.name, 'patch');
    // a bare name in LEADING position summons too — the same matcher the daemon uses
    assert.equal(
      waitGhostFor({ rows: [{ author_kind: 'human', body: 'patch can you look' }], agents: [rex, dev], channelId: 'c1', machine: 'online' })?.agent.name,
      'patch',
    );
    // …and mid-sentence it is conversation, not a summons, so the orchestrator keeps the row
    assert.equal(
      waitGhostFor({ rows: [{ author_kind: 'human', body: 'can patch look at it?' }], agents: [rex, dev], channelId: 'c1', machine: 'online' })?.agent.name,
      'rex',
    );
  });
});

// A wake that dies is synced truth. Without this rung the fix above would be WORSE than the dead
// air it removes: an orb spinning behind a failure, until the thread is closed.
describe('a wake that died stops the orb', () => {
  const failed = { agent_id: 'a2', state: 'failed', summary: 'starter brain unavailable (503)' };

  test('the run’s own words, and no orb — a reason invented here would be a second story', () => {
    const g = waitGhostFor({ rows: human, agents: [rex, dev], channelId: 'c1', machine: 'online', run: failed });
    assert.equal(g?.line, 'starter brain unavailable (503)');
    assert.equal(g?.stalled, true);
    assert.equal(g?.agent.name, 'patch'); // whoever actually died, not who we expected to answer
  });

  test('a failure with no words still says something rather than spinning', () => {
    const g = waitGhostFor({ rows: human, agents: [rex], channelId: 'c1', machine: 'online', run: { agent_id: null, state: 'failed', summary: null } });
    assert.match(g!.line, /did not start/i);
    assert.equal(g!.stalled, true);
  });

  test('a RUNNING run does not stop it — that is the wait, not the end of it', () => {
    const g = waitGhostFor({ rows: human, agents: [rex], channelId: 'c1', machine: 'online', run: { agent_id: 'a1', state: 'running', summary: null } });
    assert.equal(g?.line, THINKING);
  });

  test('the failure outranks the machine line: what died beats what is booting', () => {
    assert.match(waitGhostFor({ rows: human, agents: [rex, dev], channelId: 'c1', machine: 'asleep', run: failed })!.line, /503/);
  });
});

// One live surface per agent (docs/29 §4). A run CARD narrates the same agent with far more
// truth, so an orb beside it is the agent reported twice — caught by a task-thread capture on the
// day this rung landed, where patch had an open card and a wait ghost at once.
describe('an agent already narrating itself keeps its one surface', () => {
  test('a carded agent draws no ghost', () => {
    assert.equal(waitGhostFor({ rows: human, agents: [rex], channelId: 'c1', machine: 'online', carded: new Set(['a1']) }), null);
  });

  test('…and somebody ELSE having a card changes nothing', () => {
    assert.equal(waitGhostFor({ rows: human, agents: [rex], channelId: 'c1', machine: 'online', carded: new Set(['a2']) })?.line, THINKING);
  });

  test('the machine rung obeys it too — one agent, one surface, at every stage', () => {
    assert.equal(waitGhostFor({ rows: human, agents: [rex], channelId: 'c1', machine: 'waking', carded: new Set(['a1']) }), null);
  });
});

// A conversation can always be answered. A task cannot — `unaddressedWake` is the wake's own
// policy, and the orb has to read it or it promises replies nobody will send.
describe('a task thread promises only what the wake path delivers', () => {
  const task = (state: string, extra: Partial<WaitTask> = {}): WaitTask => ({ state, assignee_kind: 'agent', assignee_id: 'a2', ...extra });
  const ghost = (t: WaitTask, rows: Array<{ author_kind: string; body?: string }> = human) =>
    waitGhostFor({ rows, agents: [rex, dev], channelId: 'c1', machine: 'online', task: t });

  test('intake goes to the orchestrator, live work to the agent holding it', () => {
    assert.equal(ghost(task('todo'))?.agent.name, 'rex');
    assert.equal(ghost(task('in_progress'))?.agent.name, 'patch');
    assert.equal(ghost(task('designing'))?.agent.name, 'patch');
  });

  test('a SETTLED task draws no orb, because a reply there wakes nobody', () => {
    for (const s of ['in_review', 'done', 'accepted', 'closed', 'backlog']) {
      assert.equal(ghost(task(s)), null, s);
    }
  });

  test('…unless it names somebody, which is exactly what makes it answerable', () => {
    const named = [{ author_kind: 'human', body: '@patch one more tweak please' }];
    assert.equal(ghost(task('in_review'), named)?.agent.name, 'patch');
  });

  test('a task whose assignee left the room falls silent rather than guessing', () => {
    assert.equal(waitGhostFor({ rows: human, agents: [rex], channelId: 'c1', machine: 'online', task: task('in_progress') }), null);
  });

  test('a HUMAN assignee is nobody to wake — the orb is for agents', () => {
    assert.equal(ghost(task('in_progress', { assignee_kind: 'human', assignee_id: 'u1' })), null);
  });

  test('the machine rung obeys the same gate: a settled task waits on nothing', () => {
    assert.equal(waitGhostFor({ rows: human, agents: [rex, dev], channelId: 'c1', machine: 'waking', task: task('done') }), null);
  });
});

// George, 2026-09-09: "add a bounded time to the thinking state, if no response for up to x
// minutes, then it should show an error and user can retry". The bound is on a PROVABLE absence,
// not on elapsed time alone: both wake paths open a `runs` row before they do any work.
describe('the wait gives up honestly', () => {
  const NOW = Date.parse('2026-09-09T12:00:00Z');
  const at = (ms: number) => [{ author_kind: 'human', created_at: new Date(NOW - ms).toISOString() }];
  const ghost = (ms: number, run?: { agent_id: string | null; state: string; summary: string | null } | null) =>
    waitGhostFor({ rows: at(ms), agents: [rex], channelId: 'c1', machine: 'online', now: NOW, ...(run ? { run } : {}) });

  test('inside the deadline it still promises — the orb, and who takes it', () => {
    const g = ghost(WAIT_LIMIT_MS - 1000);
    assert.equal(g?.kind, 'thinking');
    assert.equal(g?.stalled, false);
  });

  test('past it, the orb goes and the row states the fact', () => {
    const g = ghost(WAIT_LIMIT_MS);
    assert.equal(g?.kind, 'timeout');
    assert.equal(g?.stalled, true);
    assert.match(g!.line, /No answer for 2 minutes\./);
    assert.equal(g?.agent.name, 'rex'); // still named, so the retry has a face
  });

  test('A RUNNING RUN KEEPS THE ORB, however long it takes — the bound is on nothing having started', () => {
    const g = ghost(45 * 60_000, { agent_id: 'a1', state: 'running', summary: null });
    assert.equal(g?.kind, 'thinking');
    assert.equal(g?.stalled, false);
  });

  test('a run that ended keeps it too — that answer is landing, not missing', () => {
    assert.equal(ghost(45 * 60_000, { agent_id: 'a1', state: 'done', summary: null })?.kind, 'thinking');
  });

  test('a dead run outranks the deadline: its own words beat our count', () => {
    const g = ghost(45 * 60_000, { agent_id: 'a1', state: 'failed', summary: 'starter brain unavailable (503)' });
    assert.equal(g?.kind, 'dead');
    assert.match(g!.line, /503/);
  });

  test('the machine outranks it too — a box that is not up is the more specific truth', () => {
    const g = waitGhostFor({ rows: at(45 * 60_000), agents: [rex], channelId: 'c1', machine: 'waking', now: NOW });
    assert.equal(g?.kind, 'machine');
  });

  test('NO CLOCK, NO DEADLINE: a caller that does not tick keeps the old unbounded behaviour', () => {
    assert.equal(waitGhostFor({ rows: at(6 * 3600_000), agents: [rex], channelId: 'c1', machine: 'online' })?.kind, 'thinking');
  });

  test('a message with no timestamp never times out', () => {
    const g = waitGhostFor({ rows: [{ author_kind: 'human' }], agents: [rex], channelId: 'c1', machine: 'online', now: NOW });
    assert.equal(g?.kind, 'thinking');
  });

  test('and a settled task still says nothing at all, deadline or not', () => {
    const g = waitGhostFor({ rows: at(45 * 60_000), agents: [rex, dev], channelId: 'c1', machine: 'online', now: NOW, task: { state: 'done' } });
    assert.equal(g, null);
  });
});

describe('responderFor is the one answer to "who takes this"', () => {
  test('a conversation always has one: the orchestrator, then whoever is here', () => {
    assert.equal(responderFor('', [dev, rex], 'c1')?.name, 'rex');
    assert.equal(responderFor('', [dev], 'c1')?.name, 'patch');
    assert.equal(responderFor('', [], 'c1'), null);
  });

  test('a task asks the wake policy instead, so the two can never drift', () => {
    assert.equal(responderFor('', [rex, dev], 'c1', { state: 'plan_review' })?.name, 'rex');
    assert.equal(responderFor('', [rex, dev], 'c1', { state: 'done' }), null);
    // a content task is its conversation, even in_review (docs/16 §4.5)
    assert.equal(responderFor('', [rex, dev], 'c1', { state: 'in_review', kind: 'content', assignee_kind: 'agent', assignee_id: 'a2' })?.name, 'patch');
  });
});
