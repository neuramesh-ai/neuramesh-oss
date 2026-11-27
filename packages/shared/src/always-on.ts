// THE ALWAYS ON SWITCH, as data (decision D2). The row (AlwaysOnRow.tsx) only paints what this
// returns, so the rules are testable without React: which machines show the switch, who may flip it,
// and the words beside it. The server holds the same role rule (control-api machine-always-on.ts)
// and is the one that decides. This copy only hides a switch that the server would refuse.

import { CREDIT_MICROS, MACHINE_MICROS_PER_ACTIVE_MINUTE } from './rates';

/** the facts the switch reads for one machine */
export interface AlwaysOnInput {
  kind: string | null | undefined;
  ownerUserId: string | null | undefined;
  /** the EFFECTIVE idle window machineIntent reports: null = Always on, undefined = not read yet */
  idleStopMin: number | null | undefined;
  selfUserId: string | null;
  /** the person's workspace role: 'owner' | 'admin' | 'member', null when unknown */
  selfRole: string | null;
}

export interface AlwaysOnView {
  /** false: no switch at all (a local machine, or the fleet's answer is not in yet) */
  show: boolean;
  on: boolean;
  /** false: the switch shows the state but this person cannot change it */
  canChange: boolean;
  /** what the switch does and costs, the same words in both states */
  hint: string;
  /** when the machine stops now: the idle window when off, the credit cap when on */
  status: string;
  /** what an awake idle hour costs, from the rate card: Always on is billed as active */
  cost: string;
  /** why the switch is disabled, for its title */
  lockedWhy: string | null;
}

export const ALWAYS_ON_HINT = 'Keeps the machine awake. It uses credits while idle.';
/** the one stop Always on keeps: the credit cap (control-api machineSweep) */
export const ALWAYS_ON_STATUS = 'Stops only when credits run out';

/** Always on is billed as active (George, 2026-11-06): an awake hour costs 60 active minutes */
export const alwaysOnCreditsPerHour = (): number => (60 * MACHINE_MICROS_PER_ACTIVE_MINUTE) / CREDIT_MICROS;
export const alwaysOnCost = (): string => `About ${alwaysOnCreditsPerHour()} credits an hour while it is on`;

/** "Stops after 15 min idle", "Stops after 2 h idle". Minutes under two hours, else hours. */
export function idleWindowLabel(min: number): string {
  if (min < 120) return `Stops after ${Math.round(min)} min idle`;
  return `Stops after ${Math.round(min / 60)} h idle`;
}

/** the same rule the server applies: the owner of a member machine, an owner or admin for the runner */
export function mayChangeAlwaysOn(kind: string | null | undefined, ownerUserId: string | null | undefined, selfUserId: string | null, selfRole: string | null): boolean {
  if (!selfUserId || !selfRole) return false;
  if (kind === 'member') return ownerUserId === selfUserId;
  if (kind === 'runner') return selfRole === 'owner' || selfRole === 'admin';
  return false;
}

export function alwaysOnView(i: AlwaysOnInput): AlwaysOnView {
  const cloud = i.kind === 'member' || i.kind === 'runner';
  if (!cloud || i.idleStopMin === undefined) return { show: false, on: false, canChange: false, hint: '', status: '', cost: '', lockedWhy: null };
  const on = i.idleStopMin === null;
  const canChange = mayChangeAlwaysOn(i.kind, i.ownerUserId, i.selfUserId, i.selfRole);
  const lockedWhy = canChange ? null
    : i.kind === 'runner' ? 'Only a workspace owner or admin can change this.'
      : 'Only the owner of this machine can change this.';
  const status = on ? ALWAYS_ON_STATUS : idleWindowLabel(i.idleStopMin as number);
  return { show: true, on, canChange, hint: ALWAYS_ON_HINT, status, cost: alwaysOnCost(), lockedWhy };
}
