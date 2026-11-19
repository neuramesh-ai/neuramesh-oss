import { ipcMain } from 'electron';
import { api, ws } from '../../sync';
// Who may open a workspace destination (Marketing, Finance). Generic: the Marketing access row reads it.
export function registerDestinations(): void {
  for (const action of ['access', 'member']) ipcMain.handle(`nm:destination-${action}`, (_e, body) => api(`/v1/destinations/${action}`, { ...body, workspace: ws() }, 'POST'));
}
