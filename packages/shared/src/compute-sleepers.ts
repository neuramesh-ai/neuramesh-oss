// The sleeper rung, the pure half (split from compute.ts at the size gate, 2026-09-19). The
// daemon side (host/sleepers.ts) does the asking and the remembering.
import { machineAvailableTo, machineOnline, runtimeOk, type ClaimContext, type MachineCapability } from './compute';

/**
 * THE SLEEPER RUNG (member-machines plan §4.3). When nobody awake can serve, a CLOUD machine
 * that published this runtime while it was awake and is now asleep can be asked to wake: the
 * origin's own, one its owner lends the origin, or — for unattributed work such as a routine —
 * one lent to the whole workspace. The runner is the workspace's, so it always qualifies on
 * consent. Ordered best-first: the origin's own machine before a lent one.
 */
export function wakeCandidates(
  ctx: Pick<ClaimContext, 'machines' | 'runtime' | 'model' | 'modelFree' | 'originUserId' | 'requireGrant'>,
  now: number,
): MachineCapability[] {
  const gated = ctx.requireGrant !== false;
  const lent = (m: MachineCapability): boolean => {
    if (m.kind === 'runner') return true;
    if (ctx.originUserId) return !gated || machineAvailableTo(m, ctx.originUserId);
    return (m.sharesWith ?? []).includes('*');
  };
  return ctx.machines
    .filter((m) => (m.kind ?? 'local') !== 'local' && !machineOnline(m, now) && runtimeOk(m, ctx as ClaimContext) && lent(m))
    .sort((a, b) => Number(b.ownerUserId === ctx.originUserId) - Number(a.ownerUserId === ctx.originUserId));
}
