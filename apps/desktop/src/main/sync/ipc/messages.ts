// MESSAGE IPC — sending, pinning, the unread/latest reads, and answering a decision card.
//
// Seven handlers split out of startSync. Sending is local-first: the row goes into the replica
// and the ordered ps_crud queue uploads it, which is why there is no await on a server round
// trip here and why /v1/messages has to stay idempotent.
//
// REGISTRATION POSITION IS LOAD-BEARING (see whiteboards.ts) — called from where these sat.
import { ipcMain } from 'electron';
import { randomUUID } from 'node:crypto';
import type { PowerSyncDatabase } from '@powersync/node';

export function registerMessageIpc(deps: {
  ws: () => string;
  db: () => PowerSyncDatabase;
  api: (path: string, body?: unknown) => Promise<Record<string, unknown>>;
  actorId: () => string;
  /** startSync's own closures and registry — passed by reference, not re-created */
  insertAttachments: (messageId: string, channelId: string, taskId: string | null,
    attachments: Array<{ id: string; name: string; mime: string }>) => Promise<void>;
  watchers: Map<string, AbortController>;
}): void {
  const { ws, db, api, actorId, insertAttachments, watchers } = deps;

  ipcMain.handle('nm:message-pin', async (_e, { messageId, pinned }: { messageId: string; pinned: boolean }) =>
    api('/v1/commands', { type: 'message.pin', message: messageId, pinned }));

  ipcMain.handle('nm:unwatch', (_e, { subId }: { subId: string }) => {
    watchers.get(subId)?.abort();
    watchers.delete(subId);
  });

  ipcMain.handle('nm:send', async (_e, { channelId, body, id: givenId, attachments, threadId, rootMessageId, threadMode, brainOverride, threadMachineId, threadOrigin }: { channelId: string; body: string; id?: string; attachments?: Array<{ id: string; name: string; mime: string }>; threadId?: string; rootMessageId?: string; threadMode?: 'tasks' | 'chat'; brainOverride?: Record<string, string> | null; threadMachineId?: string | null; threadOrigin?: 'desktop' | 'web' | 'routine' | null }) => {
    const id = givenId ?? randomUUID();
    // threads stay server-born (the message upload births the row; it syncs back down) —
    // the client only stamps the id, so offline sends still group correctly on arrival
    await db().execute(
      `insert into messages (id, workspace_id, channel_id, thread_id, root_message_id, birth_mode, birth_brain, birth_machine, birth_origin, author_kind, author_id, body, created_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, 'human', ?, ?, ?)`,
      [id, ws(), channelId, threadId ?? null, rootMessageId ?? null, threadMode ?? null,
       brainOverride && Object.keys(brainOverride).length ? JSON.stringify(brainOverride) : null,
       threadMachineId ?? null, threadOrigin ?? null,
       actorId(), body, new Date().toISOString()],
    );
    if (attachments?.length) await insertAttachments(id, channelId, null, attachments);
    return { id };
  });

  ipcMain.handle('nm:status', async () => {
    // queued = writes awaiting upload; a count that won't drain means the
    // control-api is unreachable — surfaced in the status pill, not buried
    let queued = 0;
    try {
      const [c] = await db().getAll<{ n: number }>('select count(*) as n from ps_crud');
      queued = Number(c?.n ?? 0);
    } catch {
      // table absent pre-first-write — zero is correct
    }
    return {
      connected: db().currentStatus.connected,
      lastSyncedAt: db().currentStatus.lastSyncedAt?.toISOString() ?? null,
      queued,
    };
  });

  ipcMain.handle('nm:latest', async () =>
    db().getAll(`select channel_id, max(created_at) as latest from messages where workspace_id = ? and task_id is null group by channel_id`, [ws()]),
  );

  // latest activity per task thread — drives unread dots on board cards / chips
  ipcMain.handle('nm:latest-threads', async () =>
    db().getAll(`select task_id, max(created_at) as latest from messages where workspace_id = ? and task_id is not null group by task_id`, [ws()]),
  );

  // flip an nmq card's authoritative state (docs/12 slice 2): answered (with the picked
  // answer) or dismissed. The reply message posts separately via nm:send/nm:send-thread —
  // this is the bookkeeping flip Mission Control renders; the server enforces exactly-once.
  ipcMain.handle('nm:decision-action', async (_e, { type, decisionId, answer }: { type: 'decision.answer' | 'decision.dismiss'; decisionId: string; answer?: string }) =>
    api('/v1/commands', { type, decisionId, ...(type === 'decision.answer' ? { answer } : {}) }));
}
