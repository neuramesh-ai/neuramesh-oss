import {createHash} from 'node:crypto';
import type {Sql} from './local-sync-scope';
export interface AgentReplicaPrincipal {
 kind:'scoped-agent';id:string;workspaceId:string;callerId?:string;
 subject?:{kind:'thread';id:string}|{kind:'task';number:number};
}
/** Agent context never inherits its machine owner's broader data access. Private
 * Marketing data also stays inside a Marketing conversation, preventing a library
 * tool from copying it automatically into a workspace-wide build thread. */
export async function agentAuthorization(sql:Sql,actor:AgentReplicaPrincipal) {
 const live=await sql`select a.id,a.workspace_id,a.machine_id,a.retired_at,m.owner_user_id,w.role from agents a join machines m on m.id=a.machine_id join workspace_members w on w.workspace_id=a.workspace_id and w.user_id=m.owner_user_id where a.id=${actor.id}::uuid and a.workspace_id=${actor.workspaceId}::uuid and a.retired_at is null and (m.lifecycle is null or m.lifecycle<>'destroyed')`;
 let context:Array<Record<string,unknown>>=[];
 if(actor.subject?.kind==='thread')context=await sql`select t.id,c.id as channel,c.restricted_destination,c.kind from threads t join channels c on c.id=t.channel_id where t.id=${actor.subject.id}::uuid and t.workspace_id=${actor.workspaceId}::uuid`;
 if(actor.subject?.kind==='task')context=await sql`select t.id,c.id as channel,c.restricted_destination,c.kind from tasks t join channels c on c.id=t.channel_id where t.number=${actor.subject.number} and t.workspace_id=${actor.workspaceId}::uuid`;
 const privateContext=context.some(c=>c.restricted_destination==='marketing'||c.kind==='marketing');
 const [permission]=await sql`select nm_destination_access(${actor.workspaceId}::uuid,'agent',${actor.id}::uuid,'marketing') as agent,case when ${actor.callerId??null}::uuid is null then true else nm_destination_access(${actor.workspaceId}::uuid,'human',${actor.callerId??null}::uuid,'marketing') end as caller,case when ${actor.callerId??null}::uuid is null then true else exists(select 1 from workspace_members where workspace_id=${actor.workspaceId}::uuid and user_id=${actor.callerId??null}::uuid) end as member`;
 const marketing=privateContext&&permission?.agent&&permission.caller?[actor.workspaceId]:[];
 const allowed=live.length&&permission?.member&&(!actor.subject||context.length)&&(!privateContext||marketing.length);
 const workspaces=allowed?[actor.workspaceId]:[];
 const revisions=await sql`select destination,revision::text from workspace_destination_revisions where workspace_id=${actor.workspaceId}::uuid order by destination`;
 return {workspaces,marketing:allowed?marketing:[],scope:createHash('sha256').update(JSON.stringify(['agent-destination-v1',actor,live,context,permission,revisions])).digest('hex')};
}
