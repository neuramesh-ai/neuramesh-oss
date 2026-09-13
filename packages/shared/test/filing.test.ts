import { describe, expect, it } from 'vitest';
import { canFileConversation, fallbackChannel, type FilingSubject, type FilingTarget } from '../src/filing';

const chat = (over: Partial<FilingSubject> = {}): FilingSubject => ({
  taskId: null, filedAt: null, channelId: 'c-general', projectId: 'p-1', ...over,
});
const dev: FilingTarget = { channelId: 'c-dev', projectId: 'p-1' };

describe('canFileConversation', () => {
  it('lets the orchestrator file a fresh chat into another room in the same project', () => {
    expect(canFileConversation('orchestrator', chat(), dev)).toEqual({ ok: true });
  });

  it('lets a human file one too', () => {
    expect(canFileConversation('human', chat(), dev)).toEqual({ ok: true });
  });

  it('refuses any other agent — filing is triage, and triage is the orchestrator’s', () => {
    // a worker that could re-home the conversation it is answering in could walk it into a room
    // with a friendlier reviewer
    const v = canFileConversation('agent', chat(), dev);
    expect(v).toMatchObject({ ok: false, code: 'NOT_PERMITTED' });
  });

  it('refuses a move to the room it is already in, distinctly from a failure', () => {
    // rex has to be able to tell "already right" from "moved" — a silent success reads as a move
    const v = canFileConversation('orchestrator', chat(), { channelId: 'c-general', projectId: 'p-1' });
    expect(v).toMatchObject({ ok: false, code: 'SAME_CHANNEL' });
  });

  it('refuses to cross a project boundary — including for a human', () => {
    // exactly one project is active at a time and it scopes every list, so a thread that changed
    // project would vanish from the surface that created it. Not a permission; an invariant.
    for (const actor of ['orchestrator', 'human'] as const) {
      const v = canFileConversation(actor, chat(), { channelId: 'c-other', projectId: 'p-2' });
      expect(v).toMatchObject({ ok: false, code: 'PROJECT_BOUNDARY' });
    }
  });

  it('treats an unowned channel and an owned one as different projects', () => {
    expect(canFileConversation('orchestrator', chat({ projectId: null }), dev)).toMatchObject({ code: 'PROJECT_BOUNDARY' });
    // …and two unowned ones as the same
    expect(canFileConversation('orchestrator', chat({ projectId: null }), { channelId: 'c-dev', projectId: null })).toEqual({ ok: true });
  });

  it('freezes filing once the thread carries a task — for the human as well', () => {
    // the task's channel binds its board, its branch and the roster that can claim it
    for (const actor of ['orchestrator', 'human'] as const) {
      const v = canFileConversation(actor, chat({ taskId: 't-1' }), dev);
      expect(v).toMatchObject({ ok: false, code: 'TASK_THREAD' });
    }
  });

  it('lets an agent file ONCE, and a human as often as they like', () => {
    const filed = chat({ filedAt: '2026-08-03T10:00:00Z' });
    // a second agent move is two triage turns disagreeing — and rex wakes on every message
    expect(canFileConversation('orchestrator', filed, dev)).toMatchObject({ ok: false, code: 'ALREADY_FILED' });
    // a human changing their mind IS the correction
    expect(canFileConversation('human', filed, dev)).toEqual({ ok: true });
  });

  it('checks the boundary before the task freeze, so the reason names the real blocker', () => {
    const v = canFileConversation('orchestrator', chat({ taskId: 't-1' }), { channelId: 'c-x', projectId: 'p-2' });
    expect(v).toMatchObject({ code: 'PROJECT_BOUNDARY' });
  });
});

describe('fallbackChannel', () => {
  it('prefers #general', () => {
    const rooms = [{ id: 'c-dev', slug: 'dev' }, { id: 'c-general', slug: 'general' }];
    expect(fallbackChannel(rooms)?.id).toBe('c-general');
  });

  it('falls to the first room when a workspace has renamed its general', () => {
    expect(fallbackChannel([{ id: 'c-hq', slug: 'hq' }, { id: 'c-dev', slug: 'dev' }])?.id).toBe('c-hq');
  });

  it('returns null rather than inventing a room', () => {
    expect(fallbackChannel([])).toBeNull();
  });
});
