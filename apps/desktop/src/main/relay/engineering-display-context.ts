import {agentDataDb,withAgentData} from '../host/agent-data';
import { skillBody, workspaceSkills } from '../host/workspace-skills';
import { z } from 'zod';
import { jsonSchemaFor } from '../harness/toolschema';
import { projectLibrary, projectRepos } from '../host/project-context';
import { newGrounding, listLibrary, readLibraryDoc } from '../host/grounding';
import { makeRepoReader } from '../host/reporead';
import { messageBoardsFor } from '../host/messageboards';
import { messageBoardTools } from '../host/tools-messageboards';
import { apiAuthHeaders } from '../apiauth';
import type { AttDbLike, HostedAgent } from '../agents';
import type { EngineeringMachineOpenMeta } from '../../engineering-protocol';
import type { EngineeringDisplayContext } from './engineering-display';

/** Bind shared display tools to the authenticated coding thread's room. */
/** `cwd`: the session's worktree. A read of the session's own repository (or of the default one, which is
 *  the session's) comes from that checkout, whatever the repository's host: a git or bundle repository has
 *  no GitHub door, and a GitHub one needs no grant for a checkout the session already holds */
export async function resolveEngineeringDisplayContext(db: AttDbLike, apiUrl: string, workspaceId: string, meta: EngineeringMachineOpenMeta, cwd?: string): Promise<EngineeringDisplayContext | null> {
  const room = (await db.getAll<{ id: string; slug: string; workspace_id: string }>(
    'select c.id, c.slug, c.workspace_id from threads t join channels c on c.id = t.channel_id where t.id = ? and c.workspace_id = ?', [meta.threadId, workspaceId]))[0];
  if (!room) return null;
  const at = { threadId: meta.threadId };
  const library: import('../host/grounding').LibraryReader = (id, limit, scope, _at, name, offset) => projectLibrary(db, id, limit, scope, at, name, offset);
  const grounding = newGrounding();
  const checkout = (repoId: string | undefined): string | null => (cwd && meta.repoId && (!repoId || repoId === meta.repoId) ? cwd : null);
  const reader = makeRepoReader({ db, channelId: room.id, at, actor: { kind: 'human', id: meta.actorId }, checkout,
    apiGet: async path => fetch(`${apiUrl}${path}`, { headers: await apiAuthHeaders(apiUrl, { kind: 'human', id: meta.actorId }), signal: AbortSignal.timeout(30_000) }) });
  const repo = z.string().uuid().optional().describe('Repository id from list_repos, or omit for the primary repository.');
  const scope = z.enum(['project', 'room', 'workspace']).optional();
  const tool = <T extends z.ZodRawShape>(name: string, description: string, shape: T, run: (i: z.infer<z.ZodObject<T>>) => Promise<unknown>) => ({ name, description, inputSchema: jsonSchemaFor(shape), execute: async (i: unknown) => run(z.object(shape).strict().parse(i)) });
  // Message boards (host/messageboards.ts): asked here, before the list is built, so the four tools exist
  // only when a person gave the thread's agent access to a board
  const messageBoards = await messageBoardsFor(meta.agentId);
  return { ...room, projectTools: () => [
    tool('load_skill', 'Load an enabled workspace skill by name. Use it when the user attaches a skill to their message. The optional pack identifies the requested copy.', { name: z.string().min(1), pack: z.string().optional() }, async i => skillBody(await workspaceSkills(db, workspaceId), i.name, i.pack)),
    tool('list_library', 'List the active project files, including brand documents and historical project contexts. Available in every thread. Returns up to 60 documents; use offset 60, 120, etc. for subsequent pages.', { scope, offset: z.number().int().min(0).optional() }, i => listLibrary(library, room.id, i.scope ?? 'project', i.offset)),
    tool('read_library_doc', 'Read a project document by name from list_library before making claims about the product.', { name: z.string().min(1), scope }, i => readLibraryDoc(library, room.id, i.name, i.scope ?? 'project', grounding)),
    tool('list_repos', 'List all repositories attached to the active project. Pass an id to the repository read tools.', {}, () => projectRepos(db, room.id, at)),
    tool('read_repo_file', 'Read a file in a project repository. Read only.', { repo, path: z.string().min(1), ref: z.string().optional() }, i => reader.file(i)),
    tool('list_repo_files', 'List a project repository folder. Read only.', { repo, path: z.string().optional(), ref: z.string().optional() }, i => reader.tree(i)),
    tool('list_repo_changes', 'Read recent commits, pull requests and releases in a project repository.', { repo, since: z.string().optional() }, i => reader.changes(i)),
    ...messageBoardTools({ z, messageBoards }).map(t => tool(t.name, t.description, t.schema, i => t.run(i))),
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

/** Resolve and execute display tools under the selected agent's current channel
 * grant. A model/agent change builds a new context before any history is sent. */
export async function resolveAuthorizedEngineeringDisplayContext(source:AttDbLike,apiUrl:string,workspace:string,meta:EngineeringMachineOpenMeta,cwd?:string,transport:{fetchImpl?:typeof fetch;headers?:()=>Promise<Record<string,string>>}={}):Promise<EngineeringDisplayContext> {
 if(!meta.agentId)throw new Error('Choose a workspace agent before using this conversation.');
 const options={...transport,apiUrl,workspace,agentId:meta.agentId,callerId:meta.actorId,subject:{kind:'thread' as const,id:meta.threadId}},db=agentDataDb(source,workspace);
 const context=await withAgentData(options,()=>resolveEngineeringDisplayContext(db,apiUrl,workspace,meta,cwd));
 if(!context)throw new Error('This conversation is outside the selected agent channel access.');
 return {...context,projectTools:()=>context.projectTools?.().map(tool=>({...tool,execute:input=>withAgentData(options,()=>tool.execute(input))}))??[],shareImage:context.shareImage?((agent,brief)=>withAgentData(options,()=>context.shareImage!(agent,brief))):undefined};
}
