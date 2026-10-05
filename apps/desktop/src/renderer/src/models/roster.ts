// The roster the model surfaces read away from a composer (Settings › Models, the agent page,
// onboarding's thank-you write): the shell publishes the live roster here, so a modal deep in the
// tree reads the viewer's picks and the machines' providers without three more props on its way down.
import { useSyncExternalStore } from 'react';
import type { AgentRow, MachineRow, MemberRow } from '../bridge/rows-crew';

export type ModelRoster = { machines: MachineRow[]; members: MemberRow[]; agents: AgentRow[] };
let current: ModelRoster = { machines: [], members: [], agents: [] };
const subs = new Set<() => void>();

/** the shell's one write, on every roster update */
export function publishModelRoster(r: ModelRoster): void {
  current = r;
  subs.forEach((f) => f());
}

export function useModelRoster(): ModelRoster {
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => current);
}
