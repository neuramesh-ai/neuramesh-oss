// Task-thread typing scope: an individual task thread's presence bar must show ONLY that
// task's work — its live assignee (developer while in_progress, reviewer while in_review),
// never channel-wide traffic. This is the fix for "the orchestrator typing in another thread
// shows up in every thread I have open".
import { describe, expect, it } from 'vitest';
import { taskTypists } from '../src/typists';

const patch = { id: 'a-patch', name: 'patch', status: 'working' };
const scout = { id: 'a-scout', name: 'scout', status: 'thinking' };
const rex = { id: 'a-rex', name: 'rex', status: 'working' }; // orchestrator — never a task assignee
const idle = { id: 'a-owl', name: 'owl', status: 'online' };
const roster = [patch, scout, rex, idle];
const allLive = () => true;

describe('taskTypists', () => {
  it('shows only the task assignee — the orchestrator typing elsewhere never bleeds in', () => {
    // patch owns this task; rex (busy in the room, on other work) must NOT appear
    expect(taskTypists(roster, 'a-patch', allLive).map((a) => a.name)).toEqual(['patch']);
    expect(taskTypists(roster, 'a-patch', allLive).some((a) => a.name === 'rex')).toBe(false);
  });

  it('follows ownership across the FSM — the reviewer is the assignee in review', () => {
    // during in_review the server hands the task to the reviewer, so scout is the owner
    expect(taskTypists(roster, 'a-scout', allLive).map((a) => a.name)).toEqual(['scout']);
  });

  it('only thinking/working count as active — a resting assignee shows nothing', () => {
    expect(taskTypists(roster, 'a-owl', allLive)).toEqual([]); // owl is 'online'
    for (const status of ['idle', 'online', 'review', 'offline', '']) {
      expect(taskTypists([{ id: 'x', name: 'x', status }], 'x', allLive)).toEqual([]);
    }
  });

  it('an unassigned task (no owner) shows nobody — never falls back to channel presence', () => {
    expect(taskTypists(roster, null, allLive)).toEqual([]);
    expect(taskTypists(roster, undefined, allLive)).toEqual([]);
    expect(taskTypists(roster, '', allLive)).toEqual([]);
  });

  it('a dead host is gated out even if the status row still says working', () => {
    const liveExceptPatch = (a: { id: string }) => a.id !== 'a-patch';
    expect(taskTypists(roster, 'a-patch', liveExceptPatch)).toEqual([]);
    expect(taskTypists(roster, 'a-scout', liveExceptPatch).map((a) => a.name)).toEqual(['scout']);
  });

  it('excludes the live thread-streamer to avoid a duplicate chip (composer bar renders it)', () => {
    expect(taskTypists(roster, 'a-patch', allLive, 'patch')).toEqual([]);
    // a different streamer does not suppress the assignee's own presence chip
    expect(taskTypists(roster, 'a-patch', allLive, 'rex').map((a) => a.name)).toEqual(['patch']);
  });

  it('a human assignee never matches an agent id — no false positive', () => {
    expect(taskTypists(roster, 'u-george', allLive)).toEqual([]);
  });
});
