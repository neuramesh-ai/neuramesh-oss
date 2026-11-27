import {agentAuthorization} from './agent-replica-scope';
import {z} from 'zod';
import type { Actor, Destination } from '@neuramesh/shared';
import type { Hono } from 'hono';
import type { Store } from './store';
import type { Command } from './commands';
import { sqlOf } from './credits';
import { destinationPermission } from './store/destinations';
import { DomainError } from './errors';
import { canonicalUuid } from './store/scope-rows';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function idsIn(value: unknown, into = new Set<string>(), depth = 0): Set<string> {
  if (depth > 15 || into.size > 1000) return into;
  // every form that PostgreSQL reads as a uuid (no hyphens, a hyphen after any group of four digits), in its standard form
  if (typeof value === 'string') for (const m of value.match(/[0-9a-f]{4}(?:-?[0-9a-f]{4}){7}/gi) ?? []) { const id = canonicalUuid(m); if (id) into.add(id); }
  else if (Array.isArray(value)) for (const v of value) idsIn(v,into,depth+1);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) idsIn(v,into,depth+1);
  return into;
}
export async function mayUseDestination(store: Store, actor: Actor, workspace: string, destination: Destination) {
  return !!store.destinations && (await destinationPermission(store.destinations,actor,workspace,destination)).canView;
}
/** Lock-screen previews are data delivery too, including explicitly named recipients. */
export async function marketingDeliveryAllowed(store:Store,memberId:string,workspace:string,data:Record<string,unknown>) {
  return !(await restrictedIds(store,{kind:'human',id:memberId},{input:{workspace,...data,channel:data.channelId}})).size;
}
/** When a member acts through an agent, memory must satisfy both identities. */
export async function destinationReadActor(store:Store,actor:Actor,workspace:string,memberId?:string):Promise<Actor> {
  const human:Actor|undefined=memberId&&actor.kind==='agent'?{kind:'human',id:memberId}:undefined;
  return human&&!await mayUseDestination(store,human,workspace,'marketing')?human:actor;
}
async function restrictedIds(store: Store, actor: Actor, values: unknown,force=false): Promise<Set<string>> {
  const sql = sqlOf(store); if (!sql) return new Set();
  const ids = [...idsIn(values)]; if (!ids.length) return new Set();
  const rows = await sql`select id::text from unnest(${ids}::uuid[]) as x(id) cross join lateral (select nm_marketing_scope_for_id(x.id) as workspace) s where s.workspace is not null and (${force} or not nm_destination_access(s.workspace,${actor.kind},${actor.id}::uuid,'marketing'))`;
  const denied = new Set(rows.map(r => String(r.id)));
  const object = values && typeof values === 'object' ? values as Record<string,unknown> : {};
  const input = object.input && typeof object.input === 'object' ? object.input as Record<string,unknown> : object;
  const query = object.query && typeof object.query === 'object' ? object.query as Record<string,unknown> : {};
  const workspace = input.workspace ?? query.workspace;
  const channel = input.channel ?? query.channel;
  if (typeof workspace === 'string' && uuid.test(workspace) && typeof channel === 'string' && !uuid.test(channel) && !channel.startsWith('project:')) {
    const hidden = await sql`select id from channels where workspace_id=${workspace}::uuid and slug=${channel} and (kind='marketing' or restricted_destination='marketing') and (${force} or not nm_destination_access(workspace_id,${actor.kind},${actor.id}::uuid,'marketing'))`;
    if(hidden.length) denied.add(channel);
  }
  return denied;
}
export async function assertMarketingCommand(store: Store, actor: Actor, command: Command) {
  if (!store.destinations) return;
  const c = command as unknown as Record<string,unknown>;
  if((c.type==='task.create'||c.type==='task.offer')&&typeof c.offerTo==='string') {
    const task=typeof c.taskId==='string'?await store.getTask(c.taskId):null;
    const workspace=typeof c.workspace==='string'?c.workspace:task?.workspace,channel=typeof c.channel==='string'?c.channel:task?.channel;
    const sql=sqlOf(store);
    if(sql&&workspace&&uuid.test(workspace)&&channel){
      const privateRoom=await sql`select id from channels where workspace_id=${workspace}::uuid and (id::text=${channel} or slug=${channel.replace(/^#/,'')}) and restricted_destination='marketing'`;
      if(privateRoom.length){const target=await store.resolveOffer(workspace,channel,c.offerTo);if(!await mayUseDestination(store,{kind:'agent',id:target},workspace,'marketing'))throw new DomainError('NOT_PERMITTED','Add the receiving agent to Marketing before assigning this work.');}
    }
  }
  if (c.type === 'channel.set_kind' && actor.kind !== 'human') throw new DomainError('HUMAN_ONLY','Only a person can change a channel kind.');
  if (c.type === 'marketing.start' && typeof c.project === 'string') {
    const sql = sqlOf(store);
    const [project] = sql ? await sql`select workspace_id from projects where id=${c.project}::uuid` : [];
    if (project && !await mayUseDestination(store,actor,String(project.workspace_id),'marketing')) throw new DomainError('NOT_PERMITTED','Ask the workspace owner to add you to Marketing.');
  }
  if (String(c.type).startsWith('marketing.') && typeof c.workspace === 'string' && !await mayUseDestination(store,actor,c.workspace,'marketing')) throw new DomainError('NOT_PERMITTED','Ask the workspace owner to add you to Marketing.');
  if ((await restrictedIds(store,actor,c)).size) throw new DomainError('NOT_PERMITTED','This item belongs to restricted Marketing.');
  if (c.type === 'channel.set_kind' && c.kind === 'marketing') {
    const workspace = typeof c.workspace === 'string' ? c.workspace : typeof c.channel === 'string' ? (await store.channelWorkspace(c.channel))?.workspace : null;
    if (!workspace || !await mayUseDestination(store,actor,workspace,'marketing')) throw new DomainError('NOT_PERMITTED','Marketing access is required.');
  }
}
function prune(value: unknown, denied: Set<string>): unknown {
  if (Array.isArray(value)) return value.map(v=>prune(v,denied)).filter(v=>v!==undefined);
  if (!value || typeof value !== 'object') return value;
  const row = value as Record<string,unknown>;
  if (Object.entries(row).some(([key,v])=>/^(id|channel|channel_id|channelId|threadId|thread_id|taskId|task_id|item|itemId|item_id|scheduleId|schedule_id|target)$/.test(key) && typeof v === 'string' && (denied.has(v)||[...idsIn(v)].some(id=>denied.has(id))))) return undefined;
  return Object.fromEntries(Object.entries(row).map(([k,v])=>[k,prune(v,denied)]).filter(([,v])=>v!==undefined));
}
async function redactProjectSummaries(store:Store,actor:Actor,body:unknown,force=false):Promise<unknown> {
  const sql=sqlOf(store),ids=[...idsIn(body)];if(!sql||!ids.length)return body;
  const rows=await sql`select id::text from projects where id=any(${ids}::uuid[]) and (${force} or not nm_destination_access(workspace_id,${actor.kind},${actor.id}::uuid,'marketing'))`;
  const denied=new Set(rows.map(r=>String(r.id)));
  function clean(value:unknown):unknown {
    if(Array.isArray(value))return value.map(clean);
    if(!value||typeof value!=='object')return value;
    const row=value as Record<string,unknown>,hidden=denied.has(String(row.id??row.projectId??row.project_id));
    return Object.fromEntries(Object.entries(row).map(([k,v])=>[k,hidden&&['brand_profile','brandProfile'].includes(k)?null:clean(v)]));
  }
  return clean(body);
}
/** A direct-id backstop for existing HTTP doors plus response filtering for broad JSON lists.
 * Replica filtering and brain/command checks independently protect their own delivery paths. */
export function marketingAccessRoutes<E extends { Variables: { actor: Actor; memberId?: string;machine?:unknown;marketingContextAllowed?:boolean } }>(app: Hono<E>, store: Store) {
  app.use('/v1/*',async (c,next)=>{
    if (!store.destinations || !sqlOf(store) || c.req.path.startsWith('/v1/sync') || c.req.path.startsWith('/v1/agent-replica/') || c.req.path.startsWith('/v1/destinations/')) return next();
    const input = c.req.method === 'GET' || !c.req.header('content-type')?.includes('application/json') ? {} : await c.req.raw.clone().json().catch(()=>({}));
    const identifiers = { input, query:c.req.query(), path:c.req.path.split('/') };
    const actor = c.get('actor');
    let force=!!c.get('machine')&&actor.kind==='human'&&c.req.header('x-nm-agent-scopes')!=='1';
    if(actor.kind==='agent'){
      const context=z.object({workspace:z.string().uuid(),subject:z.union([z.object({kind:z.literal('thread'),id:z.string().uuid()}),z.object({kind:z.literal('task'),number:z.number().int().positive()})])}).safeParse((()=>{try{return JSON.parse(c.req.header('x-nm-agent-context')??'null');}catch{return null;}})());
      const sql=sqlOf(store)!;
      force=!context.success||!(await agentAuthorization(sql,{kind:'scoped-agent',id:actor.id,workspaceId:context.data.workspace,subject:context.data.subject,callerId:c.get('memberId')})).marketing.length;
    }
    c.set('marketingContextAllowed',!force);
    const denied = await restrictedIds(store,actor,identifiers,force);
    const memberId = c.get('memberId');
    if (memberId && actor.kind === 'agent') for (const id of await restrictedIds(store,{kind:'human',id:memberId},identifiers)) denied.add(id);
    if (denied.size) return c.json({ error:'Ask the workspace owner to add you to Marketing.',code:'NOT_PERMITTED' },403);
    await next();
    if (!c.res.headers.get('content-type')?.includes('application/json') || c.req.path.startsWith('/v1/finance/')) return;
    const body: unknown = await c.res.clone().json().catch(()=>null);
    if (!body) return;
    const hidden = await restrictedIds(store,actor,body,force);
    if (memberId && actor.kind === 'agent') for (const id of await restrictedIds(store,{kind:'human',id:memberId},body)) hidden.add(id);
    let filtered = prune(body,hidden);
    filtered = await redactProjectSummaries(store,actor,filtered,force);
    if(memberId&&actor.kind==='agent')filtered=await redactProjectSummaries(store,{kind:'human',id:memberId},filtered);
    c.res = new Response(JSON.stringify(filtered ?? { error:'Restricted Marketing item.',code:'NOT_PERMITTED' }),{status:filtered === undefined ? 403:c.res.status,headers:c.res.headers});
  });
}
