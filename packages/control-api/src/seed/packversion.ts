// The stored version of a BUNDLED skill pack: the deploy's pin, plus a digest of the content
// it actually seeds.
//
// Why a digest and not the pin alone. The pin is the vendored upstream ref, hard-coded in the
// generator (gen-marketing-os-seed.ts's UPSTREAM_REF; gen-skill-seed.ts's cloned sha). The
// NeuraMesh preambles that wrap each module live on OUR side of that pin, so editing one (the
// UGC preamble's caption-and-script shape, 2026-09-18) rewrites a skill body and leaves the pin
// byte-identical. A version-string comparison would read "same version" and the fix would never
// reach a room that already holds the pack: exactly the bug this exists to close. Deriving the
// version from the seed's own bytes makes a content change a version change BY CONSTRUCTION;
// there is nothing for a generator, or a person, to remember to bump.
//
// Pure and deterministic: same seed in, same string out, in any process. That is what lets the
// refresh decide with one string compare instead of reading every body back out of the room.
import { createHash } from 'node:crypto';
import type { SeedPack } from './skill-seed';

// length-prefixed fields, so no separator can ever be forged out of content
const field = (s: string): string => `${s.length}:${s}`;

export function bundledPackVersion(entry: SeedPack): string {
  const h = createHash('sha256');
  // every field a refresh writes: the pack's mutable columns, then each skill in seed order
  h.update(field(entry.pack.description));
  h.update(field(entry.pack.source_url));
  h.update(field(entry.pack.source_ref));
  for (const s of entry.skills) h.update(field(s.name) + field(s.description) + field(s.body));
  return `${entry.pack.version}+${h.digest('hex').slice(0, 12)}`;
}
