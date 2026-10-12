import { gunzipSync } from 'node:zlib';
import type { BrainThreadSnapshot } from '@neuramesh/shared';
import { BrainError } from './brain-store';

/** Phones need JSON, while native hosts retain the compact archive wire format.
 * Expansion happens only after the normal thread authorization and checksum checks. */
export function decodedBrainSnapshot<T extends BrainThreadSnapshot>(snapshot: T, limit = 128 * 1024 * 1024): T {
  let remaining = limit;
  const charge = (value: unknown): void => {
    const json = JSON.stringify(value);
    remaining -= json === undefined ? 0 : Buffer.byteLength(json);
    if (remaining < 0) throw new BrainError('TOO_LARGE', 'The decoded conversation exceeds the restore limit.', 413);
  };
  const decode = (value: unknown): unknown => {
    const packed = value as { brainEncoding?: unknown; data?: unknown } | null;
    if (packed?.brainEncoding !== 'neuramesh.gzip.v1') { charge(value); return value; }
    if (typeof packed.data !== 'string') throw new Error('The recorded conversation has an invalid compressed value.');
    if (remaining <= 0) throw new BrainError('TOO_LARGE', 'The decoded conversation exceeds the restore limit.', 413);
    let bytes: Buffer;
    try { bytes = gunzipSync(Buffer.from(packed.data, 'base64'), { maxOutputLength: remaining }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE') throw new BrainError('TOO_LARGE', 'The decoded conversation exceeds the restore limit.', 413);
      throw new Error('The recorded conversation has invalid compressed bytes.');
    }
    remaining -= bytes.length;
    return JSON.parse(bytes.toString('utf8')) as unknown;
  };
  let runtimeMessages = snapshot.runtimeMessages;
  if (runtimeMessages?.length === 1) {
    const decoded = decode(runtimeMessages[0]);
    if (decoded !== runtimeMessages[0]) {
      if (!Array.isArray(decoded)) throw new Error('The recorded runtime snapshot must contain messages.');
      runtimeMessages = decoded;
    }
  } else charge(runtimeMessages);
  charge({ ...snapshot, runtimeMessages: undefined, events: undefined });
  return { ...snapshot, runtimeMessages, events: snapshot.events.map(e => {
    charge({ ...e, payload: undefined });
    return { ...e, payload: decode(e.payload) };
  }) };
}
