// THE LOCAL CODE LANE's IPC (the desktop Code bridge, slice B1): the renderer opens a Code session
// on THIS Mac the way it opens a terminal — a subId, a stream of events, an exit — and the host is
// the app's own (relay/engineering-local-host.ts). Registered beside the terminals, from startSync,
// because that is where the replica the host reads lives.
import { ipcMain } from 'electron';
import type { PowerSyncDatabase } from '@powersync/node';
import type { Actor } from '@neuramesh/shared';
import type { EngineeringOpenMeta } from '../../../engineering-protocol';
import { apiAuthHeaders } from '../../apiauth';
import { createLocalEngineeringHost, LocalEngineeringSessions } from '../../relay/engineering-local-host';
import { apiUrl, ws, actorId, thisMachineId, thisMachineName } from '../../sync';

export function registerLocalEngineering({ db }: { db: () => PowerSyncDatabase }): void {
  // the coding runtime is a dynamic import, external to the main bundle (electron.vite.config.ts),
  // and the honest answer to "can this Mac host Code" is whether it loads — asked once, off the
  // critical path, never at open time where a missing module would read as a session failure
  const runtime = import('@cline/sdk').then(() => true, () => false);
  // the host speaks as the signed-in member; the workspace is the one the app stands in, re-read
  // per host so a workspace switch does not leave a stale host serving the old one
  let host: { workspaceId: string; sessions: LocalEngineeringSessions } | null = null;
  const sessionsFor = (): LocalEngineeringSessions => {
    if (host && host.workspaceId === ws()) return host.sessions;
    const authHeaders = () => apiAuthHeaders(apiUrl(), { kind: 'human', id: actorId() } as Actor);
    const created = createLocalEngineeringHost({ db: db(), apiUrl: apiUrl(), workspaceId: ws(), authHeaders, machineId: thisMachineId(), log: (line) => console.log(`[engineering:local] ${line}`) });
    host = { workspaceId: ws(), sessions: new LocalEngineeringSessions(created, actorId) };
    return host.sessions;
  };
  for (const name of ['nm:engineering-local-info', 'nm:engineering-local-open', 'nm:engineering-local-command', 'nm:engineering-local-close']) ipcMain.removeHandler(name);
  ipcMain.handle('nm:engineering-local-info', async () => {
    const available = await runtime;
    return { available, ...(available ? {} : { reason: 'The coding runtime is not installed in this build of the app.' }), machineId: thisMachineId(), machineName: thisMachineName() };
  });
  ipcMain.handle('nm:engineering-local-open', async (event, { subId, meta }: { subId: string; meta: EngineeringOpenMeta }) => {
    const sender = event.sender;
    const opened = await sessionsFor().open(subId, meta,
      (ev) => { if (!sender.isDestroyed()) sender.send('nm:engineering-event', { subId, event: ev }); },
      () => { if (!sender.isDestroyed()) sender.send('nm:engineering-exit', { subId }); });
    return { ok: opened };
  });
  ipcMain.handle('nm:engineering-local-command', (_e, { subId, command }: { subId: string; command: unknown }) => { sessionsFor().command(subId, command); });
  ipcMain.handle('nm:engineering-local-close', (event, { subId }: { subId: string }) => {
    if (sessionsFor().close(subId) && !event.sender.isDestroyed()) event.sender.send('nm:engineering-exit', { subId });
  });
}
