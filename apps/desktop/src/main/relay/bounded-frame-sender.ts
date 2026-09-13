import type { ChannelFrame } from '@neuramesh/relay';

export const MAX_MACHINE_OUTBOUND_BYTES = 8 * 1024 * 1024;
const MACHINE_OUTBOUND_HIGH_WATER = 1024 * 1024;

export interface FrameSocket {
  readyState: number;
  bufferedAmount: number;
  send(data: string, callback: (error?: Error) => void): void;
  close(code?: number, reason?: string): void;
}

export function createBoundedFrameSender(socket: FrameSocket, openState = 1) {
  const queue: Array<{ data: string; bytes: number }> = [];
  let pendingBytes = 0;
  let inFlight = false;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const fail = (): void => {
    stopped = true;
    queue.length = 0;
    pendingBytes = 0;
    socket.close(1009, 'machine outbound buffer limit');
  };
  const pump = (): void => {
    if (stopped || inFlight || !queue.length || socket.readyState !== openState) return;
    if (socket.bufferedAmount > MACHINE_OUTBOUND_HIGH_WATER) {
      if (!timer) timer = setTimeout(() => { timer = null; pump(); }, 10);
      return;
    }
    const item = queue[0]!;
    inFlight = true;
    socket.send(item.data, (error) => {
      if (stopped) return;
      inFlight = false;
      queue.shift();
      pendingBytes -= item.bytes;
      if (error) { fail(); return; }
      pump();
    });
  };
  return {
    send(frame: ChannelFrame): boolean {
      if (stopped) return false;
      const data = JSON.stringify(frame);
      const bytes = Buffer.byteLength(data);
      if (bytes > MAX_MACHINE_OUTBOUND_BYTES || pendingBytes + bytes > MAX_MACHINE_OUTBOUND_BYTES) { fail(); return false; }
      queue.push({ data, bytes });
      pendingBytes += bytes;
      pump();
      return true;
    },
    close(): void { stopped = true; if (timer) clearTimeout(timer); queue.length = 0; pendingBytes = 0; },
    stats: () => ({ messages: queue.length, bytes: pendingBytes }),
  };
}
