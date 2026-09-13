export const MAX_ENGINEERING_SESSIONS_PER_ACTOR = 4;
export const MAX_ENGINEERING_SESSIONS_PER_MACHINE = 16;

/** Machine-side defense in depth for Code session fan-out. The relay enforces the same policy,
 * but the daemon must remain safe when connected to an older or compromised relay. */
export class EngineeringSessionLeases {
  private readonly leases = new Set<string>();

  claim(actorId: string, threadId: string): { ok: true; lease: string } | { ok: false; reason: 'active' | 'limit' } {
    const lease = `${actorId}\0${threadId}`;
    if (this.leases.has(lease)) return { ok: false, reason: 'active' };
    let actorCount = 0;
    for (const current of this.leases) if (current.startsWith(`${actorId}\0`)) actorCount += 1;
    if (actorCount >= MAX_ENGINEERING_SESSIONS_PER_ACTOR || this.leases.size >= MAX_ENGINEERING_SESSIONS_PER_MACHINE) {
      return { ok: false, reason: 'limit' };
    }
    this.leases.add(lease);
    return { ok: true, lease };
  }

  release(lease: string): void { this.leases.delete(lease); }
  clear(): void { this.leases.clear(); }
}
