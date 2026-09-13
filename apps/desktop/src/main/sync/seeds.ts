// THE BOOT SEEDS, per connection: the bundled skill packs, the curator, the designer, the shipper
// and the marketer a workspace onboarded before each existed. Idempotent server-side; best-effort.
import { isCustomPackId, resolvePackRoles, type CustomModelPack } from '@neuramesh/shared';
import type { PowerSyncDatabase } from '@powersync/node';
import type { Connection } from '../connections';
import { planDesignerSeed, planMarketerSeed, planShipperSeed } from '../seed';
import { apiOn } from '../sync';
import { registerThisMachine } from './machine';
import { actorId } from '../sync';
import { apiAuthHeaders } from '../apiauth';

// on THIS connection's credential, not the foreground's (sync.ts apiOn): a cloud connection
// seeding beside the local stack must not send the stack's bearer to the cloud
const post = (conn: Connection) => async (body: unknown) => fetch(`${conn.apiUrl}/v1/commands`, {
  method: 'POST',
  headers: await apiAuthHeaders(conn.apiUrl, { kind: 'human', id: actorId(conn) }),
  body: JSON.stringify(body),
}).catch(() => {});

const packRolesFor = async (conn: Connection, workspaceId: string) => {
  const pack = await apiOn(conn, '/v1/workspaces')
    .then((r) => ((r as { workspaces: Array<{ id: string; activeModelPack?: string }> }).workspaces.find((w) => w.id === workspaceId)?.activeModelPack ?? null))
    .catch(() => null);
  // custom brains resolve from the server; builtin from the shared catalog
  const custom = pack && isCustomPackId(pack)
    ? (((await apiOn(conn, `/v1/model-packs?workspace=${workspaceId}`).catch(() => ({}))) as { packs?: CustomModelPack[] }).packs ?? [])
    : [];
  return resolvePackRoles(pack, custom);
};

// Marketing-room seeds — the pack + plume 🦚 — extracted so they fire from BOTH the
// boot backfill AND the moment a room becomes marketing-kind (George hit the gap:
// boot → create room → run setup in one session left the HQ without its marketer
// until the next restart, and rex fronted the foundation). Idempotent server-side.
export async function ensureMarketingSeeds(conn: Connection, db: PowerSyncDatabase, workspaceId: string, channelIds: string[]): Promise<void> {
  if (!channelIds.length) return;
  const send = post(conn);
  for (const ch of channelIds) {
    await send({ type: 'skillpack.seed_defaults', workspace: workspaceId, channel: ch, kind: 'marketing' });
  }
  // setup tasks for rooms that predate setup flows (2026-08-09) — the release-day backfill.
  // Idempotent server-side (partial-unique + untouched-profile rule): configured rooms and
  // rooms that already hold one are left alone, so firing from boot AND kind-flip is safe.
  await send({ type: 'setup.backfill', workspace: workspaceId });
  const machineIdForSeed = conn.thisMachineId ?? await registerThisMachine(conn, actorId).catch(() => null);
  if (!machineIdForSeed) return;
  const hasMarketer = await db.getAll(`select 1 from agents where workspace_id = ? and role = 'marketer' limit 1`, [workspaceId]).catch(() => []);
  if (hasMarketer.length) return;
  const packRoles = await packRolesFor(conn, workspaceId);
  const [plume] = await db.getAll<{ role: string }>(`select role from agents where workspace_id = ? and name = 'plume' limit 1`, [workspaceId]).catch(() => [] as Array<{ role: string }>);
  const plan = planMarketerSeed({ hasMarketer: false, plumeRole: plume?.role ?? null, packRoles, workspace: workspaceId, machineId: machineIdForSeed, channelId: channelIds[0]! });
  if (plan.action === 'register') await send(plan.cmd);
  else console.warn(`marketer_seed skipped: ${plan.reason}`);
}

// bundled default skill packs: backfill every #dev channel the user is in
// that lacks them (new workspaces are seeded at creation; this covers
// already-created channels). Idempotent server-side; best-effort.
export async function backfillSeeds(conn: Connection, db: PowerSyncDatabase, machineId: string | null): Promise<void> {
  const send = post(conn);
  for (let i = 0; i < 40; i++) {
    // seed packs + a Curator into THIS workspace's #dev rooms, addressed by channel id —
    // slugs repeat across projects now, so the bare slug 'dev' (and no workspace filter)
    // would be ambiguous / cross-workspace.
    // 'build' is the seeded engineering room since the channel-kinds work; 'dev' is
    // its pre-rename name in existing workspaces — the backfill serves both.
    const devs = await db.getAll<{ id: string; workspace_id: string }>(`select id, workspace_id from channels where slug in ('dev', 'build') and workspace_id = ?`, [conn.ws]).catch(() => []);
    if (!devs.length) { await new Promise((r) => setTimeout(r, 500)); continue; }
    // the seeded engineering room is 'build' since the channel-kinds work; existing
    // workspaces still carry the pre-rename 'dev'. Unify by renaming (id is identity,
    // the slug is a label) — skipped when the project already has a 'build' room.
    const devNamed = await db.getAll<{ id: string; project_id: string }>(`select id, project_id from channels where slug = 'dev' and workspace_id = ?`, [conn.ws]).catch(() => []);
    for (const r of devNamed) {
      const clash = await db.getAll(`select 1 from channels where slug = 'build' and project_id = ? limit 1`, [r.project_id]).catch(() => []);
      if (!clash.length) await send({ type: 'channel.rename', channel: r.id, slug: 'build' });
    }
    for (const d of devs) {
      await send({ type: 'skillpack.seed_defaults', workspace: d.workspace_id, channel: d.id });
      if (!machineId) continue;
      // ensure a Curator agent owns skill-pack imports (host-managed, roster-visible). One per
      // workspace — skip if it already exists (this or another machine). Registered to THIS
      // machine so the import watch in startAgentHost picks it up.
      const hasCurator = await db.getAll(`select 1 from agents where workspace_id = ? and role = 'curator' limit 1`, [d.workspace_id]).catch(() => []);
      if (!hasCurator.length) await send({ type: 'agent.register', workspace: d.workspace_id, machineId, name: 'curator', role: 'curator', channels: [d.id] });
      // ensure a Designer exists for workspaces onboarded before v0.11 (new ones seed iris at
      // onboarding): the design gate (docs/14) dead-ends without one. Pack-aware brain; a human's
      // same-named agent is never repointed (see planDesignerSeed). Same doctrine for the Shipper
      // (docs/23): the release gate defaults ON for PR-backed tasks and dead-ends without one.
      const hasDesigner = await db.getAll(`select 1 from agents where workspace_id = ? and role = 'designer' limit 1`, [d.workspace_id]).catch(() => []);
      const hasShipper = await db.getAll(`select 1 from agents where workspace_id = ? and role = 'shipper' limit 1`, [d.workspace_id]).catch(() => []);
      if (!hasDesigner.length || !hasShipper.length) {
        const packRoles = await packRolesFor(conn, d.workspace_id);
        if (!hasDesigner.length) {
          const [iris] = await db.getAll<{ role: string }>(`select role from agents where workspace_id = ? and name = 'iris' limit 1`, [d.workspace_id]).catch(() => [] as Array<{ role: string }>);
          const plan = planDesignerSeed({ hasDesigner: false, irisRole: iris?.role ?? null, packRoles, workspace: d.workspace_id, machineId, channelId: d.id });
          if (plan.action === 'register') await send(plan.cmd);
          else console.warn(`designer_seed skipped: ${plan.reason}`);
        }
        if (!hasShipper.length) {
          const [bosun] = await db.getAll<{ role: string }>(`select role from agents where workspace_id = ? and name = 'bosun' limit 1`, [d.workspace_id]).catch(() => [] as Array<{ role: string }>);
          const plan = planShipperSeed({ hasShipper: false, bosunRole: bosun?.role ?? null, packRoles, workspace: d.workspace_id, machineId, channelId: d.id });
          if (plan.action === 'register') await send(plan.cmd);
          else console.warn(`shipper_seed skipped: ${plan.reason}`);
        }
      }
      // marketing-kind rooms: the marketing-core pack + plume 🦚, via the same helper the
      // kind-set IPC fires — boot covers rooms that predate this machine; the IPC covers rooms
      // flipped to marketing mid-session.
      const mkAll = await db.getAll<{ id: string }>(`select id from channels where kind = 'marketing' and workspace_id = ?`, [d.workspace_id]).catch(() => []);
      await ensureMarketingSeeds(conn, db, d.workspace_id, mkAll.map((m) => m.id));
    }
    return;
  }
}
