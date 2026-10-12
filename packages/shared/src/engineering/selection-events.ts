import type { EngineeringSession } from './domain';
import { DEFAULT_ENGINEERING_AGENT, type EngineeringAgent } from './selection';

/** Apply a host-validated identity without rewriting authors already recorded in the transcript. */
export function applyEngineeringSelection(session: EngineeringSession, wire: Record<string, unknown>): EngineeringSession {
  if (wire['type'] !== 'ready' && wire['type'] !== 'model_changed') return session;
  const agent = wire['agent'] as EngineeringAgent | undefined;
  if (agent && typeof agent.id === 'string' && typeof agent.name === 'string' && typeof agent.role === 'string') {
    const welcomeOnly = session.messages.length <= 2 && session.messages[0]?.body.startsWith('Ready in **');
    const previous = session.agent ?? (welcomeOnly ? agent : DEFAULT_ENGINEERING_AGENT);
    session = { ...session, agent, agentId: agent.id || null, messages: session.messages.map((m) => m.role !== 'user' && !m.agent ? { ...m, agent: { ...previous } } : m) };
  }
  const effort = wire['reasoningEffort'];
  return effort === null || effort === 'low' || effort === 'medium' || effort === 'high' ? { ...session, reasoningEffort: effort } : session;
}

/** New rows take the speaking identity once, when recorded, rather than when rendered. */
export function recordEngineeringAuthors(previous: EngineeringSession, next: EngineeringSession): EngineeringSession {
  if (next === previous) return previous;
  const prior = new Set(previous.messages.map((m) => m.id));
  const agent = next.agent ?? DEFAULT_ENGINEERING_AGENT;
  return { ...next, messages: next.messages.map((m) => m.role !== 'user' && !m.agent && !prior.has(m.id) ? { ...m, agent: { ...agent } } : m) };
}
