import { describe, expect, it } from 'vitest';
import { PushService, pushAfterCommand, type ExpoPushMessage, type ExpoTicket, type PushSender } from '../src/push';
import type { Store } from '../src/store';

// A minimal Store implementing only what PushService touches — precise control over
// members + devices without seeding the whole MemoryStore.
function fakeStore(init: { members: string[]; devices: Record<string, string[]> }) {
  const devices = new Map<string, Set<string>>();
  for (const [u, toks] of Object.entries(init.devices)) devices.set(u, new Set(toks));
  // the window is real here (the flood of 2026-09-08 slipped past a fake that treated every key as
  // forever): a test moves `clock.now` the way wall time moves under a cron
  const clock = { now: 0 };
  const sent = new Map<string, number>();
  const store = {
    async humanMemberIds() {
      return init.members;
    },
    async recordPushOnce(userId: string, key: string, windowMs: number) {
      const k = `${userId}:${key}`;
      const last = sent.get(k);
      if (last !== undefined && clock.now - last < windowMs) return false;
      sent.set(k, clock.now);
      return true;
    },
    async devicesForUsers(userIds: string[]) {
      const out: Array<{ userId: string; token: string; platform: string }> = [];
      for (const u of userIds) for (const t of devices.get(u) ?? []) out.push({ userId: u, token: t, platform: 'ios' });
      return out;
    },
    async revokeDeviceToken(token: string) {
      for (const s of devices.values()) s.delete(token);
    },
  } as unknown as Store;
  return { store, devices, clock };
}

function fakeSender(mode: 'ok' | { deadToken: string } = 'ok') {
  const calls: ExpoPushMessage[][] = [];
  const sender: PushSender = {
    async send(messages) {
      calls.push(messages);
      return messages.map(
        (m): ExpoTicket =>
          typeof mode === 'object' && m.to === mode.deadToken ? { status: 'error', details: { error: 'DeviceNotRegistered' } } : { status: 'ok' },
      );
    },
  };
  return { sender, calls };
}

const gateTask = (state: string) => ({ id: 't1', number: 147, title: 'CSV export', state, workspace: 'ws', channel: 'chan1' });

describe('PushService.notifyTaskGate', () => {
  it('pushes a done task to every human member except the actor', async () => {
    const { store } = fakeStore({ members: ['alice', 'bob'], devices: { bob: ['tok-bob'] } });
    const { sender, calls } = fakeSender();
    await new PushService(store, sender).notifyTaskGate(gateTask('done'), 'alice');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toHaveLength(1);
    expect(calls[0]![0]!.to).toBe('tok-bob');
    expect(calls[0]![0]!.title).toContain('Ready to accept');
    expect(calls[0]![0]!.data).toMatchObject({ taskId: 't1', channelId: 'chan1' });
  });

  it('does not push on a non-gate state', async () => {
    const { store } = fakeStore({ members: ['alice', 'bob'], devices: { bob: ['tok-bob'] } });
    const { sender, calls } = fakeSender();
    await new PushService(store, sender).notifyTaskGate(gateTask('in_progress'), 'alice');
    expect(calls).toHaveLength(0);
  });

  it('never pushes to the acting human, even with a device', async () => {
    const { store } = fakeStore({ members: ['alice'], devices: { alice: ['tok-alice'] } });
    const { sender, calls } = fakeSender();
    await new PushService(store, sender).notifyTaskGate(gateTask('done'), 'alice');
    expect(calls).toHaveLength(0);
  });

  it('dedupes the same gate event inside the window', async () => {
    const { store } = fakeStore({ members: ['alice', 'bob'], devices: { bob: ['tok-bob'] } });
    const { sender, calls } = fakeSender();
    const svc = new PushService(store, sender);
    await svc.notifyTaskGate(gateTask('done'), 'alice');
    await svc.notifyTaskGate(gateTask('done'), 'alice');
    expect(calls).toHaveLength(1);
  });

  it('the review reminder sends ONCE across the thirty cron minutes of its lead (2026-09-08, the lock-screen flood)', async () => {
    const { store, clock } = fakeStore({ members: ['bob'], devices: { bob: ['tok-bob'] } });
    const { sender, calls } = fakeSender();
    const svc = new PushService(store, sender);
    const at = new Date('2026-09-08T15:30:00.000Z');
    const item = { id: 'ci-1', workspace: 'ws', channel: 'c', threadId: null, platform: 'x', body: 'Your nervous system needs a clear ending.', scheduledAt: at.toISOString() };
    // the cron fires every minute from 30 minutes out to the last minute, and wall time moves with it
    for (let m = 30; m >= 1; m--) {
      const now = new Date(at.getTime() - m * 60_000);
      clock.now = now.getTime();
      await svc.notifyPostReview(item, now);
    }
    expect(calls).toHaveLength(1);
    // moved to a new time: that is a new last chance, so one more reminder
    const later = new Date(at.getTime() + 3_600_000);
    clock.now = later.getTime() - 20 * 60_000;
    await svc.notifyPostReview({ ...item, scheduledAt: later.toISOString() }, new Date(clock.now));
    expect(calls).toHaveLength(2);
  });

  it('revokes a token Expo reports as DeviceNotRegistered', async () => {
    const { store, devices } = fakeStore({ members: ['alice', 'bob'], devices: { bob: ['dead-tok'] } });
    const { sender } = fakeSender({ deadToken: 'dead-tok' });
    await new PushService(store, sender).notifyTaskGate(gateTask('done'), 'alice');
    expect(devices.get('bob')!.has('dead-tok')).toBe(false);
  });

  it('pushes distinct copy for design_review / plan_review / blocked', async () => {
    for (const [state, needle] of [
      ['design_review', 'Design review'],
      ['plan_review', 'Plan ready'],
      ['blocked', 'Blocked'],
    ] as const) {
      const { store } = fakeStore({ members: ['bob'], devices: { bob: ['t'] } });
      const { sender, calls } = fakeSender();
      await new PushService(store, sender).notifyTaskGate(gateTask(state), 'alice');
      expect(calls[0]![0]!.title, state).toContain(needle);
    }
  });
});

describe('PushService.notifyCardMessage', () => {
  const nmq = 'Which deploy target?\n\n```nmq\n{}\n```';

  it('pushes an agent nmq card to the members', async () => {
    const { store } = fakeStore({ members: ['alice', 'bob'], devices: { alice: ['tok-a'], bob: ['tok-b'] } });
    const { sender, calls } = fakeSender();
    await new PushService(store, sender).notifyCardMessage(
      { id: 'm1', workspace: 'ws', channelId: 'chan1', taskId: null, authorKind: 'agent', authorId: 'rex', body: nmq },
      '#growth',
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]!.map((m) => m.to).sort()).toEqual(['tok-a', 'tok-b']);
    expect(calls[0]![0]!.title).toContain('A question for you');
    expect(calls[0]![0]!.data).toMatchObject({ messageId: 'm1', channelId: 'chan1' });
  });

  it('ignores a non-card message', async () => {
    const { store } = fakeStore({ members: ['bob'], devices: { bob: ['tok-b'] } });
    const { sender, calls } = fakeSender();
    await new PushService(store, sender).notifyCardMessage(
      { id: 'm2', workspace: 'ws', channelId: 'chan1', taskId: null, authorKind: 'agent', authorId: 'rex', body: 'just an update' },
      '#growth',
    );
    expect(calls).toHaveLength(0);
  });

  it('ignores a human-authored message (only agents raise cards)', async () => {
    const { store } = fakeStore({ members: ['bob'], devices: { bob: ['tok-b'] } });
    const { sender, calls } = fakeSender();
    await new PushService(store, sender).notifyCardMessage(
      { id: 'm3', workspace: 'ws', channelId: 'chan1', taskId: null, authorKind: 'human', authorId: 'alice', body: nmq },
      '#growth',
    );
    expect(calls).toHaveLength(0);
  });
});

describe('PushService.notifyCodeApproval + pushAfterCommand (the mobile-cloud round)', () => {
  const approval = { codeSessionId: 'cs1', workspace: 'ws', ownerUserId: 'bob', title: 'Relay attach for the phone', machineName: 'george-cloud', approvalId: 'call-1', category: 'edit', toolName: 'apply_patch' };

  it('reaches exactly the session\'s member — never the whole workspace — and dedupes per approval', async () => {
    const { store } = fakeStore({ members: ['alice', 'bob'], devices: { alice: ['tok-alice'], bob: ['tok-bob'] } });
    const { sender, calls } = fakeSender();
    const push = new PushService(store, sender);
    await push.notifyCodeApproval(approval);
    await push.notifyCodeApproval(approval);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.map((m) => m.to)).toEqual(['tok-bob']);
    expect(calls[0]![0]!.title).toBe('Approval needed · Relay attach for the phone');
    expect(calls[0]![0]!.body).toBe('Edit files · apply_patch on george-cloud');
    expect(calls[0]![0]!.data).toMatchObject({ codeSessionId: 'cs1', workspace: 'ws' });
  });

  it('pushAfterCommand routes an approval outcome to the member and a gate outcome to the room', async () => {
    const { store } = fakeStore({ members: ['alice', 'bob'], devices: { alice: ['tok-alice'], bob: ['tok-bob'] } });
    const { sender, calls } = fakeSender();
    const push = new PushService(store, sender);
    pushAfterCommand(push, 'alice', { type: 'code_session.approval_waiting' }, { ok: true, ...approval });
    await new Promise((r) => setTimeout(r, 10));
    expect(calls[0]!.map((m) => m.to)).toEqual(['tok-bob']);
    pushAfterCommand(push, 'alice', { type: 'task.submit' }, { task: gateTask('done'), events: [] });
    await new Promise((r) => setTimeout(r, 10));
    expect(calls[1]!.map((m) => m.to)).toEqual(['tok-bob']);
    expect(calls[1]![0]!.title).toContain('Ready to accept');
  });

  it('the card push carries the thread id, so a tap lands at the card', async () => {
    const { store } = fakeStore({ members: ['alice', 'bob'], devices: { bob: ['tok-bob'] } });
    const { sender, calls } = fakeSender();
    await new PushService(store, sender).notifyCardMessage(
      { id: 'm1', workspace: 'ws', channelId: 'chan1', taskId: null, threadId: 'th1', authorKind: 'agent', authorId: 'rex', body: '```nmq\nquestion: Which room?\noptions:\n  - general\n  - marketing\n```' },
      '#general',
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]![0]!.data).toMatchObject({ threadId: 'th1', messageId: 'm1' });
  });
});
