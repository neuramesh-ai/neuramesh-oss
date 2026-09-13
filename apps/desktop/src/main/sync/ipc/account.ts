// MEMORY + ACCOUNT IPC — the recall surface, the two deletions, and the boot payload.
//
// The tail of startSync's handler wall. Memory is the one destination keyed to a single channel
// (/v1/memory takes a channel), which is why it gets a room picker rather than an aggregate —
// and why its three handlers sit beside the account ones rather than with the workspace-wide
// destinations.
//
// REGISTRATION POSITION IS LOAD-BEARING — see the note in whiteboards.ts. Called from exactly
// where these lines sat, and does nothing but register.
import { ipcMain } from 'electron';

export function registerAccountIpc(deps: {
  ws: () => string;
  api: (path: string, body?: unknown) => Promise<Record<string, unknown>>;
  /** a SETTER, not the flag: deleting the active workspace sends the shell back to onboarding,
   *  and an imported binding cannot be assigned. */
  setNeedsOnboarding: (v: boolean) => void;
}): void {
  const { ws, api, setNeedsOnboarding } = deps;

  ipcMain.handle('nm:memory', async (_e, { channelSlug }: { channelSlug: string }) =>
    api(`/v1/memory?workspace=${ws()}&channel=${encodeURIComponent(channelSlug)}`));

  // Memory curation (the Lessons section): retire closes a fact's validity
  // (bitemporal — history stays; prompts stop injecting it); record backs the
  // correct-this-lesson flow. Human-posted; the API enforces who may retire.
  ipcMain.handle('nm:memory-retire-fact', async (_e, { factId, supersededBy }: { factId: string; supersededBy?: string }) =>
    api('/v1/commands', { type: 'memory.retire_fact', factId, ...(supersededBy ? { supersededBy } : {}) }));
  ipcMain.handle('nm:memory-record-lesson', async (_e, { channelSlug, content }: { channelSlug: string; content: string }) =>
    api('/v1/commands', { type: 'memory.record_lesson', workspace: ws(), channel: channelSlug, content }));

  ipcMain.handle('nm:account-blockers', async () => api('/v1/workspaces'));

  ipcMain.handle('nm:workspace-delete', async (_e, { workspaceId }: { workspaceId: string }) => {
    const r = (await api('/v1/commands', { type: 'workspace.delete', workspace: workspaceId })) as { ok: boolean };
    if (workspaceId === ws()) setNeedsOnboarding(true); // active workspace gone
    return r;
  });

  ipcMain.handle('nm:account-delete', async () => api('/v1/commands', { type: 'account.delete' }));
}
