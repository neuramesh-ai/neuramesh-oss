// Workspace settings: policies, the sandbox toggle, the agents' footprint, billing,
// model packs and machine transfer — extracted from sync.ts.
import { refreshHouseStyle } from '../../housestyle';
import { app, shell } from 'electron';
import { homedir } from 'node:os';
import { isCustomPackId, resolvePackRoles, runtimeForModel, type AgentRole, type CustomModelPack } from '@neuramesh/shared';
import { berthSweepNow } from '../../agents';
import { api, cur, machineLimit, setMachineLimit, thisMachineName } from '../../sync';
import { pulseSelects } from '../../projmeta';
import { assembleFootprint, fleetLocations, readHistory, scanFleet } from '../../footprint';
import { brainRoot } from '../../harness/brain';
import { sandboxEnvForced, sandboxFsEnabled, setSandboxFsCache } from '../../runtime/adapter';
import { writeSandboxSetting } from '../../sandbox/setting';
import { ipcMain } from 'electron';
import type { PowerSyncDatabase } from '@powersync/node';

export interface SettingsDeps {
  db: () => PowerSyncDatabase;
  ws: () => string;
}

export function registerSettings({ db, ws }: SettingsDeps): void {
// the Projects page + head: all workspace projects with the channels they own, an
// open-task count, the four-bucket pulse (projmeta.ts), the registered-agent count,
// and a last-activity stamp — all read from the local replica (fast + offline, no
// network). projects own channels (1:N) — a project's channels = channels.project_id.
// last_activity rides tasks.updated_at (small table, touched by every FSM/beat move);
// a max over messages would scan the largest table every 2.5s poll for little gain.
ipcMain.handle('nm:workspace-meta', async () => ({
  projects: await db().getAll(
    `select p.id, p.name, p.slug, p.is_default, p.status, p.description, p.auto_open_pr, p.run_ci_before_merge, p.ship_gate, p.website, p.logo_url, p.model_pack,
       (select group_concat(c.slug) from channels c where c.project_id = p.id) as channel_slugs,
       (select c.slug from channels c where c.project_id = p.id order by c.slug limit 1) as primary_channel,
       (select count(*) from tasks t where t.project_id = p.id and t.state not in ('closed', 'accepted')) as open_tasks,
       ${pulseSelects('p')},
       (select count(distinct ac.agent_id) from agent_channels ac
          join channels ca on ca.id = ac.channel_id
          join agents ag on ag.id = ac.agent_id
        where ca.project_id = p.id and ag.retired_at is null) as agents_count,
       (select max(t2.updated_at) from tasks t2 where t2.project_id = p.id) as last_activity
     from projects p where p.workspace_id = ? order by p.is_default desc, p.name`,
    [ws()],
  ),
}));

// Workspace settings (the provider-auth failover policy). workspaces aren't PowerSync-
// replicated, so the current value is read from the control-api (/v1/workspaces) rather than
// the local replica; the update posts a command.
ipcMain.handle('nm:workspace-settings', async () => {
  const { workspaces } = (await api('/v1/workspaces')) as { workspaces: Array<{ id: string; autoFailover?: boolean; activeModelPack?: string; commRules?: unknown; plan?: string; seats?: number; subscriptionStatus?: string | null; currentPeriodEnd?: string | null; primaryMachineId?: string | null }> };
  const w = workspaces.find((x) => x.id === ws());
  console.log(`workspace_plan ws=${ws().slice(0, 8)} plan=${w?.plan ?? 'free'}`); // the hosted gate's input (shell/hostedrule.ts)
  return { autoFailover: !!w?.autoFailover, activeModelPack: w?.activeModelPack ?? 'custom', commRules: w?.commRules ?? null, plan: w?.plan ?? 'free', seats: w?.seats ?? 1, subscriptionStatus: w?.subscriptionStatus ?? null, currentPeriodEnd: w?.currentPeriodEnd ?? null, primaryMachineId: w?.primaryMachineId ?? null };
});
// Create a workspace and nothing else — no crew, no machine, no rebind. The browser wizard
// calls this at its FIRST step because the id it returns is what the workspace's cloud machine
// is provisioned against (FLEET_AUTOPROVISION); the desktop keeps building its workspace inside
// nm:onboard at the Launch step, so this stays unused there rather than forking that flow.
ipcMain.handle('nm:workspace-create', async (_e, { name, slug }: { name: string; slug: string }) =>
  api('/v1/commands', { type: 'workspace.create', name, slug }));
// The credit ring's read (docs/design/cloud-first-2026-08/starter-brain-and-credits.md §5.7).
// Over HTTP like nm:workspace-settings above, and for the same reason twice over:
// `workspace_credits` and `machine_usage` are deliberately outside the sync publication, so
// there is no local row to read — and membership is checked server-side on every call.
// ABSENCE IS AN ANSWER: a control-api that doesn't serve credits answers 501, which api()
// throws. Collapsing that (and any network failure) to null lets the ring render NOTHING
// rather than a full ring nobody can trust. A workspace with no credit row is NOT this case —
// it reads zeros, which is a real balance and draws an empty ring.
// A LOCAL connection has no credits at all (review F13): null, so the ring draws NOTHING — the
// local stack's /v1/usage would answer zeros, and zeros draw an empty ring that means the wrong thing.
ipcMain.handle('nm:usage', async () => {
  if (cur().kind === 'local') return null;
  try { return await api(`/v1/usage?workspace=${encodeURIComponent(ws())}`); } catch { return null; }
});
ipcMain.handle('nm:workspace-update', async (_e, { autoFailover, activeModelPack, commRules }: { autoFailover?: boolean; activeModelPack?: string; commRules?: { ste100?: boolean; noEmdash?: boolean; custom?: string[] } }) => {
  const r = await api('/v1/commands', { type: 'workspace.update', workspace: ws(), autoFailover, activeModelPack, commRules });
  // a voice change reaches the very next agent turn — no TTL wait, no restart
  if (commRules !== undefined) void refreshHouseStyle();
  return r;
});
// Agent permission policies (Phase 1): read persisted overrides from the replica (the
// renderer merges them with the shared baseline); writes go through the command handler.
ipcMain.handle('nm:policies', async () =>
  db().getAll('select id, scope, capability, selector, verdict, rationale, locked, project_id from policies where workspace_id = ?', [ws()]));
ipcMain.handle('nm:policy-set', async (_e, input: Record<string, unknown>) =>
  api('/v1/commands', { type: 'policy.set', workspace: ws(), ...input }));
ipcMain.handle('nm:policy-delete', async (_e, { id }: { id: string }) =>
  api('/v1/commands', { type: 'policy.delete', workspace: ws(), policyId: id }));
// Per-machine FS-sandbox toggle (containment L1b): LOCAL, not synced — the sandbox jails THIS
// machine's agent processes. sandbox-set persists to userData + updates the live cache the daemon
// reads on the next agent run (no restart). envForced tells the UI when NM_SANDBOX_FS pins it.
ipcMain.handle('nm:sandbox-get', async () => ({ enabled: sandboxFsEnabled(), envForced: sandboxEnvForced() }));
ipcMain.handle('nm:sandbox-set', async (_e, { enabled }: { enabled: boolean }) => {
  writeSandboxSetting(app.getPath('userData'), enabled);
  setSandboxFsCache(enabled);
  return { ok: true };
});
// ── Agents' footprint (worktree-berths round): machine-scoped disk truth — LOCAL like the
// sandbox toggle, never synced. One 15-min TTL cache around the full payload: the fleet du can
// run seconds cold on a 70GB third-party dir, so quick=true (the Home card) never waits on a
// scan — it serves the cache, or history-only while a background build warms it.
let fpCache: { at: number; payload: import('../../footprint').FootprintPayload } | null = null;
let fpInflight: Promise<import('../../footprint').FootprintPayload> | null = null;
const fpBuild = (): Promise<import('../../footprint').FootprintPayload> => {
  fpInflight ??= (async () => {
    const rows: import('../../footprint').FootprintDbRows = {
      tasks: await db().getAll<{ number: number; title: string | null; state: string; repo_id: string | null; branch: string | null }>(
        'select number, title, state, repo_id, branch from tasks').catch(() => []),
      repos: await db().getAll<{ id: string; name: string | null; local_path: string | null }>(
        'select id, name, local_path from repos').catch(() => []),
      openByRepo: await db().getAll<{ repo_id: string; n: number }>(
        `select repo_id, count(*) as n from tasks where repo_id is not null and state not in ('accepted','closed') group by repo_id`).catch(() => []),
    };
    const payload = await assembleFootprint(brainRoot(), rows);
    payload.fleet = await scanFleet(fleetLocations(homedir(), rows.repos));
    fpCache = { at: Date.now(), payload };
    fpInflight = null;
    return payload;
  })();
  return fpInflight;
};
ipcMain.handle('nm:footprint-get', async (_e, { quick }: { quick?: boolean } = {}) => {
  // quick (the Home ring): never block — serve the cache, or history-only while a build warms.
  // full (the destination): an explicit visit ALWAYS re-measures — the live harness caught the
  // ring's boot-warmed cache serving a 15-min-old machine to a user who just opened the view.
  if (quick) {
    if (fpCache && Date.now() - fpCache.at < 15 * 60_000) return { ready: true, payload: fpCache.payload };
    void fpBuild().catch(() => {});
    return { ready: false, history: await readHistory(brainRoot()) };
  }
  return { ready: true, payload: await fpBuild() };
});
ipcMain.handle('nm:footprint-reclaim', async () => {
  const snapshot = await berthSweepNow(); // null = no agent host on this machine
  fpCache = null;
  return { snapshot, ...(await (async () => ({ ready: true as const, payload: await fpBuild() }))()) };
});
// Apply a model-config pack (builtin or a `custom:<uuid>` custom brain): re-point every
// PACK-MANAGED (model_source='pack'), non-remote agent to the pack's model for its role, then
// persist active_model_pack LAST so a stored pack id always means "fully applied" (partial
// failure leaves the old id + surfaces a retry). Manual pins (model_source='manual') and
// remote A2A agents are deliberately left untouched.
ipcMain.handle('nm:apply-pack', async (_e, { packId }: { packId: string }) => {
  const custom = isCustomPackId(packId)
    ? (((await api(`/v1/model-packs?workspace=${ws()}`)) as { packs?: CustomModelPack[] }).packs ?? [])
    : [];
  const roles = resolvePackRoles(packId, custom);
  if (!roles) throw new Error(`unknown model pack: ${packId}`);
  const agents = await db().getAll<{ id: string; role: string }>(
    `select id, role from agents where workspace_id = ? and model_source = 'pack' and coalesce(kind, 'local') != 'remote' and retired_at is null`,
    [ws()],
  );
  for (const a of agents) {
    const model = roles[a.role as AgentRole] ?? roles.developer;
    await api('/v1/commands', { type: 'agent.update', agent: a.id, model, runtime: runtimeForModel(model), modelSource: 'pack' });
  }
  await api('/v1/commands', { type: 'workspace.update', workspace: ws(), activeModelPack: packId });
  return { ok: true, applied: agents.length };
});
// Custom brains (user-authored packs): list for the pickers; save/delete post the human-only
// commands. Workspace-scoped config — read on demand, like nm:workspace-settings above.
ipcMain.handle('nm:model-packs', async () => api(`/v1/model-packs?workspace=${ws()}`));
ipcMain.handle('nm:model-pack-save', async (_e, input: { packId?: string; name: string; roles: Record<string, string> }) =>
  api('/v1/commands', { type: 'modelpack.save', workspace: ws(), ...input }));
ipcMain.handle('nm:model-pack-delete', async (_e, { packId }: { packId: string }) =>
  api('/v1/commands', { type: 'modelpack.delete', workspace: ws(), packId }));
// Billing: mint a hosted Stripe Checkout / Customer-Portal URL and open it in the user's external
// browser — they pay on Stripe's page, never in-app (BYO-payment, like BYO-keys). The webhook flips
// workspaces.plan; the renderer re-reads plan on window focus, so gates unlock on return.
ipcMain.handle('nm:billing-checkout', async () => {
  const { url } = (await api('/v1/billing/checkout', { workspace: ws() })) as { url?: string };
  if (url) await shell.openExternal(url);
  return { ok: !!url };
});
ipcMain.handle('nm:billing-portal', async () => {
  const { url } = (await api('/v1/billing/portal', { workspace: ws() })) as { url?: string };
  if (url) await shell.openExternal(url);
  return { ok: !!url };
});
// the utilization dashboard's history — daily meters + the grant ledger, read-only.
ipcMain.handle('nm:credits-history', async () => {
  try { return await api(`/v1/credits/history?workspace=${encodeURIComponent(ws())}`); } catch { return null; }
});
// buy a credit pack: the client names a SIZE, the server prices it (never client-priced), then
// the human pays on Stripe's page exactly as the Cloud checkout does.
ipcMain.handle('nm:credits-checkout', async (_e, { credits }: { credits: number }) => {
  const { url } = (await api('/v1/billing/credits-checkout', { workspace: ws(), credits })) as { url?: string };
  if (url) await shell.openExternal(url);
  return { ok: !!url };
});
// Free single-machine limit (P1b): the renderer reads this on mount to show the transfer-or-upgrade
// card. Transfer re-registers THIS machine as the primary (the other stops being primary) and
// relaunches clean so it boots as the active machine + starts its agent host.
ipcMain.handle('nm:machine-limit-info', async () => machineLimit());
ipcMain.handle('nm:machines-usage', async () => {
  try { return await api(`/v1/machines/usage?workspace=${encodeURIComponent(ws())}`); }
  // a meter that cannot be read must not blank the surfaces that render from it: null is the
  // "we could not look" the callers already branch on, and it is NOT the same as an empty day.
  catch { return null; }
});
ipcMain.handle('nm:machine-wake', async () => {
  try { return await api('/v1/machines/wake', { workspace: ws() }); }
  catch (e) { return { ok: false, error: e instanceof Error ? e.message : 'wake failed' }; }
});
ipcMain.handle('nm:machine-transfer', async () => {
  await api('/v1/commands', { type: 'machine.register', workspace: ws(), name: thisMachineName(), transfer: true });
  setMachineLimit(null);
  setTimeout(() => { app.relaunch(); app.exit(0); }, 120); // let the IPC reply land before we relaunch
  return { ok: true };
});
ipcMain.handle('nm:sync-agents', async () =>
  api('/v1/commands', { type: 'workspace.sync_agents', workspace: ws() }));
}
