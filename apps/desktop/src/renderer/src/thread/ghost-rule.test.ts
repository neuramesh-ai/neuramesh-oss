// WHO IS WORKING ON THIS SURFACE — and, just as much, who is not.
//
// The orb is an attribution: "this agent is answering HERE". An agent's synced status cannot make
// that claim, because `agents.status` is one column per agent and `thinking` is true in every
// room at once. The bugs this file was written for (George, 2026-09-18): a wake served by a cloud
// machine lit the orb in every open conversation, because the only thread scoping the surface had
// was the local token stream, and a wake on another machine never emits one here — and a task
// thread wore its assignee's orb while the assignee worked another task on another machine, for
// the same reason with the same map.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ghostPick, workingHere, type GhostMachine, type GhostRun } from './ghost-rule';
import type { AgentRow } from '../bridge/rows-crew';

const now = () => new Date().toISOString();
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

const laptop: GhostMachine = { id: 'm-laptop', last_seen_at: now() };
const cloud: GhostMachine = { id: 'm-cloud', last_seen_at: now() };
const machines = [laptop, cloud];

/** rex, registered on the laptop (provenance), thinking somewhere */
const rex = { id: 'a1', name: 'rex', role: 'orchestrator', status: 'thinking', machine_id: 'm-laptop', channel_ids: 'c1,c2' } as AgentRow;
const iris = { id: 'a2', name: 'iris', role: 'designer', status: 'thinking', machine_id: 'm-laptop', channel_ids: 'c1' } as AgentRow;
/** patch, the developer: `working` is what a claimed task holds, not `thinking` */
const patch = { id: 'a3', name: 'patch', role: 'developer', status: 'working', machine_id: 'm-laptop', channel_ids: 'c1' } as AgentRow;
const idle = { ...rex, status: 'online' } as AgentRow;

/** a run row as the daemon opens it before any work: the surface it belongs to, and where it runs */
const run = (o: Partial<GhostRun>): GhostRun => ({
  thread_id: null, task_id: null, agent_id: 'a1', state: 'running', started_at: now(), machine_id: 'm-cloud', ...o,
});
const wake = (thread_id: string, o: Partial<GhostRun> = {}) => run({ thread_id, ...o });
const work = (task_id: string, o: Partial<GhostRun> = {}) => run({ task_id, agent_id: 'a3', ...o });

const here = (o: Partial<Parameters<typeof workingHere>[0]>) =>
  workingHere({ agents: [rex, iris, patch], machines, where: { threadId: 'tA' }, runs: [], stream: null, ...o }).map((a) => a.name);

describe('the cross-machine rung: the synced run says WHICH thread', () => {
  test('a cloud wake in thread B is NOT working in thread A — the reported bug', () => {
    assert.deepEqual(here({ where: { threadId: 'tA' }, runs: [wake('tB')] }), []);
  });

  test('…and it IS working in thread B, on the strength of the same row', () => {
    assert.deepEqual(here({ where: { threadId: 'tB' }, runs: [wake('tB')] }), ['rex']);
  });

  test('a thinking agent with no run anywhere claims no thread: status alone is not attribution', () => {
    // (the wait ghost holds the row while the human's message is newest — this rule says nothing)
    assert.deepEqual(here({ runs: [] }), []);
  });

  test('a settled run is history, however fresh', () => {
    assert.deepEqual(here({ runs: [wake('tA', { state: 'done' })] }), []);
    assert.deepEqual(here({ runs: [wake('tA', { state: 'failed' })] }), []);
  });

  test('an open run whose agent has already gone quiet does not spin: the status gate stays', () => {
    // an unsettled row on a settled agent would otherwise be an eternal orb on every machine
    assert.deepEqual(here({ agents: [idle], runs: [wake('tA')] }), []);
  });

  test('liveness is the machine SERVING the run, not the one the agent was registered on', () => {
    // rex is registered on the laptop (0114: provenance only); the cloud box serving this wake is gone
    const dead = [laptop, { id: 'm-cloud', last_seen_at: ago(10 * 60_000) }];
    assert.deepEqual(here({ machines: dead, runs: [wake('tA')] }), []);
    // …and a row with no machine on it (older rows) falls back to the agent's own machine
    assert.deepEqual(here({ machines: dead, runs: [wake('tA', { machine_id: null })] }), ['rex']);
  });

  test('two agents in one thread: newest run first, each named once', () => {
    const runs = [
      wake('tA', { agent_id: 'a1', started_at: ago(5000) }),
      wake('tA', { agent_id: 'a2', started_at: ago(1000) }),
      wake('tA', { agent_id: 'a2', started_at: ago(500) }), // a second row for iris says nothing new
    ];
    assert.deepEqual(here({ runs }), ['iris', 'rex']);
  });
});

describe('the same rung, keyed to a TASK: the assignee is not the answer, the run is', () => {
  test("the assignee's work run on ANOTHER task does not put it in this one — the task-thread bug", () => {
    // patch is `working`, and the only open row is #1046's; #1042 is done and shows nothing
    assert.deepEqual(here({ where: { taskId: 'tk-1042' }, runs: [work('tk-1046')] }), []);
  });

  test('…and the run names the task it IS on, with `working` passing the gate as `thinking` does', () => {
    assert.deepEqual(here({ where: { taskId: 'tk-1046' }, runs: [work('tk-1046')] }), ['patch']);
  });

  test("a wake answering IN a task thread counts there — rex on the cloud, in someone else's task", () => {
    // patch's execution has been running for a while; rex's wake is the newer row, so rex leads
    const runs = [work('tk-1046', { started_at: ago(60_000) }), run({ task_id: 'tk-1046', agent_id: 'a1', started_at: ago(200) })];
    assert.deepEqual(here({ where: { taskId: 'tk-1046' }, runs }), ['rex', 'patch']);
  });

  test("a task's runs never leak into a conversation, nor a conversation's into a task", () => {
    assert.deepEqual(here({ where: { threadId: 'tA' }, runs: [work('tk-1046')] }), []);
    assert.deepEqual(here({ where: { taskId: 'tk-1046' }, runs: [wake('tA')] }), []);
  });
});

describe('the local rung: the stream is the daemon that runs the wake, saying so itself', () => {
  test('the streamer leads, even before its run row has landed', () => {
    assert.deepEqual(here({ stream: { agent: 'rex' } }), ['rex']);
  });

  test('a streamer with its run already synced is named once', () => {
    assert.deepEqual(here({ stream: { agent: 'rex' }, runs: [wake('tA')] }), ['rex']);
  });

  test('the stream names an agent the roster does not know — nothing, rather than a crash', () => {
    assert.deepEqual(here({ stream: { agent: 'ghost' } }), []);
  });

  test('the stream is keyed to THIS surface by the caller, so a stream here plus a run elsewhere is still here', () => {
    // the hook subscribes on `${channel}:${thread|task}` — an entry means this surface, by construction
    assert.deepEqual(here({ stream: { agent: 'rex' }, runs: [wake('tB')] }), ['rex']);
  });
});

describe('whose ghost: run card › ghost › chip', () => {
  test('the ghost stands down for an agent whose own card is on screen, and speaks for the next one', () => {
    assert.equal(ghostPick([rex, iris], new Set(['a1']))?.name, 'iris');
    assert.equal(ghostPick([rex], new Set(['a1'])), null);
    assert.equal(ghostPick([rex, iris], new Set())?.name, 'rex');
    assert.equal(ghostPick([], new Set()), null);
  });
});
