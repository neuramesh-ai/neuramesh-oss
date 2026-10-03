// the browser lane's pacing and size rules (board C3), pure so they are tested apart from sockets.
//
// a screencast can make frames faster than a link carries them. unpaced, they queue in the machine's
// outbound buffer, and at 8 MB that buffer closes the machine's whole relay socket, terminals and
// all (bounded-frame-sender.ts). so each viewer holds at most BROWSER_FRAME_WINDOW frames it has not
// acknowledged, and past that the machine keeps only the newest: a slow link sees a later picture,
// never a queue of old ones. and a frame rides one data frame whole, under the relay's cap, or not
// at all: the page lowers its JPEG quality and the frame after fits.
import { b64Length } from '@neuramesh/shared';

export class FramePacer<F> {
  private inflight = 0;
  private pending: F | null = null;
  /** `deliver` answers false for a frame it could not send, which then holds no slot */
  constructor(private readonly window: number, private readonly deliver: (frame: F) => boolean) {}

  push(frame: F): void {
    if (this.inflight >= this.window) { this.pending = frame; return; }
    if (this.deliver(frame)) this.inflight += 1;
  }

  /** the viewer drew a frame: free its slot, and send the newest held frame */
  ack(): void {
    this.inflight = Math.max(0, this.inflight - 1);
    const next = this.pending;
    if (next === null || this.inflight >= this.window) return;
    this.pending = null;
    if (this.deliver(next)) this.inflight += 1;
  }

  /** a new page or tab: nothing in flight belongs to it */
  reset(): void { this.inflight = 0; this.pending = null; }
}

/** one lane message as the base64 `d` of a relay data frame, or null when it would pass `cap` */
export function encodeLine(message: unknown, cap: number): string | null {
  const line = Buffer.from(`${JSON.stringify(message)}\n`, 'utf8');
  return b64Length(line.length) > cap ? null : line.toString('base64');
}
