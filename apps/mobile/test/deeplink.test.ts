// the tap's landing (S7): the payload → route mapping. The simulator cannot receive a push, so the
// mapping is proven here and the delivery on a device (the PR says which).
import { describe, expect, it } from 'vitest';
import { routeForData } from '../src/deeplink';

describe('routeForData — every push lands on the surface it is about', () => {
  it('a Code approval names its session, before anything else in the payload', () => {
    expect(routeForData({ codeSessionId: 'cs-1', workspace: 'ws', taskId: 't-1', channelId: 'c-1' })).toBe('/code/cs-1');
  });
  it('a gate or a card on a task opens the task; a card in a chat opens the thread', () => {
    expect(routeForData({ channelId: 'c-1', taskId: 't-1', workspace: 'ws' })).toBe('/task/t-1');
    expect(routeForData({ channelId: 'c-1', taskId: null, threadId: 'th-1', messageId: 'm-1', workspace: 'ws' })).toBe('/thread/th-1');
  });
  it('a room-only payload opens the room; a machine event opens Compute; nothing navigable is null', () => {
    expect(routeForData({ channelId: 'c-1' })).toBe('/channel/c-1');
    expect(routeForData({ route: 'compute' })).toBe('/compute');
    expect(routeForData({ machineId: 'm-1' })).toBe('/compute');
    expect(routeForData({ workspace: 'ws' })).toBeNull();
    expect(routeForData(undefined)).toBeNull();
    expect(routeForData(null)).toBeNull();
  });
  it('the shapes the server sends today (push.ts) all land somewhere', () => {
    const gate = { channelId: 'c-1', taskId: 't-1', workspace: 'ws' };
    const routineDone = { channelId: 'c-1', taskId: 't-2', workspace: 'ws' };
    const card = { channelId: 'c-1', taskId: null, threadId: 'th-1', messageId: 'm-1', workspace: 'ws' };
    const codeApproval = { codeSessionId: 'cs-1', workspace: 'ws' };
    expect([gate, routineDone, card, codeApproval].map(routeForData)).toEqual(['/task/t-1', '/task/t-2', '/thread/th-1', '/code/cs-1']);
  });
});
