// The activity log reads + the export — extracted from sync.ts (track B-sync).
import { app, dialog, ipcMain, type WebContents } from 'electron';
import type { AgentLog } from '../../agentlog';

export interface LogDeps {
  agentLog: AgentLog;
  /** startSync's subscription registry — a watcher registered here must be abortable there */
  watchers: Map<string, AbortController>;
}

export function registerLogs({ agentLog, watchers }: LogDeps): void {
// agent logs (local-only telemetry; never synced) — query + live tail
ipcMain.handle('nm:agent-logs', (_e, f: { agentId?: string; runId?: string; taskNumber?: number; level?: string; search?: string; limit?: number }) =>
  agentLog.query(f ?? {}),
);
// run history for an agent (newest first) — drives the popup's session picker
ipcMain.handle('nm:agent-runs', (_e, { agentId, limit }: { agentId: string; limit?: number }) =>
  agentLog.runs(agentId, limit),
);
ipcMain.handle('nm:watch-agent-logs', (event, { subId }: { subId: string }) => {
  const sender: WebContents = event.sender;
  const onRow = (row: unknown) => { if (!sender.isDestroyed()) sender.send('nm:agent-log-row', { subId, row }); };
  agentLog.events.on('row', onRow);
  watchers.set(subId, { abort: () => agentLog.events.off('row', onRow) } as unknown as AbortController);
});
// export the current (filtered) activity to a JSON file the human chooses.
// local-only data → local-only export; detail is already redacted at write.
ipcMain.handle('nm:export-logs', async (_e, f: { agentId?: string; taskNumber?: number; level?: string; search?: string }) => {
  const rows = agentLog.query({ ...(f ?? {}), limit: 10000 });
  const { writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const suggested = f?.taskNumber ? `agent-logs-task-${f.taskNumber}-${stamp}.json` : `agent-logs-${stamp}.json`;
  const res = await dialog.showSaveDialog({
    title: 'Export agent activity',
    defaultPath: join(app.getPath('downloads'), suggested),
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (res.canceled || !res.filePath) return { saved: false };
  writeFileSync(res.filePath, JSON.stringify(rows, null, 2));
  return { saved: true, path: res.filePath, count: rows.length };
});
}
