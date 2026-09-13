// ROOM IPC — the channel list, one room's full metadata, its people, and its crew.
//
// Four handlers split out of startSync. A channel is the ACL boundary (docs/06): an agent sees
// a task through its channel, not its project, which is why the roster and the member list are
// room questions rather than workspace ones.
//
// REGISTRATION POSITION IS LOAD-BEARING (see whiteboards.ts) — called from where these sat.
import { ipcMain } from 'electron';
import type { PowerSyncDatabase } from '@powersync/node';

export function registerRoomIpc(deps: {
  ws: () => string;
  db: () => PowerSyncDatabase;
  /** the room's crew, resolved by startSync (it owns the agent map) */
  loadRoster: () => Promise<unknown>;
}): void {
  const { ws, db, loadRoster } = deps;

  // the one-shot "have we seen any channels yet" flag. It was a `let` in startSync used by
  // nothing but nm:channels, so it came along rather than crossing as a holder.
  let probed = false;

  ipcMain.handle('nm:channels', async () => {
    // BUSIEST ROOMS FIRST (2026-08-11, George). Slug order put #build ahead of #general on every
    // surface that lists rooms — alphabetical is an order about NAMES, and the rail's chip strip
    // folds past two, so the room you actually live in could sit inside a "+N". `msg_count` counts
    // the room's whole papertrail, task threads included: a room is busy because work happens in
    // it, not only because people chat in it. Snapshot-at-load on purpose — this handler is
    // one-shot, so chips never re-order under the cursor mid-session.
    const rows = await db().getAll(
      `select c.id, c.slug, c.topic, c.project_id, c.kind, c.marketing, c.created_by_kind, c.created_by, c.created_at,
              (select count(*) from messages m where m.channel_id = c.id) as msg_count
         from channels c where c.workspace_id = ? order by msg_count desc, c.slug`,
      [ws()],
    );
    if (!probed || rows.length) {
      probed = true;
      console.log(`ipc_probe=channels rows=${rows.length}`);
    }
    return rows;
  });

  ipcMain.handle('nm:channel-meta', async (_e, { channelId }: { channelId: string }) => ({
    // channels → projects is 1:N (channels.project_id): the row whose id matches the channel's
    // project comes first; the old per-channel projects.channel_id column is dead in the model.
    projects: await db().getAll(
      `select p.id, p.name, p.slug, p.is_default from projects p join channels c on c.id = ?
        where p.workspace_id = c.workspace_id and coalesce(p.status, 'active') != 'archived'
        order by (p.id = c.project_id) desc, p.is_default desc, p.name`,
      [channelId],
    ),
    // THIS CHANNEL'S PROJECT's repos — never every repo in the replica, which is what it used to
    // return. `wscope` takes the first local one it finds, so an unfiltered list meant the ＋ menu
    // offered "Open a file… from flowe-ai" while you stood in neuramesh, and a terminal opened
    // from there would have run in the wrong checkout (George, 2026-08-02).
    //
    // FAIL CLOSED: the join is the proof of ownership, so a repo with no project_repos row simply
    // does not appear. Before 0107 published that table the replica had no proof to offer and this
    // returns empty — which reads as "this machine" in the menu. That is the correct degradation:
    // claiming someone else's checkout is worse than claiming none.
    repos: await db().getAll(
      `select r.id, r.provider, r.org_name, r.name, r.default_branch, r.local_path,
              (select group_concat(pr2.project_id) from project_repos pr2 where pr2.repo_id = r.id) as project_ids,
              (select group_concat(pr3.project_id) from project_repos pr3 where pr3.repo_id = r.id and coalesce(pr3.is_primary, 0) = 1) as primary_project_ids
         from repos r
         join project_repos pr on pr.repo_id = r.id
         join channels c on c.id = ? and c.project_id = pr.project_id
        order by pr.is_primary desc, r.org_name, r.name`,
      [channelId],
    ).catch(() => []),
    // The WORKSPACE's repos, for the two surfaces that are about the workspace rather than the
    // room (Workspace settings → General, and the Add-repo modal). This field was declared in the
    // renderer's bridge type and consumed by both, but NEVER returned here — so the first
    // channelMeta reply replaced `{projects, repos, reposAll: []}` with a payload missing the
    // third key, `meta.reposAll` went undefined, and `repos.length` in WorkspaceSettings threw
    // and UNMOUNTED the whole app. Opening Workspace settings blanked the window (verified over
    // CDP on this build, 2026-08-09; `git log -S reposAll` shows it was never wired).
    //
    // No project_repos join: this one is deliberately unscoped, and a repo attached to no project
    // is exactly what the Add-repo modal exists to fix — hiding it would hide the thing to fix.
    reposAll: await db().getAll(
      `select r.id, r.provider, r.org_name, r.name, r.default_branch, r.local_path,
              (select group_concat(pr2.project_id) from project_repos pr2 where pr2.repo_id = r.id) as project_ids,
              (select group_concat(pr3.project_id) from project_repos pr3 where pr3.repo_id = r.id and coalesce(pr3.is_primary, 0) = 1) as primary_project_ids
         from repos r
         join channels c on c.id = ?
        where r.workspace_id = c.workspace_id
        order by r.org_name, r.name`,
      [channelId],
    ).catch(() => []),
  }));

  ipcMain.handle('nm:roster', async () => loadRoster());


  ipcMain.handle('nm:members', async () =>
    db().getAll(`select user_id, role, display_name, compute from workspace_members where workspace_id = ? order by display_name`, [ws()]));
}
