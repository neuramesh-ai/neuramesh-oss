import { isEngineeringGitHubWait, type EngineeringMessage } from '@neuramesh/shared';

/** the session's greeting says "Ready in <repo>": while the machine cannot reach the code, it would say the opposite of
 *  the gate below. The machine's GitHub sentence is the phone's reason (it has no gate): here the gate and the
 *  connected divider say it, and after the grant the sentence would be stale, so it never shows */
export function transcriptMessages(messages: EngineeringMessage[], blocked: boolean): EngineeringMessage[] {
  return (blocked && messages[0]?.role === 'assistant' ? messages.slice(1) : messages).filter((m) => !isEngineeringGitHubWait(m));
}
