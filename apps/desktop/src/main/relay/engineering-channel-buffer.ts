export const MAX_ENGINEERING_COMMAND_BYTES = 384 * 1024;
export const MAX_PENDING_ENGINEERING_COMMANDS = 64;
export const MAX_PENDING_ENGINEERING_BYTES = 4 * 1024 * 1024;

export function createEngineeringCommandBuffer(onOverflow: () => void) {
  const queued: string[] = [];
  let bytes = 0;
  let closed = false;
  const reject = (): false => {
    closed = true;
    queued.length = 0;
    bytes = 0;
    onOverflow();
    return false;
  };
  return {
    push(data: string): boolean {
      if (closed) return false;
      const size = Buffer.byteLength(data);
      if (size > MAX_ENGINEERING_COMMAND_BYTES || queued.length >= MAX_PENDING_ENGINEERING_COMMANDS
        || bytes + size > MAX_PENDING_ENGINEERING_BYTES) return reject();
      queued.push(data);
      bytes += size;
      return true;
    },
    drain(write: (data: string) => void): void {
      for (const data of queued.splice(0)) write(data);
      bytes = 0;
    },
    close(): void { closed = true; queued.length = 0; bytes = 0; },
    stats: () => ({ messages: queued.length, bytes }),
  };
}
