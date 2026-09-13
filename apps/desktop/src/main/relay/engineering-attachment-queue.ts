const MAX_QUEUED_ATTACHMENT_COMMANDS = 64;
const MAX_QUEUED_ATTACHMENT_BYTES = 4 * 1024 * 1024;

/** Serializes stream writes while bounding closures and base64 bodies retained by pending work. */
export class EngineeringAttachmentQueue {
  private chain = Promise.resolve();
  private count = 0;
  private bytes = 0;
  private closed = false;
  private generation = 0;

  push(bytes: number, task: () => void | Promise<void>, success: () => void, failed: (error: unknown) => void): boolean {
    if (this.closed || this.count >= MAX_QUEUED_ATTACHMENT_COMMANDS || this.bytes + bytes > MAX_QUEUED_ATTACHMENT_BYTES) return false;
    const generation = this.generation;
    this.count += 1; this.bytes += bytes;
    this.chain = this.chain.then(async () => {
      if (this.closed || generation !== this.generation) return;
      try {
        await task();
        if (!this.closed && generation === this.generation) success();
      } catch (error) {
        if (!this.closed && generation === this.generation) failed(error);
      }
    }).finally(() => {
      this.count = Math.max(0, this.count - 1);
      this.bytes = Math.max(0, this.bytes - bytes);
    });
    return true;
  }

  wait(): Promise<void> { return this.chain; }
  close(): Promise<void> { this.closed = true; this.generation += 1; return this.chain; }
}
