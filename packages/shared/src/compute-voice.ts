// Who says "nobody can serve" (split from compute.ts at the size gate, 2026-09-19).
import { machineOnline, type MachineCapability } from './compute';

/**
 * Which host SAYS that nobody can serve. The origin's own machine always may: it is the one
 * host guaranteed awake for that person. A RUNNER (the workspace's shared cloud machine) may
 * when the origin has no awake machine of their own, so a workspace whose only host is its
 * runner never leaves a human on "thinking…" (found on the local fleet harness, 2026-09-19).
 * Every other host stays silent: a machine that merely was not chosen must not speak over the
 * one about to work.
 */
export function hostSpeaksForOrigin(
  machines: readonly MachineCapability[],
  originUserId: string | null,
  hostOwnerUserId: string,
  hostKind: string | undefined,
  now: number,
): boolean {
  if (!originUserId) return false;
  if (hostOwnerUserId === originUserId) return true;
  if (hostKind !== 'runner') return false;
  return !machines.some((m) => m.ownerUserId === originUserId && machineOnline(m, now));
}
