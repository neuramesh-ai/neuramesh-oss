import { uniqueWorkspaceSkills } from '@neuramesh/shared';
import type { AttDbLike, SkillRef } from '../agents';

/** Workspace boundary is mandatory. Room provenance no longer restricts where a skill runs. */
export async function workspaceSkills(db: AttDbLike, workspaceId: string): Promise<SkillRef[]> {
  const rows = await db.getAll<SkillRef & { id: string; version: number; updated_at: string }>(
    `select s.id, s.name, s.description, s.body, s.version, s.updated_at, p.name as pack_name
     from skills s left join skill_packs p on p.id = s.pack_id and p.workspace_id = s.workspace_id
     where s.workspace_id = ? and s.status = 'active' and s.enabled = 1
       and (s.pack_id is null or p.enabled = 1)`, [workspaceId]);
  return uniqueWorkspaceSkills(rows);
}

export function skillBody(skills: readonly SkillRef[], name: string, pack?: string): string {
  const skill = skills.find(row => row.name === name && (!pack || row.pack_name === pack));
  return skill ? `# Skill: ${skill.name}\n${skill.description}\n\n${skill.body}` : `No enabled workspace skill named "${name}"${pack ? ` in pack "${pack}"` : ''}.`;
}
