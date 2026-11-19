import {destinationPermission,type DestinationStore} from './destinations';
import type {Actor} from '@neuramesh/shared';
import type { Task } from '@neuramesh/shared';
interface Fact { id:string;channel:string;content:string;kind:string;taskId:string|null;validUntil:string|null;supersededBy:string|null }
export function memoryFactView(facts:Fact[],tasks:Map<string,Task>,channel:string) {
    const selected = facts
      .filter((f) => f.channel === channel)
      .map((f) => ({
        id: f.id,
        content: f.content,
        kind: f.kind,
        taskNumber: f.taskId ? tasks.get(f.taskId)?.number ?? null : null,
        validFrom: new Date(0).toISOString(),
        validUntil: f.validUntil,
        supersededBy: f.supersededBy,
      }));
    return { block: null, facts:selected };
}

export async function memoryChannelAllowed(rooms:Array<{workspace:string;id:string;slug:string;kind?:string}>,restricted:Set<string>,destinations:DestinationStore,workspace:string,channel:string,actor?:Actor,marketing?:boolean) {
 const room=rooms.find(c=>c.workspace===workspace&&(c.id===channel||c.slug===channel));
 if(room?.kind!=='marketing'&&!(room&&restricted.has(room.id)))return true;
 return marketing!==false&&(!actor||(await destinationPermission(destinations,actor,workspace,'marketing')).canView);
}

export function lexicalMemory(messages:Array<{id:string;workspace:string;channel:string;body:string;createdAt:string}>,workspace:string,channel:string|null,query:string,k:number,allowed:Set<string>) {
 const terms=query.toLowerCase().split(/\s+/).filter(Boolean);
    return messages
      .filter((m) => m.workspace === workspace && (!channel || m.channel === channel)&&allowed.has(m.channel))
      .map((m) => ({ m, hits: terms.filter((t) => m.body.toLowerCase().includes(t)).length }))
      .filter((x) => x.hits > 0)
      .sort((a, b) => b.hits - a.hits)
      .slice(0, k)
      .map(({ m, hits }) => ({ id: m.id, kind: 'message' as const, body: m.body, channel: m.channel, createdAt: m.createdAt, score: hits }));
}
