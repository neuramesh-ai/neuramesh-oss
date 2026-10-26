import { z } from 'zod';
import { jsonSchemaFor } from '../harness/toolschema';
import { projectLibrary, projectRepos } from '../host/project-context';
import { newGrounding, listLibrary, readLibraryDoc } from '../host/grounding';
import { makeRepoReader } from '../host/reporead';
import { apiAuthHeaders } from '../apiauth';
import type { AttDbLike, HostedAgent } from '../agents';
import type { EngineeringMachineOpenMeta } from '../../engineering-protocol';
import type { EngineeringDisplayContext } from './engineering-display';

/** Bind shared display tools to the authenticated coding thread's room. */
export async function resolveEngineeringDisplayContext(db: AttDbLike, apiUrl: string, workspaceId: string, meta: EngineeringMachineOpenMeta): Promise<EngineeringDisplayContext | null> {
  const room = (await db.getAll<{ id: string; slug: string; workspace_id: string }>(
    'select c.id, c.slug, c.workspace_id from threads t join channels c on c.id = t.channel_id where t.id = ? and c.workspace_id = ?', [meta.threadId, workspaceId]))[0];
  if (!room) return null;
  const at = { threadId: meta.threadId };
  const library: import('../host/grounding').LibraryReader = (id, limit, scope, _at, name, offset) => projectLibrary(db, id, limit, scope, at, name, offset);
  const grounding = newGrounding();
  const reader = makeRepoReader({ db, channelId: room.id, at, actor: { kind: 'human', id: meta.actorId },
    apiGet: async path => fetch(`${apiUrl}${path}`, { headers: await apiAuthHeaders(apiUrl, { kind: 'human', id: meta.actorId }), signal: AbortSignal.timeout(30_000) }) });
  const repo = z.string().uuid().optional().describe('Repository id from list_repos, or omit for the primary repository.');
  const scope = z.enum(['project', 'room', 'workspace']).optional();
  const tool = <T extends z.ZodRawShape>(name: string, description: string, shape: T, run: (i: z.infer<z.ZodObject<T>>) => Promise<unknown>) => ({ name, description, inputSchema: jsonSchemaFor(shape), execute: async (i: unknown) => run(z.object(shape).strict().parse(i)) });
  return { ...room, projectTools: () => [
    tool('list_library', 'List the active project files, including brand documents and historical project contexts. Available in every thread. Returns up to 60 documents; use offset 60, 120, etc. for subsequent pages.', { scope, offset: z.number().int().min(0).optional() }, i => listLibrary(library, room.id, i.scope ?? 'project', i.offset)),
    tool('read_library_doc', 'Read a project document by name from list_library before making claims about the product.', { name: z.string().min(1), scope }, i => readLibraryDoc(library, room.id, i.name, i.scope ?? 'project', grounding)),
    tool('list_repos', 'List all repositories attached to the active project. Pass an id to the repository read tools.', {}, () => projectRepos(db, room.id, at)),
    tool('read_repo_file', 'Read a file in a project repository. Read only.', { repo, path: z.string().min(1), ref: z.string().optional() }, i => reader.file(i)),
    tool('list_repo_files', 'List a project repository folder. Read only.', { repo, path: z.string().optional(), ref: z.string().optional() }, i => reader.tree(i)),
    tool('list_repo_changes', 'Read recent commits, pull requests and releases in a project repository.', { repo, since: z.string().optional() }, i => reader.changes(i)),
  ], shareImage: async (agent, brief) => {
    const profiles = await db.getAll<Pick<HostedAgent, 'id' | 'name' | 'runtime' | 'model'> & { role: string }>(
      `select a.id, a.name, coalesce(a.runtime, 'claude-code') as runtime, a.model, a.role from agents a
       where a.workspace_id = ? and a.retired_at is null and (a.id = ? or (a.role = 'designer' and a.id in (select agent_id from agent_channels where channel_id = ?)))`, [workspaceId, agent.id, room.id]);
    const speaker = profiles.find(profile => profile.id === agent.id);
    if (!speaker) return { error: 'The selected agent is no longer available in this workspace.' };
    const { shareImage } = await import('../host/share-image');
    return shareImage({ apiUrl, ownerActorId: meta.actorId, db, designer: profiles.find(profile => profile.role === 'designer') }, speaker, room, brief);
  } };
}
