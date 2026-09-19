// THE HOSTED GATE'S ONE RULE (hostedrule.ts — the card is HostedGate.tsx; two names because the
// filesystem here folds case) (the source-release round, review F6, artboard E).
//
// A hosted workspace on the `free` plan is a paywalled shell: reads stay, writes stop, and the
// composer is REPLACED by the gate card (an absent control beats a disabled one, docs/33). The
// rule is a function so the three composers cannot drift on it, and so it is a unit test: the
// plan is server truth read over the existing IPC (workspaces.plan), `''` means "not read yet"
// and gates nothing, and a local connection is NEVER gated — Free is the whole product there.
import type { ConnectionInfo } from '../bridge/nm';

//
// STOOD DOWN (the first-run doors, 2026-09-19, George: "cloud should indicate free 500 credits to
// get started"): a free hosted workspace WRITES again. The first-run door promises the cloud row
// 500 credits to start, so a paywalled composer after the sign-up would break the promise it just
// made. The server's flag (NM_HOSTED_FREE_GATE) stays off, and this rule answers false for every
// plan, so the three composers keep one rule and the card (HostedGate.tsx) keeps its place for the
// day the ruling changes. The seat, project and machine caps of docs/07 are unaffected: those are
// entitlements, not this gate.
export function hostedGateFor(connection: Pick<ConnectionInfo, 'kind' | 'authMode'> | null | undefined, _plan: string | null | undefined): boolean {
  if (!connection) return false;
  return false;
}
