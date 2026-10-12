type Packet = { subId: string; event?: unknown };
type Listener = (event: unknown, packet: Packet) => void;
interface LocalEngineeringIpc {
  invoke(channel: string, payload: unknown): Promise<unknown>;
  on(channel: string, listener: Listener): unknown;
  removeListener(channel: string, listener: Listener): unknown;
}

/** The first prompt must wait for main to register the asynchronously opened host. */
export function openLocalEngineeringChannel(ipc: LocalEngineeringIpc, meta: unknown, onEvent: (event: unknown) => void, onExit: () => void) {
  const subId = crypto.randomUUID();
  let closed = false;
  const evL: Listener = (_event, packet) => { if (!closed && packet.subId === subId) onEvent(packet.event); };
  const off = () => { ipc.removeListener('nm:engineering-event', evL); ipc.removeListener('nm:engineering-exit', exL); };
  const exL: Listener = (_event, packet) => {
    if (!closed && packet.subId === subId) { closed = true; off(); onExit(); }
  };
  ipc.on('nm:engineering-event', evL); ipc.on('nm:engineering-exit', exL);
  const ready = ipc.invoke('nm:engineering-local-open', { subId, meta }).then(result => {
    if (!(result as { ok?: boolean } | null)?.ok) throw new Error('The Code workspace could not open.');
  });
  // Observe startup rejection even if this is a restored session with no prompt yet.
  void ready.catch(error => {
    if (closed) return;
    closed = true; off();
    onEvent({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    onExit();
  });
  let commands = Promise.resolve();
  return {
    subId,
    send(command: unknown): Promise<void> {
      // a failed command rejects only for its own caller: the queue keeps its order and moves on
      const sent = commands.catch(() => {}).then(async () => {
        await ready;
        if (closed) throw new Error('The Code workspace connection closed.');
        await ipc.invoke('nm:engineering-local-command', { subId, command });
      });
      commands = sent;
      return sent;
    },
    close(): void {
      if (closed) return;
      closed = true; off();
      // Closing while startup is pending must also close the host when it arrives.
      void ready.then(() => ipc.invoke('nm:engineering-local-close', { subId })).catch(() => {});
    },
  };
}
