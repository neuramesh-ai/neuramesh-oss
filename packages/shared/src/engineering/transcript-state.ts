import type { EngineeringMessage } from './domain';

export function lastMessageIndex(messages: EngineeringMessage[], role: EngineeringMessage['role'], streamingOnly = false): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const current = messages[index];
    if (current?.role === role && (!streamingOnly || current.streaming)) return index;
  }
  return -1;
}

export const updateMessage = (messages: EngineeringMessage[], index: number, next: EngineeringMessage): EngineeringMessage[] => messages.map((current, at) => at === index ? next : current);
export function collapseReasoning(messages: EngineeringMessage[]): EngineeringMessage[] {
  return messages.map((current) => current.role === 'reasoning' && !current.collapsed ? { ...current, streaming: false, collapsed: true } : current);
}
export function finishStreamingMessages(messages: EngineeringMessage[], collapseThoughts: boolean): EngineeringMessage[] {
  return (collapseThoughts ? collapseReasoning(messages) : messages).map((current) => current.streaming
    ? { ...current, streaming: false }
    : current);
}
