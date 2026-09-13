// ARTIFACT + FILE IPC — staging an attachment, uploading a file, listing what a thread or a
// room has, and shelving one to the library.
//
// Six handlers split out of startSync's registration wall. They were scattered through it by
// the order they were written in rather than by what they do.
//
// One rule they share, and the reason they read as one module: an upload rides the
// `artifact.create` COMMAND, never a local row. The ps_crud artifacts branch is gated on
// message_id, so a locally-inserted artifact is one the upload queue silently drops.
//
// REGISTRATION POSITION IS LOAD-BEARING (see whiteboards.ts) — called from where these sat.
import { apiAuthHeaders } from '../../apiauth';
import { app, dialog, ipcMain, shell } from 'electron';
import { discardAttachment, stageAttachment } from '../../attachments';
import { channelLibrary, type DraftedPost, type LibraryRow } from '../../library';
import { readFile, writeFile } from 'node:fs/promises';
import type { PowerSyncDatabase } from '@powersync/node';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';


/**
 * SAVE A FILE OUT OF THE APP (2026-08-18). Files the team and its agents made were readable in
 * Workspace Files and openable in a thread, and there was no way to get one onto your own disk —
 * the app could take a file in (upload) and never hand one back.
 *
 * The bytes come from the caller, because that is where they already are: an artifact's
 * `inline_content` is on the synced row, so this never re-fetches and works offline. `base64` is
 * for the binary ones (a screenshot, a PNG upload) — text would corrupt them.
 */
function registerSaveAs(): void {
  ipcMain.handle('nm:save-file-as', async (_e, f: { name: string; content: string; base64?: boolean }) => {
    const { writeFileSync } = await import('node:fs');
    const { join, extname } = await import('node:path');
    const { app } = await import('electron');
    const name = (f?.name ?? 'file').replace(/[/\\]/g, '-') || 'file';
    const ext = extname(name).replace('.', '');
    const res = await dialog.showSaveDialog({
      title: 'Save file',
      defaultPath: join(app.getPath('downloads'), name),
      // the extension the file already HAS — an empty filter list means "any", which is right for
      // the long tail (.md, .json, .html, .diff) rather than inventing a category per kind
      filters: ext ? [{ name: ext.toUpperCase(), extensions: [ext] }, { name: 'All files', extensions: ['*'] }] : undefined,
    });
    if (res.canceled || !res.filePath) return { saved: false };
    writeFileSync(res.filePath, f.base64 ? Buffer.from(f.content, 'base64') : f.content, f.base64 ? undefined : 'utf8');
    return { saved: true, path: res.filePath };
  });
}

export function registerArtifactIpc(deps: {
  db: () => PowerSyncDatabase;
  api: (path: string, body?: unknown) => Promise<Record<string, unknown>>;
  /** getters, both: API_URL is a reassigned `let` in sync.ts and sign-in can change the actor */
  apiUrl: () => string;
  actorId: () => string;
  /** the active workspace — every read here is scoped by it (the replica holds them all) */
  ws: () => string;
}): void {
  const { db, api, apiUrl, actorId, ws } = deps;

  // stage an attachment: write the bytes locally + compute a thumbnail/dims; the row is written on send
  registerSaveAs();
  ipcMain.handle('nm:attach-stage', async (_e, { id, name, mime, bytes }: { id: string; name: string; mime: string; bytes: ArrayBuffer }) => {
    const meta = await stageAttachment(id, name, mime, Buffer.from(bytes));
    return { id: meta.id, size: meta.size, width: meta.width, height: meta.height, thumb: meta.thumb };
  });

  ipcMain.handle('nm:attach-discard', async (_e, { id }: { id: string }) => {
    await discardAttachment(id);
  });

  ipcMain.handle('nm:promote-artifact', async (_e, { artifactId }: { artifactId: string }) => {
    const res = await fetch(`${apiUrl()}/v1/commands`, {
      method: 'POST',
      headers: await apiAuthHeaders(apiUrl(), { kind: 'human', id: actorId() }),
      body: JSON.stringify({ type: 'artifact.promote', artifactId }),
    });
    if (!res.ok) throw new Error(`promote failed ${res.status}: ${await res.text()}`);
    return res.json();
  });

  // Deleting one. The REFUSAL lives on the server (`isGateArtifact`), so this is a thin pass —
  // and the server's message is surfaced verbatim rather than flattened to "failed", because the
  // whole point of the refusal is telling you WHICH gate is standing on the file.
  ipcMain.handle('nm:delete-artifact', async (_e, { artifactId }: { artifactId: string }) => {
    const res = await fetch(`${apiUrl()}/v1/commands`, {
      method: 'POST',
      headers: await apiAuthHeaders(apiUrl(), { kind: 'human', id: actorId() }),
      body: JSON.stringify({ type: 'artifact.delete', artifactId }),
    });
    if (!res.ok) {
      const body = await res.text();
      let msg = body;
      try { msg = (JSON.parse(body) as { message?: string; error?: string }).message ?? (JSON.parse(body) as { error?: string }).error ?? body; } catch { /* raw */ }
      throw new Error(msg);
    }
    return res.json();
  });

  ipcMain.handle('nm:file-upload', async (_e, { channelId }: { channelId: string }) => {
    const res = await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'], title: 'Add files to this room' });
    if (res.canceled || !res.filePaths.length) return { ok: true, added: 0, skipped: [] as string[] };
    const added: string[] = [];
    const skipped: string[] = [];
    for (const p of res.filePaths.slice(0, 20)) {
      const name = basename(p);
      const buf = await readFile(p).catch(() => null);
      if (!buf) { skipped.push(`${name} (unreadable)`); continue; }
      const isImg = /\.(png|jpe?g|gif|webp|svg)$/i.test(name);
      // 2MB is the data-URI ceiling: past it the row stops being a document and starts being a
      // blob the sync stream has to carry on every pull.
      if (buf.byteLength > 2_000_000) { skipped.push(`${name} (over 2MB)`); continue; }
      let inlineContent: string;
      let mime: string;
      if (isImg) {
        const ext = name.toLowerCase().endsWith('.svg') ? 'svg+xml' : name.toLowerCase().replace(/^.*\./, '').replace('jpg', 'jpeg');
        mime = `image/${ext}`;
        inlineContent = `data:${mime};base64,${buf.toString('base64')}`;
      } else if (buf.includes(0)) {
        skipped.push(`${name} (binary — share it in chat instead)`);
        continue;
      } else {
        mime = /\.(md|markdown)$/i.test(name) ? 'text/markdown' : 'text/plain';
        inlineContent = buf.toString('utf8');
      }
      try {
        await api('/v1/commands', { type: 'artifact.create', channel: channelId, kind: isImg ? 'file' : 'doc', name, inlineContent, mime });
        added.push(name);
      } catch (err) {
        skipped.push(`${name} (${err instanceof Error ? err.message.slice(0, 60) : 'rejected'})`);
      }
    }
    return { ok: true, added: added.length, skipped };
  });

  // the Library surface (marketing-channel plan §4.9): the room's artifacts + shared-in-chat
  // attachments from the local replica — docs, media, design; the channel ACL is the row's ACL.
  // A picture the crew DREW is not an artifacts row (see library.ts) — the shelf projects the
  // room's drafted images alongside its artifacts so the Media folder stops reading "0 items".
  // A CONVERSATION's own produced files. Artifacts carry no thread_id — a chat's files land with
  // the `message_id` of the agent turn that wrote them — so the thread is reached through its
  // messages. No migration: the join is the anchor that already exists.
  // OPEN AN ARTICLE IN THE OS BROWSER (article round). The renderer hands over the article's
  // ALREADY-RENDERED HTML (exactly what the reading tab shows, styles inlined, images as data
  // URLs) — main just writes it to a temp file and hands it to the default browser. Honest
  // offline, no server, and it doubles as the paste-into-X-articles export.
  ipcMain.handle('nm:article-external', async (_e, { name, html }: { name: string; html: string }) => {
    const safe = name.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'article';
    const path = join(app.getPath('temp'), `nm-article-${safe}-${Date.now()}.html`);
    await writeFile(path, html, 'utf8');
    await shell.openExternal(pathToFileURL(path).toString());
    return { ok: true };
  });

  // ONE artifact by id (article round): the ‹article:id› card is self-contained like WbCard —
  // it reads its own row rather than requiring every thread renderer to thread a lookup through.
  // Workspace-scoped like every read here (the replica holds every workspace you belong to).
  ipcMain.handle('nm:artifact', async (_e, { artifactId }: { artifactId: string }) => ({
    artifact: (await db().getAll(
      `select a.id, a.kind, a.name, a.mime, a.inline_content, a.size_bytes, a.promoted, a.channel_id,
              a.task_id, a.created_at, c.slug as channel_slug
         from artifacts a left join channels c on c.id = a.channel_id
        where a.id = ? and a.workspace_id = ? limit 1`,
      [artifactId, ws()],
    ).catch(() => []))[0] ?? null,
  }));

  ipcMain.handle('nm:thread-artifacts', async (_e, { threadId }: { threadId: string }) => ({
    artifacts: await db().getAll(
      `select a.id, a.kind, a.name, a.mime, a.inline_content, a.size_bytes, a.promoted, a.message_id, a.task_id, a.created_at
         from artifacts a join messages m on m.id = a.message_id
        where m.thread_id = ? order by a.created_at asc`,
      [threadId],
    ).catch(() => []),
  }));

  ipcMain.handle('nm:channel-artifacts', async (_e, { channelId }: { channelId: string }) => {
    const [artifacts, posts] = await Promise.all([
      db().getAll<LibraryRow>(
        `select id, kind, name, mime, inline_content, size_bytes, promoted, message_id, task_id, tags, created_at
         from artifacts where channel_id = ? order by created_at desc limit 200`,
        [channelId],
      ).catch(() => [] as LibraryRow[]),
      db().getAll<DraftedPost>(
        `select id, body, media, task_id, created_at from content_items where channel_id = ? order by created_at desc limit 200`,
        [channelId],
      ).catch(() => [] as DraftedPost[]),
    ]);
    return { artifacts: channelLibrary(artifacts, posts) };
  });
}
