import { sharedLocalEngineeringHost } from '../relay/engineering-local-host';
import { apiAuthHeaders } from '../apiauth';
// Resume the desktop host after payment is verified in HQ; keep the existing replica intact.
import type { ReplicaDatabase } from '@neuramesh/client-core/replica';
import { app } from 'electron';
import { startAgentHost } from '../agents';
import type { Connection } from '../connections';
import { actorId, apiOn } from '../sync';
import type { BootDeps } from './boot';
import { registerThisMachine } from './machine';
import { backfillSeeds } from './seeds';

export type WsRow = { id: string; name: string; slug: string; onboarded?: boolean; activationRequired?: boolean };
export const listWorkspaces = async (conn: Connection): Promise<WsRow[]> =>
  ((await apiOn(conn, '/v1/workspaces')) as { workspaces: WsRow[] }).workspaces;

export function startHost(conn: Connection, db: ReplicaDatabase, machineId: string, deps: BootDeps): void {
  startAgentHost({ engineering: () => sharedLocalEngineeringHost({ db, machineId, workspaceId:conn.ws, apiUrl:conn.apiUrl, authHeaders:() => apiAuthHeaders(conn.apiUrl,{kind:'human',id:actorId(conn)}) }), db, machineId, workspace: conn.ws, apiUrl: conn.apiUrl, ownerActorId: actorId(conn), agentLog: deps.agentLog, killTaskPtys: deps.killTaskPtys });
  conn.agentHostStarted = true;
}

/** Payment finishes in HQ. Bring this Mac online after that verified entitlement arrives,
 * without a relaunch or replacing its replica. Failed registration can retry on the next tick. */
export async function resumeActivatedWorkspace(conn: Connection, deps: BootDeps): Promise<boolean> {
  const workspaces = await listWorkspaces(conn);
  conn.session.wsMemberships = workspaces;
  const workspace = workspaces.find((w) => w.id === conn.ws);
  if (!workspace || workspace.activationRequired || workspace.onboarded === false || !conn.db) return false;
  conn.needsOnboarding = false;
  conn.resumeWorkspaceId = undefined;
  if (conn.agentHostStarted) return true;
  const machineId = conn.thisMachineId ?? await registerThisMachine(conn, actorId);
  if (!machineId) return false;
  startHost(conn, conn.db, machineId, deps);
  if (!process.argv.some((a) => a.startsWith('--smoke'))) void backfillSeeds(conn, conn.db, machineId);
  return true;
}

export function waitForActivation(conn: Connection, deps: BootDeps): void {
  let checking = false;
  const timer = setInterval(() => {
    if (checking) return;
    checking = true;
    void resumeActivatedWorkspace(conn, deps).then((ready) => {
      if (ready) clearInterval(timer);
    }).catch(() => { /* keep the replica and retry after connectivity returns */ })
      .finally(() => { checking = false; });
  }, 5000);
  timer.unref?.();
  app.on('before-quit', () => clearInterval(timer));
}
