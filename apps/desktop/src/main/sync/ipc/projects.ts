// Projects, channels, threads, the marketing setup flow and the MCP keys — extracted
// from sync.ts. Structure commands, all server-authoritative.
import { app } from 'electron';
import { api, ensureMarketingSeedsRef } from '../../sync';
import { ipcMain } from 'electron';
import { parseBrainOverride } from '@neuramesh/shared';
import type { PowerSyncDatabase } from '@powersync/node';

export interface ProjectsDeps {
  /** the replica, for the one handler that merges into a thread's current brain override */
  db: () => PowerSyncDatabase;
  ws: () => string;
}

export function registerProjects({ db, ws }: ProjectsDeps): void {
// project management (humans post as themselves); rows sync back so the
// switcher + sidebar see changes immediately.
ipcMain.handle('nm:project-create', async (_e, { name, description, slug, newChannels, website, logoUrl }: { name: string; description?: string; slug?: string; newChannels?: string[]; website?: string; logoUrl?: string }) =>
  api('/v1/commands', { type: 'project.create', workspace: ws(), name: name.trim(), ...(slug ? { slug } : {}), description: (description ?? '').trim(), website: website?.trim() || undefined, logoUrl: logoUrl || undefined, newChannels: newChannels ?? [] }));
ipcMain.handle('nm:project-update', async (_e, { projectId, name, description, website, logoUrl, autoOpenPr, runCiBeforeMerge, shipGate, modelPack }: { projectId: string; name?: string; description?: string; website?: string; logoUrl?: string; autoOpenPr?: boolean; runCiBeforeMerge?: boolean; shipGate?: boolean; modelPack?: string }) =>
  api('/v1/commands', { type: 'project.update', project: projectId, name: name?.trim(), description: description?.trim(), website: website?.trim(), logoUrl, autoOpenPr, runCiBeforeMerge, shipGate, modelPack }));
ipcMain.handle('nm:project-archive', async (_e, { projectId, archived }: { projectId: string; archived: boolean }) =>
  api('/v1/commands', { type: archived ? 'project.archive' : 'project.unarchive', project: projectId }));
ipcMain.handle('nm:project-delete', async (_e, { projectId }: { projectId: string }) =>
  api('/v1/commands', { type: 'project.delete', project: projectId }));
// channel (room) CRUD — create carries the owning project; rename/delete carry the channel id.
ipcMain.handle('nm:channel-create', async (_e, { projectId, slug, topic }: { projectId: string; slug: string; topic?: string }) =>
  api('/v1/commands', { type: 'channel.create', workspace: ws(), project: projectId, slug: slug.trim(), topic: (topic ?? '').trim() }));
ipcMain.handle('nm:channel-rename', async (_e, { channelId, slug, topic }: { channelId: string; slug?: string; topic?: string }) =>
  api('/v1/commands', { type: 'channel.rename', channel: channelId, slug: slug?.trim(), topic: topic?.trim() }));
ipcMain.handle('nm:channel-delete', async (_e, { channelId }: { channelId: string }) =>
  api('/v1/commands', { type: 'channel.delete', channel: channelId }));
// the docs/20 `channel.set_thread_mode` IPC is dropped (docs/35 §12): the lens it drove is
// gone, and nothing on the desktop reads `channels.thread_mode` any more. The server command,
// its handler and the column itself are left alone — unused, harmless, cheaper than a migration.
// docs/34 — the Tasks toggle on an OPEN conversation (the escalation valve). Server-side
// HUMAN_ONLY; this handler only exists on the desktop, where the actor is always the human.
ipcMain.handle('nm:thread-set-mode', async (_e, { threadId, mode }: { threadId: string; mode: 'tasks' | 'chat' }) =>
  api('/v1/commands', { type: 'thread.set_mode', workspace: ws(), threadId, mode }));
// Archiving a conversation (0108). Server-side HUMAN_ONLY and chat-only; this handler exists only
// on the desktop, where the actor is always the human.
ipcMain.handle('nm:thread-archive', async (_e, { threadId }: { threadId: string }) =>
  api('/v1/commands', { type: 'thread.archive', workspace: ws(), threadId }));
ipcMain.handle('nm:thread-unarchive', async (_e, { threadId }: { threadId: string }) =>
  api('/v1/commands', { type: 'thread.unarchive', workspace: ws(), threadId }));
// Settling a thread (0137): its status, nothing else. HUMAN_ONLY server-side, any thread.
ipcMain.handle('nm:thread-settle', async (_e, { threadId }: { threadId: string }) =>
  api('/v1/commands', { type: 'thread.settle', workspace: ws(), threadId }));
ipcMain.handle('nm:thread-unsettle', async (_e, { threadId }: { threadId: string }) =>
  api('/v1/commands', { type: 'thread.unsettle', workspace: ws(), threadId }));
// Renaming a conversation from its rail row (rail-ink round, 2026-09-04). `thread.update` has
// been a server command since docs/34 (human or orchestrator); this is the first client door.
ipcMain.handle('nm:thread-update', async (_e, { threadId, title, description }: { threadId: string; title?: string; description?: string }) =>
  api('/v1/commands', { type: 'thread.update', workspace: ws(), threadId, ...(title !== undefined ? { title } : {}), ...(description !== undefined ? { description } : {}) }));
// docs/10 §15 — the conversation's brain override (role → model). `override: null` is Reset,
// the WHOLE override. Server-side HUMAN_ONLY; this handler only exists on the desktop, where
// the actor is always the human.
ipcMain.handle('nm:thread-set-brain', async (_e, { threadId, override }: { threadId: string; override: Record<string, string> | null }) =>
  api('/v1/commands', { type: 'thread.set_brain', workspace: ws(), threadId, override }));
// one seat of one conversation → a model (the auth card's "Use Starter here", 2026-09-17). Merged
// here from the replica's current override, so a card in a thread that already moved two other
// seats does not reset them; the server still validates the whole map and keeps it HUMAN_ONLY.
// the same row, read: the auth card asks whether its seat already moved, so a reload never shows a
// button for a switch that already happened
ipcMain.handle('nm:thread-brain', async (_e, { threadId }: { threadId: string }) => {
  const row = await db().get<{ brain_override: string | null }>('select brain_override from threads where id = ?', [threadId]).catch(() => null);
  return parseBrainOverride(row?.brain_override ?? null);
});
ipcMain.handle('nm:thread-brain-role', async (_e, { threadId, role, model }: { threadId: string; role: string; model: string }) => {
  const row = await db().get<{ brain_override: string | null }>('select brain_override from threads where id = ?', [threadId]).catch(() => null);
  const current = parseBrainOverride(row?.brain_override ?? null) ?? {};
  return api('/v1/commands', { type: 'thread.set_brain', workspace: ws(), threadId, override: { ...current, [role]: model } });
});
ipcMain.handle('nm:channel-kind', async (_e, { channelId, kind }: { channelId: string; kind: 'build' | 'marketing' }) => {
  const out = await api('/v1/commands', { type: 'channel.set_kind', channel: channelId, kind });
  // the room just became an HQ — staff it now (pack + plume), not at the next reboot
  if (kind === 'marketing') void ensureMarketingSeedsRef?.(ws(), [channelId]);
  return out;
});
ipcMain.handle('nm:marketing-setup', async (_e, { channelId, website, focus, goal }: { channelId: string; website: string; focus: string[]; goal?: string }) =>
  api('/v1/commands', { type: 'marketing.setup', channel: channelId, website: website || undefined, focus: focus.length ? focus : undefined, goal: goal || undefined }));
// one answered setup-flow step (setupflows.ts) — persisted as it lands so the wizard resumes
ipcMain.handle('nm:setup-step', async (_e, { channelId, flow, step, value }: { channelId: string; flow: string; step: string; value?: string | string[] }) =>
  api('/v1/commands', { type: 'setup.step', channel: channelId, flow, step, value }));
// marketing MCP integrations (integrations-and-skills-plan.md): the toggle syncs on the
// room; the credential stays MACHINE-LOCAL (mcp-keys.json) — never synced, never on our
// server. The get returns presence only; raw keys never cross to the renderer.
ipcMain.handle('nm:marketing-integration', async (_e, { channelId, provider, enabled }: { channelId: string; provider: 'posthog' | 'meta' | 'tiktok'; enabled: boolean }) =>
  api('/v1/commands', { type: 'marketing.set_integration', channel: channelId, provider, enabled }));
ipcMain.handle('nm:mcp-keys', async () => {
  const { readMcpKeys, mcpKeyPresence } = await import('../../mkmcp');
  const keys = readMcpKeys(app.getPath('userData'));
  return { presence: mcpKeyPresence(keys), metaUrl: keys.metaUrl ?? '', tiktokUrl: keys.tiktokUrl ?? '' };
});
ipcMain.handle('nm:mcp-key-set', async (_e, { provider, value }: { provider: 'posthog' | 'meta' | 'metaUrl' | 'tiktok' | 'tiktokUrl'; value: string }) => {
  const { writeMcpKey, mcpKeyPresence } = await import('../../mkmcp');
  const keys = writeMcpKey(app.getPath('userData'), provider, value);
  return { presence: mcpKeyPresence(keys) };
});
// verify BEFORE save (round 12): probe the provider's MCP endpoint with the credential —
// the same initialize a research run opens with, so ✓ means it actually works
ipcMain.handle('nm:mcp-verify', async (_e, { provider, url, token }: { provider: 'posthog' | 'meta' | 'tiktok'; url?: string; token: string }) => {
  const { verifyMcpEndpoint, POSTHOG_MCP_URL } = await import('../../mkmcp');
  const target = provider === 'posthog' ? POSTHOG_MCP_URL : (url ?? '');
  if (!target) return { ok: false, detail: 'connector URL required' };
  return verifyMcpEndpoint(target, token);
});
}
