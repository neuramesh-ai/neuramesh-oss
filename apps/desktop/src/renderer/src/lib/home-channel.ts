/** A newly created room must reach the replica before Home can send to it. */
export function homeChannel<T extends { id: string }>(channels: T[], target: string | null, defaultId: string | null, pendingId: string | null): T | null {
  if (pendingId) return channels.find((channel) => channel.id === pendingId) ?? null;
  return channels.find((channel) => channel.id === target) ?? channels.find((channel) => channel.id === defaultId) ?? channels[0] ?? null;
}
