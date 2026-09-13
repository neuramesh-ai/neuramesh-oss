// Skills and skill packs: the two watches plus the CRUD that rides the control-api —
// extracted from sync.ts.
import { ipcMain, type WebContents } from 'electron';
import { api, watchFailed } from '../../sync';
import type { PowerSyncDatabase } from '@powersync/node';

export interface SkillsDeps {
  db: () => PowerSyncDatabase;
  ws: () => string;
  /** startSync's subscription registry — a watch registered here stays abortable there */
  watchers: Map<string, AbortController>;
}

export function registerSkills({ db, ws, watchers }: SkillsDeps): void {
// Agent Skills (W11): channel + global active skills sync to the replica;
// the screen watches them, the host's agents read them for load_skill.
// channelId null = WORKSPACE-WIDE (the Skills destination). A channel id keeps the old
// behaviour — that room's skills plus the workspace-scoped ones — which is what the composer's
// `/` picker wants, since a picker offering skills from a room you are not in is a picker of
// things that will not run here.
ipcMain.handle('nm:watch-skills', (event, { subId, channelId }: { subId: string; channelId: string | null }) => {
  const ac = new AbortController();
  watchers.set(subId, ac);
  const sender: WebContents = event.sender;
  db().watch(
    `select s.id, s.name, s.description, s.scope, s.body, s.status, s.author_kind, s.author_id, s.version, s.channel_id, s.pack_id, s.enabled, s.updated_at,
            c.slug as channel_slug
     from skills s left join channels c on c.id = s.channel_id
     where s.workspace_id = ? and s.status in ('active', 'draft') and (? is null or s.channel_id = ? or s.channel_id is null)
     order by s.status = 'draft' desc, s.channel_id is null, s.updated_at desc`,
    [ws(), channelId ?? null, channelId ?? null],
    {
      onResult: (r) => { if (!sender.isDestroyed()) sender.send('nm:skills', { subId, rows: (r.rows?._array ?? []) as unknown[] }); },
      onError: watchFailed,
    },
    { signal: ac.signal },
  );
});
// skill packs for the channel — drives the Skills-tab pack sections
ipcMain.handle('nm:watch-skill-packs', (event, { subId, channelId }: { subId: string; channelId: string }) => {
  const ac = new AbortController();
  watchers.set(subId, ac);
  const sender: WebContents = event.sender;
  db().watch(
    `select id, name, description, source_url, source_ref, version, origin, enabled, status, step, progress, error, updated_at
     from skill_packs where workspace_id = ? and channel_id = ? order by origin = 'bundled' desc, name`,
    [ws(), channelId],
    {
      onResult: (r) => { if (!sender.isDestroyed()) sender.send('nm:skill-packs', { subId, rows: (r.rows?._array ?? []) as unknown[] }); },
      onError: watchFailed,
    },
    { signal: ac.signal },
  );
});
ipcMain.handle('nm:skillpack-set-enabled', async (_e, { packId, enabled }: { packId: string; enabled: boolean }) => api('/v1/commands', { type: 'skillpack.set_enabled', packId, enabled }));
ipcMain.handle('nm:skillpack-remove', async (_e, { packId }: { packId: string }) => api('/v1/commands', { type: 'skillpack.remove', packId }));
// add a pack by GitHub URL: create the importing row (the host Curator watch
// clones/parses/commits it). Pack name derives from the repo unless given.
ipcMain.handle('nm:skillpack-add', async (_e, { channelSlug, url, ref, name }: { channelSlug: string; url: string; ref?: string; name?: string }) => {
  const repo = url.trim().replace(/\.git$/, '').replace(/\/+$/, '').split('/').pop() ?? 'pack';
  const packName = (name?.trim() || repo).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'pack';
  return api('/v1/commands', { type: 'skillpack.create', workspace: ws(), channel: channelSlug, name: packName, description: '', sourceUrl: url.trim(), sourceRef: ref?.trim() || 'main', origin: 'imported' });
});
// retry a failed import: flip the row back to 'importing' so the host watch re-fires
ipcMain.handle('nm:skillpack-retry', async (_e, { packId }: { packId: string }) => api('/v1/commands', { type: 'skillpack.update', packId, status: 'importing', step: 'Queued…', progress: 0, error: '' }));
ipcMain.handle('nm:skill-set-enabled', async (_e, { skillId, enabled }: { skillId: string; enabled: boolean }) => api('/v1/commands', { type: 'skill.set_enabled', skillId, enabled }));
ipcMain.handle('nm:skill-create', async (_e, input: { channelSlug?: string; name: string; description: string; scope: 'channel' | 'global'; body: string }) =>
  api('/v1/commands', { type: 'skill.create', workspace: ws(), ...(input.scope === 'channel' ? { channel: input.channelSlug } : {}), name: input.name, description: input.description, scope: input.scope, body: input.body }),
);
ipcMain.handle('nm:skill-update', async (_e, input: { skillId: string; description?: string; body?: string; scope?: 'channel' | 'global' }) =>
  api('/v1/commands', { type: 'skill.update', skillId: input.skillId, ...(input.description ? { description: input.description } : {}), ...(input.body ? { body: input.body } : {}), ...(input.scope ? { scope: input.scope } : {}) }),
);
ipcMain.handle('nm:skill-deprecate', async (_e, { skillId }: { skillId: string }) => api('/v1/commands', { type: 'skill.deprecate', skillId }));
ipcMain.handle('nm:skill-promote', async (_e, { skillId }: { skillId: string }) => api('/v1/commands', { type: 'skill.promote', skillId }));
}
