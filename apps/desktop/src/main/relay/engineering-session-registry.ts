/** A reconnect must drain the old writer before a new recorder reads the local journal. */
export class EngineeringSessionRegistry<T extends { close(): void | Promise<void>; readonly busy?: boolean }> {
  private readonly sessions = new Map<string, T>();
  private readonly opening = new Map<string, Promise<unknown>>();

  async open(key: string, create: () => Promise<T>): Promise<T> {
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
}
