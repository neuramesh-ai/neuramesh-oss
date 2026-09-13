// THE HOST CONTEXT — the seam every extracted host service takes (track B2).
//
// startAgentHost is one closure over the daemon's whole world. A service cannot leave it
// by reference alone, so it leaves by taking what it needs: each module exports a
// `makeX(ctx)` that destructures its dependencies and returns the same functions the
// closure used to hold. The bodies move verbatim — the destructure is what keeps every
// existing call site inside them valid.
//
// This interface grows one field per extracted service rather than being declared whole up
// front: a field here is a dependency something actually took, not a guess about what a
// host "should" expose.
import type { HostGuards } from './guards';

export interface HostCtx {
  /** POST a command to the control-api as a given actor */
  post: (path: string, actor: { kind: string; id: string; role?: string }, body: unknown) => Promise<Response>;
  /** the dedupe/in-flight registry (host/guards.ts) */
  guards: HostGuards;
  /** this machine's row id — a run records where it ran */
  machineId: string;
}
