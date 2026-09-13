// lib/presence.ts (the RENDERER's derived presence) under real assertions — track A1.
// Named presence-ui because src/main/presence.ts (the daemon's status pump) owns
// presence.test.ts; the two modules share a noun, not a subject.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isOnline, agentLive, agentBusy, agentFocus } from '../renderer/src/lib/presence';
import type { AgentRow, MachineRow } from '../renderer/src/bridge/rows-crew';
import type { TaskRow, RunUI } from '../renderer/src/bridge/rows-board';

const agent = (over: Partial<AgentRow> = {}): AgentRow =>
  ({ id: 'a1', name: 'patch', role: 'developer', status: 'idle', machine_id: 'm1', hosted_on: null, ...over }) as AgentRow;
const machine = (over: Partial<MachineRow> = {}): MachineRow =>
  ({ id: 'm1', name: 'mac', last_seen_at: new Date().toISOString(), ...over }) as MachineRow;
const task = (over: Partial<TaskRow> = {}): TaskRow =>
  ({ id: 't1', number: 1046, title: 'x', state: 'in_progress', assignee_id: 'a1', ...over }) as TaskRow;
const run = (over: Partial<RunUI> = {}): RunUI =>
  ({ id: 'r1', agent_id: 'a1', state: 'running', parent_run_id: null, kind: 'work', title: 'Auditing the repo', done: 2, total: 5, tools: 0, ...over }) as RunUI;

test('liveness is the machine heartbeat, not the status row', () => {
  assert.equal(isOnline(new Date(Date.now() - 30_000).toISOString()), true);
  assert.equal(isOnline(new Date(Date.now() - 120_000).toISOString()), false, '90s is the line');
  assert.equal(isOnline(null), false);
  assert.equal(agentLive(agent(), [machine()]), true);
  assert.equal(agentLive(agent(), [machine({ last_seen_at: new Date(Date.now() - 600_000).toISOString() })]), false,
    'a dead machine means a dead agent, whatever agents.status says');
});

test('busy is the ONE set: working/review/thinking', () => {
  for (const s of ['working', 'review', 'thinking']) assert.equal(agentBusy(agent({ status: s })), true);
  for (const s of ['idle', 'online', 'offline']) assert.equal(agentBusy(agent({ status: s })), false);
});

test('the focus ladder: an open top-level run beats everything', () => {
  assert.equal(agentFocus(agent(), [task()], [run()]), 'Auditing the repo · 2/5');
  assert.equal(agentFocus(agent(), [task()], [run({ total: 0 })]), 'Auditing the repo', 'no-total runs show the bare title');
  assert.equal(agentFocus(agent(), [task()], [run({ parent_run_id: 'r0' })]), 'working #1046',
    'a LEG is not the agent’s own focus — the parent run is, and without one the task speaks');
});

test('…then hosted_on, then the assigned task, then status', () => {
  assert.equal(agentFocus(agent({ hosted_on: 'geo’s mac' }), [], []), 'working on geo’s mac');
  assert.equal(agentFocus(agent(), [task({ state: 'in_review' })], []), 'review #1046');
  assert.equal(agentFocus(agent(), [task({ assignee_id: 'other' })], []), 'standing by');
  assert.equal(agentFocus(agent({ status: 'offline' }), [], []), 'offline', 'an unknown status is reported, not flattened');
});
