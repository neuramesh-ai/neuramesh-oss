// WHERE A SESSION WILL RUN, SAID BEFORE IT IS SENT (docs/design/desktop-code-bridge-2026-09, rule
// D9; George, 2026-09-04) — the composer's machine chip reads this, pure so it is tested.
//
// The chip is a FORECAST: the ladder decides at claim time, on the machines that are awake then.
// The forecast follows the same rungs so the two rarely disagree — the session's own choice, then
// the desktop-only default ("sessions you start on this Mac run here"), then a cloud machine when
// one is awake (the member's own, else the runner), then the machine you are on, then nothing to
// forecast. What the chip can never do is name a machine the member may not use.
import { machineAvailableTo, machineOnline, type ComputePrefs, type SessionOrigin } from './compute';

export interface ChoiceMachine {
  id: string;
  name: string;
  /** local (a laptop) · member (their cloud machine) · runner (the workspace's cloud machine) */
  kind: string;
  ownerUserId: string | null;
  lastSeenAt: string | null;
  sharesWith?: readonly string[];
}

export interface MachineForecast {
  machineId: string | null;
  why: 'chosen' | 'here' | 'cloud' | 'this-machine' | 'auto';
}

/** the machines this member may run a session on, own first, then lent ones, offline last */
export function choosableMachines(machines: readonly ChoiceMachine[], selfUserId: string | null, now: number): ChoiceMachine[] {
  // the workspace runner is everyone's (the ladder's `wakeCandidates` treats a runner as lent by
  // construction); a member machine or a laptop needs its owner's grant, as everywhere
  const usable = machines.filter((m) => m.kind === 'runner' || machineAvailableTo({ machineId: m.id, ownerUserId: m.ownerUserId ?? '', runtimes: [], lastSeenAt: m.lastSeenAt, sharesWith: m.sharesWith }, selfUserId));
  const rank = (m: ChoiceMachine): number => (m.ownerUserId === selfUserId ? 0 : 1) * 2 + (machineOnline({ machineId: m.id, ownerUserId: '', runtimes: [], lastSeenAt: m.lastSeenAt }, now) ? 0 : 1);
  return [...usable].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/** the cloud machine a session with a known origin prefers: the member's own live member machine,
 *  else a live runner (the ladder's `liveCloudMachine`, on rows rather than capabilities) */
export function cloudMachineFor(machines: readonly ChoiceMachine[], selfUserId: string | null, now: number): ChoiceMachine | null {
  const live = (m: ChoiceMachine): boolean => machineOnline({ machineId: m.id, ownerUserId: '', runtimes: [], lastSeenAt: m.lastSeenAt }, now);
  return machines.find((m) => m.kind === 'member' && m.ownerUserId === selfUserId && live(m))
    ?? machines.find((m) => m.kind === 'runner' && live(m))
    ?? null;
}

export function forecastMachine(input: {
  origin: SessionOrigin;
  /** the chip's explicit choice for this one session; null = Auto */
  chosen: string | null;
  prefs: ComputePrefs | null | undefined;
  machines: readonly ChoiceMachine[];
  selfUserId: string | null;
  /** the machine this client runs on — the desktop's own row; null in the browser */
  selfMachineId: string | null;
  now: number;
}): MachineForecast {
  const { origin, chosen, prefs, machines, selfUserId, selfMachineId, now } = input;
  if (chosen) return { machineId: chosen, why: 'chosen' };
  if (origin === 'desktop' && prefs?.desktopSessions === 'here' && selfMachineId) return { machineId: selfMachineId, why: 'here' };
  const cloud = cloudMachineFor(machines, selfUserId, now);
  if (cloud) return { machineId: cloud.id, why: 'cloud' };
  if (origin === 'desktop' && selfMachineId) return { machineId: selfMachineId, why: 'this-machine' };
  return { machineId: null, why: 'auto' };
}

/** the DESIGNATION a send writes on the thread (`threads.machine_id`): the chip's choice, or the
 *  desktop default's Mac. Never the forecast's cloud pick — that is the ladder's to make live, at
 *  claim time, on the machines awake then. */
export function designationFor(input: { origin: SessionOrigin; chosen: string | null; prefs: ComputePrefs | null | undefined; selfMachineId: string | null }): string | null {
  if (input.chosen) return input.chosen;
  if (input.origin === 'desktop' && input.prefs?.desktopSessions === 'here') return input.selfMachineId;
  return null;
}

/** the chip's one-line reading of a machine row */
export function machineKindLabel(m: Pick<ChoiceMachine, 'kind' | 'ownerUserId'>, selfUserId: string | null, selfMachineId: string | null, id: string): string {
  if (id === selfMachineId) return 'this Mac';
  if (m.kind === 'runner') return 'cloud';
  if (m.kind === 'member') return m.ownerUserId === selfUserId ? 'your cloud machine' : 'member machine';
  // a peer's laptop says its KIND; the Compute row already wears "shared with you" / "not shared"
  return m.ownerUserId === selfUserId ? 'your machine' : 'desktop';
}
