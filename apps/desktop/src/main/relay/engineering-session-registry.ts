/** A reconnect must drain the old writer before a new recorder reads the local journal. */
export class EngineeringSessionRegistry<T extends { close(): void | Promise<void>; readonly busy?: boolean; readonly working?: boolean }> {
  private readonly sessions = new Map<string, T>();
  private readonly opening = new Map<string, Promise<unknown>>();
  private held = false;

  async open(key: string, create: () => Promise<T>): Promise<T> {
    if (this.held) throw new Error('This machine stops soon. Open the session again after it restarts.');
    const previousOpen = this.opening.get(key) ?? Promise.resolve();
    const next = previousOpen.catch(() => {}).then(async () => {
      const previous = this.sessions.get(key);
      if (previous?.busy) throw new Error('This thread is still working on another connection. Wait for its current turn to finish.');
      await previous?.close();
      const session = await create();
      const close = session.close.bind(session);
      session.close = async () => {
        try { await close(); }
        finally { if (this.sessions.get(key) === session) this.sessions.delete(key); }
      };
      this.sessions.set(key, session);
      return session;
    });
    this.opening.set(key, next);
    try { return await next; }
    finally { if (this.opening.get(key) === next) this.opening.delete(key); }
  }

  /** The Cloud Run drain (cloudrun/lifecycle.ts): refuse new sessions from now on. */
  hold(): void { this.held = true; }

  busyCount(): number {
    let n = 0;
    for (const session of this.sessions.values()) if (session.busy) n += 1;
    return n;
  }

  /** the open session under the key, or undefined (a parked approval's answer continues it) */
  get(key: string): T | undefined { return this.sessions.get(key); }

  /** sessions whose turn runs and waits on nobody (the activity meter's Code half, machined.ts) */
  workingCount(): number {
    let n = 0;
    for (const session of this.sessions.values()) if (session.working) n += 1;
    return n;
  }

  /** close every session; each one checkpoints and closes its brain before it resolves */
  async closeAll(): Promise<void> {
    await Promise.allSettled([...this.opening.values()]);
    await Promise.allSettled([...this.sessions.values()].map((session) => session.close()));
  }
}
