// the test that was missing: a workspace uuid must not be enough to read that workspace's
// provider tokens. every case here is a caller who HAS a valid identity and is asking about
// someone else's workspace — the shape that was answered for a year.
import { describe, expect, it } from 'vitest';
import { actorMayReadCredentials } from './credentials-authz.js';
import type { Store } from './store';

const store = {
  humanMemberIds: async (ws: string) => (ws === 'ws-mine' ? ['u-me'] : ['u-them']),
  agentWorkspace: async (id: string) => (id === 'a-mine' ? 'ws-mine' : 'ws-theirs'),
} as unknown as Store;

const human = (id: string) => ({ kind: 'human' as const, id });
const agent = (id: string) => ({ kind: 'agent' as const, id, role: 'developer' as const });

describe('actorMayReadCredentials', () => {
  it('a member reads their own workspace', async () => {
    expect(await actorMayReadCredentials(store, human('u-me'), 'ws-mine')).toBe(true);
  });

  it('a signed-in NON-member is refused — knowing the uuid is not access', async () => {
    expect(await actorMayReadCredentials(store, human('u-me'), 'ws-theirs')).toBe(false);
  });

  it("an agent reads only its OWN workspace's credentials", async () => {
    expect(await actorMayReadCredentials(store, agent('a-mine'), 'ws-mine')).toBe(true);
    expect(await actorMayReadCredentials(store, agent('a-mine'), 'ws-theirs')).toBe(false);
    expect(await actorMayReadCredentials(store, agent('a-other'), 'ws-mine')).toBe(false);
  });

  it('anything that is neither a member nor an agent of the workspace is refused', async () => {
    // fail closed: an actor kind this function does not understand gets nothing, rather than
    // inheriting whatever the last branch happened to return.
    expect(await actorMayReadCredentials(store, { kind: 'system' } as never, 'ws-mine')).toBe(false);
  });
});
