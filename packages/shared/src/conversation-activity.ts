import type { BrainConversationEvent } from './brain-sync';
import type { EngineeringMessage } from './engineering/domain';
export interface ConversationActivityTurn {
  id: string;
  agentId?: string;
  startedAt: string;
  endedAt?: string;
  state: 'running' | 'done' | 'failed' | 'unknown';
  messages: EngineeringMessage[];
}
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown): string => typeof value === 'string' ? value : value === undefined ? '' : JSON.stringify(value, null, 2);
/** Canonical journal events only. An old concurrent turn without attribution gets an unnamed
 * activity group, never the other agent's identity. Results pair by call ID, never arrival order. */
export function conversationActivity(events: readonly BrainConversationEvent[], liveSince?: string): ConversationActivityTurn[] {
  const turns = new Map<string, ConversationActivityTurn>();
  const current = new Map<string, ConversationActivityTurn>();
  const open = new Set<string>();
  const prose = new Map<ConversationActivityTurn, EngineeringMessage[]>();
  const calls = new Map<string, { turn: ConversationActivityTurn; message: EngineeringMessage; turnId?: string }>();
  for (const event of events) {
    const p = object(event.payload);
    const turnId = typeof p.turnId === 'string' ? p.turnId : undefined;
    if (event.type === 'turn.open' && turnId) {
      const turn: ConversationActivityTurn = { id: event.id, agentId: typeof p.agentId === 'string' ? p.agentId : undefined, startedAt: event.timestamp, state: 'running', messages: [] };
      turns.set(event.id, turn);
      current.set(turnId, turn);
      open.add(turnId);
    } else if (event.type === 'turn.settle' && turnId) {
      const turn=current.get(turnId);
      if (turn) { turn.state=p.state==='failed'?'failed':'done';turn.endedAt=event.timestamp; }
      open.delete(turnId);
    } else if (event.type === 'assistant.message' && typeof p.text === 'string' && !p.actorId) {
      // Only model-authored public text from this turn. Synced final messages (actorId),
      // reasoning and ambiguous legacy concurrent events do not become progress updates.
      const turn = current.get(turnId ?? (open.size === 1 ? [...open][0]! : ''));
      const body = p.text.trim();
      if (turn && body && !/^(?:NO_REPLY|HEARTBEAT_OK)$/.test(body)) {
        const pending = prose.get(turn) ?? [];
        if (pending.at(-1)?.body !== body) pending.push({ id: `progress-${event.id}`, role: 'assistant', body, createdAt: event.timestamp });
        prose.set(turn, pending);
      }
    } else if (event.type === 'tool.call' && typeof p.id === 'string' && typeof p.name === 'string' && !p.name.startsWith('mcp__')) {
      if(calls.has(p.id)) continue;
      const key = turnId ?? (open.size === 1 ? [...open][0]! : `unattributed-${event.id}`);
      let turn=current.get(key);
      if (!turn) { turn={id:key,startedAt:event.timestamp,state:'unknown',messages:[]};turns.set(key,turn); }
      // A subsequent action proves this was an intermediate update. The final answer
      // stays in the normal message row, with its article/plan/attachment doors intact.
      turn.messages.push(...(prose.get(turn) ?? []));
      prose.delete(turn);
      const message:EngineeringMessage={id:`activity-${event.id}`,role:'tool',body:'',createdAt:event.timestamp,tool:{callId:p.id,name:p.name,input:p.input,state:'running'}};
      turn.messages.push(message);calls.set(p.id,{turn,message,turnId});
    } else if (event.type === 'tool.result' && typeof p.id === 'string') {
      const call=calls.get(p.id);
      if (!call || (turnId && call.turnId !== turnId)) continue;
      const output=text(p.output);
      const failed=p.ok===false||p.isError===true||object(p.output).ok===false||/^error\s*:/i.test(output);
      const duration=Date.parse(event.timestamp)-Date.parse(call.message.createdAt);
      call.message.tool={...call.message.tool!,output,state:failed?'failed':'succeeded',...(failed?{error:'This action failed.'}:{}),...(duration>=0?{durationMs:duration}:{})};
    }
  }
  return [...turns.values()].filter(turn=>turn.messages.length).map(turn=>({ ...turn, messages:turn.messages.map(message=>
    message.tool?.state==='running' && (turn.state!=='running'||!liveSince||Date.parse(turn.startedAt)<Date.parse(liveSince))
      ? {...message,tool:{...message.tool,state:'interrupted' as const}}:message),
  }));
}
