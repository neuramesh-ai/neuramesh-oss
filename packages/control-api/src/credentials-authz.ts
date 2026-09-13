// who may read a workspace's provider credentials.
//
// this existed nowhere: GET /v1/credentials and /v1/credentials/resolve took a `workspace`
// query parameter and answered for ANY authenticated caller — so any signed-in identity that
// learned a workspace uuid could read that workspace's stored provider tokens. uuids are not
// secrets: they ride in urls, logs, error bodies and shared artifacts. compare
// /v1/machines/usage, which checks membership; these two never did.
//
// the check has to admit both shapes the lane actually serves: a HUMAN reading their own
// workspace's settings, and an AGENT whose daemon is resolving a key to spawn with. machine
// bearers arrive already resolved into one of those two (resolveMachineActor), so they need
// no third branch.
import type { Actor } from '@neuramesh/shared';
import type { Store } from './store';

export async function actorMayReadCredentials(store: Store, actor: Actor, workspace: string): Promise<boolean> {
  if (actor.kind === 'human') return (await store.humanMemberIds(workspace)).includes(actor.id);
  if (actor.kind === 'agent') return (await store.agentWorkspace(actor.id)) === workspace;
  return false;
}
