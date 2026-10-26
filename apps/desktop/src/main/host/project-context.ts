import type { AttDbLike } from '../agents';
import { readArtifactText, type ArtifactContentRow } from './artifact-content';
import type { LibDoc } from './orchtools';

export interface ProjectAnchor { threadId?: string | null; taskId?: string | null }
export interface ProjectContext { id: string; name: string; slug: string; workspace_id: string; context_channel_id: string | null; brand_profile: string | null; website: string | null; logo_url: string | null }

/** A thread/task's explicit owner wins. The old channel is only a legacy fallback. */
export async function projectContext(db: AttDbLike, channelId: string, at: ProjectAnchor = {}): Promise<ProjectContext | null> {
  const [project] = await db.getAll<ProjectContext>(
    `select p.* from channels c
     left join threads t on t.id = ? and t.channel_id = c.id and t.workspace_id = c.workspace_id
     left join tasks k on k.id = ? and k.channel_id = c.id and k.workspace_id = c.workspace_id
     join projects p on p.id = coalesce(k.project_id, t.project_id, c.project_id) and p.workspace_id = c.workspace_id
     where c.id = ?`, [at.threadId ?? null, at.taskId ?? null, channelId]);
  return project ?? null;
}

/** Shared by conversational and coding tools. Legacy room scope now means the active project. */
export async function projectLibrary(db: AttDbLike, channelId: string, limit = 60, scope: 'room' | 'project' | 'workspace' = 'project', at: ProjectAnchor = {}, name?: string, offset = 0): Promise<LibDoc[]> {
  const project = await projectContext(db, channelId, at);
  if (!project) return [];
  const rows = await db.getAll<ArtifactContentRow & LibDoc & { resolved_project_id: string | null }>(
    `with ranked as (select a.*, c.slug as room, p.name as project, p.id as resolved_project_id,
       row_number() over (partition by coalesce(a.project_id, c.project_id), a.name order by a.created_at desc, a.id desc) as library_rank from artifacts a
     left join channels c on c.id = a.channel_id and c.workspace_id = a.workspace_id
     left join projects p on p.id = coalesce(a.project_id, c.project_id) and p.workspace_id = a.workspace_id
     where a.workspace_id = ? ${scope === 'workspace' ? '' : 'and coalesce(a.project_id, c.project_id) = ?'}
       ${name === undefined ? '' : 'and lower(a.name) = lower(?)'}
       and (a.inline_content is not null or a.storage_path like 'brain:%'))
     select * from ranked where library_rank = 1 order by created_at desc, id desc limit ? offset ?`,
    [project.workspace_id, ...(scope === 'workspace' ? [] : [project.id]), ...(name === undefined ? [] : [name]), Math.max(1, Math.min(300, limit)), Math.max(0, offset)]);
  return rows.map(row => ({ ...row, ...(row.storage_path?.startsWith('brain:') ? { readContent: () => readArtifactText(db, row) } : {}) }));
}

export async function projectRepos(db: AttDbLike, channelId: string, at: ProjectAnchor = {}) {
  const project = await projectContext(db, channelId, at);
  if (!project) return [];
  return db.getAll<{ id: string; org_name: string; name: string; default_branch: string; is_primary: number }>(
    `select r.id, r.org_name, r.name, r.default_branch, pr.is_primary from repos r
     join project_repos pr on pr.repo_id = r.id where pr.project_id = ? and r.workspace_id = ?
     order by coalesce(pr.is_primary, 0) desc, r.org_name, r.name, r.id`, [project.id, project.workspace_id]);
}
