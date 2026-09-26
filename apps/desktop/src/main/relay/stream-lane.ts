// THE MACHINE'S HALF OF THE `stream` LANE (web stream lane prototype, 2026-09-24): a browser tab
// subscribes to the live replies this machine writes (livestreams.ts, fed by emitStream).
//
// Read-only by construction: a subscriber receives frames and may ask for exactly one thing back, a
// resync of a key whose sequence it lost. A subscriber is NOT a session: it never counts toward
// sessionCount (the activity meter that keeps a machine awake and billing) and never takes one of
// the 32 session slots, so a tab left open costs nothing.
import { fromB64, toB64, type ChannelFrame } from '@neuramesh/relay';
import { isLiveStreamOpenMeta, type LiveFrame } from '@neuramesh/shared';
import type { LiveStreams } from '../livestreams';

export const MAX_STREAM_SUBSCRIBERS = 256;
const CHUNK_BYTES = 128 * 1024; // the Engineering lane's chunk: a line may span frames, the reader joins them
const MAX_REQUEST_B64 = 4 * 1024;

export function createStreamLane(streams: Pick<LiveStreams, 'subscribe' | 'resync'> | undefined, log: (line: string) => void) {
  const subs = new Map<string, () => void>();
  return {
    has: (ch: string): boolean => subs.has(ch),

    open(frame: ChannelFrame, send: (m: ChannelFrame) => void): void {
      if (subs.has(frame.ch)) return;
      // the hub injects the attach verdict's user; without one there is nobody to check access for
      if (!streams || !isLiveStreamOpenMeta(frame.meta) || typeof frame.actorId !== 'string' || !frame.actorId
        || subs.size >= MAX_STREAM_SUBSCRIBERS) {
        send({ ch: frame.ch, t: 'close' });
        return;
      }
      const emit = (f: LiveFrame): void => {
        const bytes = Buffer.from(`${JSON.stringify(f)}\n`);
        for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
          send({ ch: frame.ch, t: 'data', d: toB64(bytes.subarray(offset, offset + CHUNK_BYTES)) });
        }
      };
      subs.set(frame.ch, streams.subscribe({ id: frame.ch, actorId: frame.actorId, send: emit }));
      log(`stream_open ch=${frame.ch} subscribers=${subs.size}`);
    },

    /** a data or close frame on a stream channel: one JSON request per data frame (the Engineering
     *  lane's command shape), and anything it does not speak is contained to its channel */
    frame(m: ChannelFrame): void {
      if (m.t === 'close') { subs.get(m.ch)?.(); subs.delete(m.ch); return; }
      if (m.t !== 'data' || typeof m.d !== 'string' || m.d.length > MAX_REQUEST_B64 || !streams) return;
      try {
        const req = JSON.parse(fromB64(m.d).toString('utf8')) as { t?: unknown; k?: unknown };
        if (req.t === 'resync' && typeof req.k === 'string') streams.resync(m.ch, req.k);
      } catch { /* malformed lane data is contained to its channel */ }
    },

    /** the relay socket died: every subscription died with it (the tabs redial) */
    stopAll(): void {
      for (const stop of subs.values()) stop();
      subs.clear();
    },
  };
}
