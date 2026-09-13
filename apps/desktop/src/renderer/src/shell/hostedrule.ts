// THE HOSTED GATE'S ONE RULE (hostedrule.ts — the card is HostedGate.tsx; two names because the
// filesystem here folds case) (the source-release round, review F6, artboard E).
//
// A hosted workspace on the `free` plan is a paywalled shell: reads stay, writes stop, and the
// composer is REPLACED by the gate card (an absent control beats a disabled one, docs/33). The
// rule is a function so the three composers cannot drift on it, and so it is a unit test: the
// plan is server truth read over the existing IPC (workspaces.plan), `''` means "not read yet"
// and gates nothing, and a local connection is NEVER gated — Free is the whole product there.
import type { ConnectionInfo } from '../bridge/nm';

export function hostedGateFor(connection: Pick<ConnectionInfo, 'kind' | 'authMode'> | null | undefined, plan: string | null | undefined): boolean {
  if (!connection) return false;
  if (connection.kind === 'local' || connection.authMode === 'local') return false;
  return plan === 'free';
}
