import { ipcMain, shell } from 'electron';
import { api, ws } from '../../sync';
export function registerFinance(): void {
  for (const action of ['access', 'member']) ipcMain.handle(`nm:destination-${action}`, (_e, body) => api(`/v1/destinations/${action}`, { ...body, workspace: ws() }, 'POST'));

  for (const action of ['migration', 'adopt', 'status', 'start', 'confirm', 'disconnect', 'accounts', 'manage', 'overview', 'refresh', 'budget-prepare', 'budget-commit', 'budget-dismiss', 'chats', 'chat-get', 'chat-send']) ipcMain.handle(`nm:finance-${action}`, (_e, body) => api(`/v1/finance/${action}`, { ...(body ?? {}), workspace: ws() }, 'POST'));
  ipcMain.handle('nm:finance-open', async (_e, raw: string) => {
    const url = new URL(raw);
    if (!['https://www.kinshi.app', 'https://kinshi.app'].includes(url.origin) && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw new Error('Unrecognized Kinshi setup address.');
    if (!/^\/neuramesh\/connect\/[0-9a-f-]{36}$/.test(url.pathname)) throw new Error('Invalid Kinshi setup address.');
    await shell.openExternal(url.toString());
  });
}
