// The id mint for a move (docs/export-format.md "The client's job"): a uuid v5 of
// `${importId}:${oldId}` under one fixed namespace. Deterministic, so a retry plans the same
// batches without a stored map, and a replayed batch is a replay by data (the server skips ids it
// holds). RFC 4122 §4.3 by hand over node's sha1: no dependency for sixteen bytes.
import { createHash } from 'node:crypto';

/** the one namespace every move mints under. Never changes: a new one would make a retry mint new ids. */
export const MOVE_NAMESPACE = '3b8a2f1e-6c4d-5e70-9a1b-2d3c4e5f6a7b';

const hexOf = (uuid: string): Buffer => Buffer.from(uuid.replace(/-/g, ''), 'hex');

/** RFC 4122 version 5: sha1(namespace bytes + name), the version nibble set to 5, the variant to 10xx. */
export function uuidV5(name: string, namespace = MOVE_NAMESPACE): string {
  const ns = hexOf(namespace);
  if (ns.length !== 16) throw new Error(`not a uuid namespace: ${namespace}`);
  const h = createHash('sha1').update(ns).update(Buffer.from(name, 'utf8')).digest();
  h[6] = (h[6]! & 0x0f) | 0x50;
  h[8] = (h[8]! & 0x3f) | 0x80;
  const hex = h.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** the mint planBatches takes: a pure function of the importId and the old id */
export const mintFor = (importId: string) => (oldId: string): string => uuidV5(`${importId}:${oldId}`);
