// THE BROWSER'S ROOMS, PROJECTS AND ACTIVITY — the lanes bootOverrides was holding open with
// `async () => []`.
//
// Those stubs were honest placeholders ("the L1 trio goes live with the sync slice") and they
// became a lie the moment someone onboarded on the web: a workspace is created with a default
// project and four channels in ONE transaction, the crew registers against the cloud machine,
// and then the browser showed "This project has no channels yet · No threads yet · no agents",
// because every one of those reads answered with an empty array rather than asking the replica.
// Nothing was missing but the questions.
//
// So these are ports, not new behaviour: the same SQL the desktop's IPC handlers run, against the
// same replica the web client already syncs. Where the desktop reads `WS` from module state, the
// web reads it from cfg — that is the whole difference. `pulseSelects` is imported rather than
// copied so the two clients cannot drift on what a project's pulse counts (main/projmeta.ts is
// electron-free, which is why it can be imported here at all).
import type { PowerSyncDatabase } from '@powersync/web';
import { pulseSelects } from '../../main/projmeta';
import type { NMBridge } from '../src/bridge/nm';
import type { ChannelRow } from '../src/bridge/rows-rooms';
import type { ProjectRow, RepoUI, WorkspaceProjectRow } from '../src/bridge/rows-board';
import type { WebNmConfig } from './webnm';


/**
 * `Partial<NMBridge>`, NOT `Record<string, unknown>`. The overrides are handed to a proxy, so an
 * untyped bag typechecks whatever it contains — and a wrong SHAPE then fails only in use. That is
 * not hypothetical: `send` is positional (channelId, body, opts) and was first written here to
 * take one options object, which would have posted `undefined` as the body of every message and
 * compiled cleanly. Typing the bag against the contract makes the compiler the thing that checks
 * every lane, instead of whoever happens to try the feature.
 */
/** A failed read must not look like an empty workspace — that is the exact bug these lanes were
 *  written to fix ("no channels yet" on a workspace that had four). So it SAYS SO and then yields
 *  empty, rather than yielding empty quietly. */
const orEmpty = <T>(what: string) => (e: unknown): T[] => {
  console.error(`[webnm] ${what} failed:`, e);
  return [];
};

export function roomOverrides(cfg: WebNmConfig, db: PowerSyncDatabase): Partial<NMBridge> {
  const ws = () => cfg.workspaceId();
  return {
    // ported from sync/ipc/rooms.ts. BUSIEST ROOMS FIRST — a room is busy because work happens
    // in it, so msg_count counts the whole papertrail, task threads included.
    channels: async () =>
      db.getAll<ChannelRow>(
        `select c.id, c.slug, c.topic, c.project_id, c.kind, c.marketing, c.created_by_kind, c.created_by, c.created_at,
                (select count(*) from messages m where m.channel_id = c.id) as msg_count
           from channels c where c.workspace_id = ? order by msg_count desc, c.slug`,
        [ws()],
      ).catch(orEmpty('channels')),

    // ported from sync/ipc/settings.ts nm:workspace-meta — the project switcher's rows, with the
    // counts its cards read. Without this the switcher offered "New project / All projects" and
    // named none, on a workspace that always has at least the Default one.
    workspaceMeta: async () => ({
      projects: await db.getAll<WorkspaceProjectRow>(
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
      ).catch(orEmpty('workspaceMeta.projects')),
    }),

    // ported from sync/ipc/rooms.ts nm:channel-meta. The project the channel belongs to comes
    // first. Repos are workspace identities, not claims that the browser has local checkouts:
    // Engineering sends the repo id to the selected machine, which resolves or clones it there.
    // `local_path` therefore remains nullable on web while the cloud workflow stays usable.
    channelMeta: async (channelId: string) => ({
      projects: await db.getAll<ProjectRow>(
        `select p.id, p.name, p.slug, p.is_default from projects p join channels c on c.id = ?
          where p.workspace_id = c.workspace_id and coalesce(p.status, 'active') != 'archived'
          order by (p.id = c.project_id) desc, p.is_default desc, p.name`,
        [channelId],
      ).catch(orEmpty('channelMeta.projects')),
      repos: await db.getAll<RepoUI>(
        `select r.id, r.provider, r.org_name, r.name, r.default_branch, r.local_path,
                (select group_concat(pr2.project_id) from project_repos pr2 where pr2.repo_id = r.id) as project_ids,
                (select group_concat(pr3.project_id) from project_repos pr3 where pr3.repo_id = r.id and coalesce(pr3.is_primary, 0) = 1) as primary_project_ids
           from repos r
           join project_repos pr on pr.repo_id = r.id
           join channels c on c.id = ? and c.project_id = pr.project_id
          order by pr.is_primary desc, r.org_name, r.name`,
        [channelId],
      ).catch(orEmpty('channelMeta.repos')),
      reposAll: await db.getAll<RepoUI>(
        `select r.id, r.provider, r.org_name, r.name, r.default_branch, r.local_path,
                (select group_concat(pr2.project_id) from project_repos pr2 where pr2.repo_id = r.id) as project_ids,
                (select group_concat(pr3.project_id) from project_repos pr3 where pr3.repo_id = r.id and coalesce(pr3.is_primary, 0) = 1) as primary_project_ids
           from repos r
           join channels c on c.id = ?
          where r.workspace_id = c.workspace_id
          order by r.org_name, r.name`,
        [channelId],
      ).catch(orEmpty('channelMeta.reposAll')),
    }),

    // ported from sync/ipc/messages.ts — the unread dots on room chips and board cards. A room
    // with no activity simply has no row, which is what the consumers already expect.
    latest: async () =>
      db.getAll<{ channel_id: string; latest: string }>(
        `select channel_id, max(created_at) as latest from messages where workspace_id = ? and task_id is null group by channel_id`,
        [ws()],
      ).catch(orEmpty('latest')),

    latestThreads: async () =>
      db.getAll<{ task_id: string; latest: string }>(
        `select task_id, max(created_at) as latest from messages where workspace_id = ? and task_id is not null group by task_id`,
        [ws()],
      ).catch(orEmpty('latestThreads')),

    /**
     * The sync pill, told the truth. It was pinned to `connected: false`, so the browser said
     * "Local" forever — including while it was streaming perfectly. That is worse than no pill:
     * it is the one indicator someone checks when they suspect sync, and it was hardcoded to the
     * answer that makes them suspect it.
     */
    status: async () => {
      const s = db.currentStatus;
      return {
        connected: !!s?.connected,
        lastSyncedAt: s?.lastSyncedAt ? new Date(s.lastSyncedAt).toISOString() : null,
      };
    },
  };
}
