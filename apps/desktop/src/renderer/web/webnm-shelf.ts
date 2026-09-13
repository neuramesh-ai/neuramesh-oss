// THE BROWSER'S SHELF: the library, the skills, and the whiteboards.
//
// The other half of webnm-content.ts, which imports this and hands both out under one export —
// the split is the 250-line law (eslint.config.mjs: new files always face 250), not a seam anyone
// designed. It falls where the desktop's own does, though: sync/ipc/artifacts.ts, ipc/skills.ts and
// ipc/whiteboards.ts are three modules for the same reason.
//
// The two read helpers live HERE and are imported by webnm-content.ts, so the dependency runs one
// way. Read the header of webnm-content.ts for the rules both files are written to.
import type { PowerSyncDatabase } from '@powersync/web';
import { channelLibrary, type DraftedPost, type LibraryRow } from '../../main/library';
import type { NMBridge } from '../src/bridge/nm';
import type { ChannelArtifactRow } from '../src/bridge/rows-rooms';
import type { ArtifactUI } from '../src/bridge/rows-board';
import type { SkillRow, SkillPackRow } from '../src/bridge/rows-content';
import { authHeaders, postCommand, type WebNmConfig } from './webnm';

/** the ‹article:id› card's row: an artifact plus where it lives, which the card needs to link back
 *  to the room. Named because `orEmpty` needs a type to widen to and inference gives it `{}`. */
type ArtifactWide = ChannelArtifactRow & { channel_id?: string | null; channel_slug?: string | null };

/** A failed read must not look like an empty workspace — it SAYS SO and then yields empty, rather
 *  than yielding empty quietly. (The idiom from webnm-rooms.ts.) */
export const orEmpty = <T>(what: string) => (e: unknown): T[] => {
  console.error(`[webnm] ${what} failed:`, e);
  return [];
};

/** a live query: run it, then re-run whenever one of `tables` changes. mirrors db.watch's contract
 *  for the renderer, minus the IPC hop the desktop needs. A failed re-read leaves the last good
 *  rows standing rather than blanking a surface that was already drawing. */
export function watch<T>(db: PowerSyncDatabase, tables: string[], run: () => Promise<T[]>, cb: (rows: T[]) => void): () => void {
  let live = true;
  const push = () => {
    if (!live) return;
    void run().then((rows) => { if (live) cb(rows); }).catch((e: unknown) => { console.error('[webnm] watch read failed:', e); });
  };
  push();
  const stop = db.onChangeWithCallback({ onChange: () => push() }, { tables });
  return () => { live = false; stop(); };
}

/** ported from sync/ipc/artifacts.ts + the two library watches in ipc/watch-board.ts */
function libraryLanes(cfg: WebNmConfig, db: PowerSyncDatabase): Partial<NMBridge> {
  const ws = () => cfg.workspaceId();
  return {
    // The room's ★ shelf: promoted rows only. This is the ONE surface where `promoted = 1` is
    // correct — it is the shelf, not the file system. (watchLibraryAll is where that same clause
    // made a destination lie, and where it is gone.)
    watchLibrary: (channelId: string, cb: (rows: ArtifactUI[]) => void) =>
      watch<ArtifactUI>(db, ['artifacts', 'tasks'], () =>
        db.getAll<ArtifactUI>(
          `select a.id, a.kind, a.name, a.inline_content, a.created_at, t.number as task_number
           from artifacts a left join tasks t on t.id = a.task_id
           where a.channel_id = ? and a.promoted = 1 order by a.created_at desc`,
          [channelId],
        ).catch(orEmpty('watchLibrary')), cb),

    // The Workspace Files destination. `and a.promoted = 1` used to live here and made the
    // destination lie: promoted defaults false and only artifact.promote flips it, so every row
    // written straight by artifact.create — the marketing bootstrap's brand docs above all — was
    // structurally unreachable here while three other surfaces showed it. Curation is a MARKER the
    // row carries (★) and a chip the human picks, never the condition of existing.
    watchLibraryAll: (cb: (rows: ArtifactUI[]) => void) =>
      watch<ArtifactUI>(db, ['artifacts', 'tasks', 'channels'], () =>
        db.getAll<ArtifactUI>(
          `select a.id, a.kind, a.name, a.mime, a.inline_content, a.size_bytes, a.promoted, a.task_id, a.created_at,
                  t.number as task_number, c.slug as channel_slug, c.id as channel_id, c.project_id
           from artifacts a left join tasks t on t.id = a.task_id join channels c on c.id = a.channel_id
           where a.workspace_id = ? and a.message_id is null order by a.created_at desc`,
          [ws()],
        ).catch(orEmpty('watchLibraryAll')), cb),

    // The room's shelf as the Library surface reads it: its artifacts AND its drawn pictures. A
    // picture the crew drew was never an artifacts row — the publish-size bytes stay server-side
    // (0090) and what syncs is the 640px thumb on content_items.media — so channelLibrary projects
    // those rows on read. Imported rather than re-derived so the two clients cannot drift on what a
    // room may shelve; main/library.ts has no imports at all, which is why it can be used here.
    channelArtifacts: async (channelId: string) => {
      const [artifacts, posts] = await Promise.all([
        db.getAll<LibraryRow>(
          `select id, kind, name, mime, inline_content, size_bytes, promoted, message_id, task_id, tags, created_at
           from artifacts where channel_id = ? order by created_at desc limit 200`,
          [channelId],
        ).catch(orEmpty<LibraryRow>('channelArtifacts.artifacts')),
        db.getAll<DraftedPost>(
          `select id, body, media, task_id, created_at from content_items where channel_id = ? order by created_at desc limit 200`,
          [channelId],
        ).catch(orEmpty<DraftedPost>('channelArtifacts.posts')),
      ]);
      return { artifacts: channelLibrary(artifacts, posts) };
    },

    // A CONVERSATION's own produced files. Artifacts carry no thread_id — a chat's files land with
    // the message_id of the agent turn that wrote them — so the thread is reached through its
    // messages. The join is the anchor that already exists; no migration.
    threadArtifacts: async (threadId: string) => ({
      artifacts: await db.getAll<ChannelArtifactRow>(
        `select a.id, a.kind, a.name, a.mime, a.inline_content, a.size_bytes, a.promoted, a.message_id, a.task_id, a.created_at
           from artifacts a join messages m on m.id = a.message_id
          where m.thread_id = ? order by a.created_at asc`,
        [threadId],
      ).catch(orEmpty('threadArtifacts')),
    }),

    // ONE artifact by id: the ‹article:id› card reads its own row, self-contained like WbCard.
    // Workspace-scoped like every read here.
    artifact: async (artifactId: string) => ({
      artifact: (await db.getAll<ArtifactWide>(
        `select a.id, a.kind, a.name, a.mime, a.inline_content, a.size_bytes, a.promoted, a.channel_id,
                a.task_id, a.created_at, c.slug as channel_slug
           from artifacts a left join channels c on c.id = a.channel_id
          where a.id = ? and a.workspace_id = ? limit 1`,
        [artifactId, ws()],
      ).catch(orEmpty<ArtifactWide>('artifact')))[0] ?? null,
    }),

    // artifactDelete intentionally NOT here — webnm-actions.ts owns every write that posts a command

    /**
     * OPEN AN ARTICLE OUTSIDE THE APP. The renderer hands over the article's already-rendered HTML
     * (styles inlined, images as data URLs); the desktop writes it to a temp file and shells out.
     * A tab has a shorter path to the same place — a blob: URL of the same bytes, opened in a new
     * tab — and it is honest offline for the same reason: no server is involved either way. The
     * name the desktop puts on the temp file has no equivalent; a blob: URL carries no filename.
     *
     * NO 'noopener' IN THE FEATURES STRING, and that is not an oversight: window.open returns NULL
     * whenever noopener is set, by spec — so the blocked-popup check below would have fired on
     * every SUCCESSFUL open and turned each one into an error. The severing is done by hand on the
     * handle instead, which keeps null meaning what the check needs it to mean. (Caught in the live
     * harness; a stubbed window.open had hidden it.)
     */
    articleExternal: async (_name: string, html: string) => {
      const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
      const win = window.open(url, '_blank');
      // a blocked tab THROWS rather than resolving {ok:true}: "nothing happened" is exactly the
      // outcome the caller has to be able to tell the human about
      if (!win) {
        URL.revokeObjectURL(url);
        throw new Error('your browser blocked the new tab — allow pop-ups for this site and try again');
      }
      try { win.opener = null; } catch { /* cross-origin by now: already severed */ }
      // revoked late: revoking before the new document has fetched the blob leaves it blank
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      return { ok: true };
    },
  };
}

/** ported from sync/ipc/skills.ts */
function skillLanes(cfg: WebNmConfig, db: PowerSyncDatabase): Partial<NMBridge> {
  const ws = () => cfg.workspaceId();
  return {
    // channelId null = WORKSPACE-WIDE (the Skills destination). A channel id keeps the old
    // behaviour — that room's skills plus the workspace-scoped ones — which is what the composer's
    // `/` picker wants, since a picker offering skills from a room you are not in is a picker of
    // things that will not run here.
    watchSkills: (channelId: string | null, cb: (rows: SkillRow[]) => void) =>
      watch<SkillRow>(db, ['skills', 'channels'], () =>
        db.getAll<SkillRow>(
          `select s.id, s.name, s.description, s.scope, s.body, s.status, s.author_kind, s.author_id, s.version, s.channel_id, s.pack_id, s.enabled, s.updated_at,
                  c.slug as channel_slug
           from skills s left join channels c on c.id = s.channel_id
           where s.workspace_id = ? and s.status in ('active', 'draft') and (? is null or s.channel_id = ? or s.channel_id is null)
           order by s.status = 'draft' desc, s.channel_id is null, s.updated_at desc`,
          [ws(), channelId ?? null, channelId ?? null],
        ).catch(orEmpty('watchSkills')), cb),

    // skill packs for the channel — drives the Skills-tab pack sections
    watchSkillPacks: (channelId: string, cb: (rows: SkillPackRow[]) => void) =>
      watch<SkillPackRow>(db, ['skill_packs'], () =>
        db.getAll<SkillPackRow>(
          `select id, name, description, source_url, source_ref, version, origin, enabled, status, step, progress, error, updated_at
           from skill_packs where workspace_id = ? and channel_id = ? order by origin = 'bundled' desc, name`,
          [ws(), channelId],
        ).catch(orEmpty('watchSkillPacks')), cb),

    skillCreate: async (input) => {
      const r = (await postCommand(cfg, {
        type: 'skill.create', workspace: ws(),
        ...(input.scope === 'channel' ? { channel: input.channelSlug } : {}),
        name: input.name, description: input.description, scope: input.scope, body: input.body,
      })) as { skillId?: string };
      // a create that produced no id is a failure the caller must see, not a blank row
      if (!r.skillId) throw new Error('skill.create returned no skill id');
      return { skillId: r.skillId };
    },
    skillUpdate: (input) =>
      postCommand(cfg, {
        type: 'skill.update', skillId: input.skillId,
        ...(input.description ? { description: input.description } : {}),
        ...(input.body ? { body: input.body } : {}),
        ...(input.scope ? { scope: input.scope } : {}),
      }),
    skillDeprecate: (skillId: string) => postCommand(cfg, { type: 'skill.deprecate', skillId }),
    skillPromote: (skillId: string) => postCommand(cfg, { type: 'skill.promote', skillId }),
    skillSetEnabled: (skillId: string, enabled: boolean) => postCommand(cfg, { type: 'skill.set_enabled', skillId, enabled }),

    skillpackSetEnabled: (packId: string, enabled: boolean) => postCommand(cfg, { type: 'skillpack.set_enabled', packId, enabled }),
    skillpackRemove: (packId: string) => postCommand(cfg, { type: 'skillpack.remove', packId }),
    // add a pack by GitHub URL: create the importing row (the host Curator watch clones/parses/
    // commits it). Pack name derives from the repo unless given. NOTE the browser cannot BE that
    // curator — the import only completes once a machine running the host picks the row up.
    skillpackAdd: async (input) => {
      const repo = input.url.trim().replace(/\.git$/, '').replace(/\/+$/, '').split('/').pop() ?? 'pack';
      const packName = (input.name?.trim() || repo).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'pack';
      const r = (await postCommand(cfg, {
        type: 'skillpack.create', workspace: ws(), channel: input.channelSlug, name: packName, description: '',
        sourceUrl: input.url.trim(), sourceRef: input.ref?.trim() || 'main', origin: 'imported',
      })) as { packId?: string };
      return { ok: true, packId: r.packId };
    },
    // retry a failed import: flip the row back to 'importing' so the host watch re-fires
    skillpackRetry: (packId: string) => postCommand(cfg, { type: 'skillpack.update', packId, status: 'importing', step: 'Queued…', progress: 0, error: '' }),
  };
}

/** ported from sync/ipc/whiteboards.ts + the two board watches in ipc/watch-crew.ts (docs/38) */
function whiteboardLanes(cfg: WebNmConfig, db: PowerSyncDatabase): Partial<NMBridge> {
  const ws = () => cfg.workspaceId();
  return {
    // snapshot_svg rides the list (tiles render it), so the cap stays modest — 60 boards is
    // multiple screens of grid; the destination is a recency surface, not an archive browser.
    watchWhiteboards: (scope: { channelId?: string | null; projectId?: string | null }, cb: (rows: unknown[]) => void) => {
      const base = `select w.id, w.channel_id, c.slug as channel_slug, w.thread_id, w.task_id, w.title, w.snapshot_svg, w.snapshot_rev,
                         w.rev, w.source, w.created_by_kind, w.created_by, w.created_at, w.updated_at
                    from whiteboards w join channels c on c.id = w.channel_id
                   where w.archived_at is null`;
      const [sql, params]: [string, string[]] = scope.channelId
        ? [`${base} and w.channel_id = ? order by w.updated_at desc limit 60`, [scope.channelId]]
        : scope.projectId
          ? [`${base} and c.project_id = ? order by w.updated_at desc limit 60`, [scope.projectId]]
          : [`${base} order by w.updated_at desc limit 60`, []];
      return watch<unknown>(db, ['whiteboards', 'channels'], () => db.getAll<unknown>(sql, params).catch(orEmpty('watchWhiteboards')), cb);
    },

    // one board, for the canvas that has it open. `row` not `rows`: the contract hands back the
    // single row or null, so a deleted board reads as gone rather than as an empty list.
    watchWhiteboard: (id: string, cb: (row: unknown | null) => void) =>
      watch<unknown>(db, ['whiteboards', 'channels'], () =>
        db.getAll<unknown>(
          `select w.*, c.slug as channel_slug from whiteboards w join channels c on c.id = w.channel_id where w.id = ?`,
          [id],
        ).catch(orEmpty('watchWhiteboard')), (rows) => cb(rows[0] ?? null)),

    /**
     * The three HUMAN write lanes are LOCAL-FIRST, exactly as the desktop's are: the row lands in
     * the replica and the shared ps_crud uploader forwards it to /v1/whiteboards (upload.ts already
     * handles the table, PUT and PATCH). That is what makes an offline edit queue rather than fail,
     * and what makes a stale autosave ACK applied:false instead of wedging the queue. Every save
     * bumps rev CLIENT-side — the editor owns the base it built on.
     */
    wbCreate: async (channelId: string, opts?: { title?: string; threadId?: string }) => {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      await db.execute(
        `insert into whiteboards (id, workspace_id, channel_id, thread_id, title, snapshot_rev, rev, created_by_kind, created_by, updated_by_kind, updated_by, created_at, updated_at)
         values (?, ?, ?, ?, ?, 0, 1, 'human', ?, 'human', ?, ?, ?)`,
        [id, ws(), channelId, opts?.threadId ?? null, opts?.title?.trim() || 'Untitled board', cfg.actorId(), cfg.actorId(), now, now],
      );
      return { id };
    },

    wbSave: async (id: string, rev: number, patch: { scene?: string; snapshotSvg?: string; title?: string }) => {
      const now = new Date().toISOString();
      if (patch.snapshotSvg != null) {
        // the still rides with the scene it pictures — snapshot_rev = this save's rev
        await db.execute(
          `update whiteboards set scene = coalesce(?, scene), snapshot_svg = ?, snapshot_rev = ?, title = coalesce(?, title),
             rev = ?, updated_by_kind = 'human', updated_by = ?, updated_at = ? where id = ?`,
          [patch.scene ?? null, patch.snapshotSvg, rev, patch.title ?? null, rev, cfg.actorId(), now, id],
        );
      } else {
        await db.execute(
          `update whiteboards set scene = coalesce(?, scene), title = coalesce(?, title),
             rev = ?, updated_by_kind = 'human', updated_by = ?, updated_at = ? where id = ?`,
          [patch.scene ?? null, patch.title ?? null, rev, cfg.actorId(), now, id],
        );
      }
    },

    wbArchive: async (id: string, rev: number, restore?: boolean) => {
      const now = new Date().toISOString();
      await db.execute(
        `update whiteboards set archived_at = ?, rev = ?, updated_by_kind = 'human', updated_by = ?, updated_at = ? where id = ?`,
        [restore ? null : now, rev, cfg.actorId(), now, id],
      );
    },

    /**
     * …and the STRICT command lane, which is the one exception to "let the write throw". It returns
     * the server's verdict instead, because WHITEBOARD_STALE is an expected outcome of a
     * materialize race — the caller re-reads and reapplies — not a failure to report.
     */
    wbUpdateCmd: async (payload) => {
      const res = await fetch(`${cfg.apiUrl}/v1/commands`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(await authHeaders(cfg)) },
        body: JSON.stringify({ type: 'whiteboard.update', ...payload }),
      });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      return { ok: res.ok, status: res.status, ...body };
    },
  };
}

export function shelfOverrides(cfg: WebNmConfig, db: PowerSyncDatabase): Partial<NMBridge> {
  return { ...libraryLanes(cfg, db), ...skillLanes(cfg, db), ...whiteboardLanes(cfg, db) };
}
