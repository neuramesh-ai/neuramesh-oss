// Replica cursors bind revisions to membership and schema.
import { createHash } from 'node:crypto';
import { TABLE_COLUMNS } from '@neuramesh/client-core/schema';

/**
 * THE CURSOR, VERSION 2 (migration 0159): one revision per workspace the principal reads, in the
 * order of `workspaces` (sorted by id), plus the membership hash and the schema hash. The scope hash
 * covers the workspace list, so the revisions need no ids beside them: any change to the list is a
 * scope change, and a scope change resets. A version 1 cursor (one global revision) is answered with
 * 409 RESET_REQUIRED, never read as a version 2 one.
 */
export interface Cursor { v: 2; revisions: string[]; scope: string; schema: string }
export const schema = createHash('sha256').update(JSON.stringify(TABLE_COLUMNS)).digest('hex');
export const encode = (cursor: Omit<Cursor, 'v'>): string =>
  Buffer.from(JSON.stringify({ v: 2, r: cursor.revisions.map(Number), s: cursor.scope, h: cursor.schema })).toString('base64url');
const parse = (raw: string): unknown => {
  try { return JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')); } catch { return null; }
};
export function decodeLocalCursor(raw: string): Cursor | null {
  const c = parse(raw) as { v?: unknown; r?: unknown; s?: unknown; h?: unknown } | null;
  if (!c || c.v !== 2 || !Array.isArray(c.r) || typeof c.s !== 'string' || typeof c.h !== 'string') return null;
  if (!c.r.every((n) => Number.isSafeInteger(n) && (n as number) >= 0)) return null;
  return { v: 2, revisions: (c.r as number[]).map(String), scope: c.s, schema: c.h };
}
/** a cursor of the global-revision feed (0152): its holder must bootstrap again, not be told it is malformed */
export function isLegacyCursor(raw: string): boolean {
  const c = parse(raw) as { revision?: unknown; scope?: unknown } | null;
  return !!c && typeof c.revision === 'string' && typeof c.scope === 'string';
}
