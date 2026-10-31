/** A command is a whole human message, optionally addressed to this agent. Quoted prose is data. */
export function isCompactCommand(body: string, authorKind: string, agentName: string): boolean {
  if (authorKind !== 'human') return false;
  const text = body.trim();
  const prefix = `@${agentName} `;
  return (text.toLowerCase().startsWith(prefix.toLowerCase()) ? text.slice(prefix.length).trim() : text) === '/compact';
}
