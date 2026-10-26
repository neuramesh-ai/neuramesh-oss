import type { AttDbLike } from '../agents';

/** Direct ownership wins over the compatibility context. Every conversational agent gets it. */
export async function projectNote(db: AttDbLike, channelId: string, at: { threadId?: string | null; taskId?: string } = {}): Promise<string> {
  const [project] = await db.getAll<{ name: string; slug: string }>(
    `select p.name, p.slug from channels c
       left join threads t on t.id = ? and t.channel_id = c.id
       left join tasks k on k.id = ? and k.channel_id = c.id
       join projects p on p.id = coalesce(k.project_id, t.project_id, c.project_id) and p.workspace_id = c.workspace_id
       where c.id = ?`,
    [at.threadId ?? null, at.taskId ?? null, channelId],
  );
  return project ? `\n\nThis conversation belongs to the project “${project.name}” (slug: ${project.slug}). Use this project as its scope.` : '';
}
