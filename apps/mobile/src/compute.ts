// THE CLOUD MACHINE'S METER + INTENT, in one store (the desktop's compute/useCompute.ts, at phone
// scale). Everything else on a screen is WATCHED from the replica; this is POLLED, because
// `desired_replicas` is the fleet's own bookkeeping and deliberately outside the publication —
// without it a surface cannot tell "asleep on purpose" from "offline". One store, not one per
// caller: the head's pill, the Compute screen and the chip must never disagree about one machine.
//
// Cadence: on mount, on a workspace change, every 60s while someone listens, and when the app
// comes back to the foreground (a phone spends most of its life backgrounded — the 60s timer
// alone would mean the first thing you see after unlocking is a minute stale).
import { machineState, newestSeen, type MachineCap, type MachineStateOut } from '@neuramesh/shared';
import type { MachinesUsage, WorkspaceUsage } from '@neuramesh/client-core';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { api } from './auth';

export type MachineIntentRow = MachinesUsage['machines'][number];

interface Store { workspace: string | null; usage: MachinesUsage | null; credits: WorkspaceUsage | null }
const store: Store = { workspace: null, usage: null, credits: null };
const subs = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

/** re-read now — a wake, a join, anything that should have changed the answer must not wait out the poll */
export async function refreshCompute(workspace = store.workspace): Promise<void> {
  if (!workspace) return;
  store.workspace = workspace;
  // a read that failed leaves the last good answer standing — "we could not look" is not "your machine is off"
  const [u, c] = await Promise.all([api.machinesUsage(workspace).catch(() => null), api.usage(workspace).catch(() => null)]);
  if (u) store.usage = u;
  if (c) store.credits = c;
  subs.forEach((f) => f());
}

function listen(fn: () => void): () => void {
  subs.add(fn);
  if (!timer) timer = setInterval(() => void refreshCompute(), 60_000);
  const sub = AppState.addEventListener('change', (s) => { if (s === 'active') void refreshCompute(); });
  return () => {
    subs.delete(fn);
    sub.remove();
    if (subs.size === 0 && timer) { clearInterval(timer); timer = null; }
  };
}

export interface ComputeView {
  usage: MachinesUsage | null;
  credits: WorkspaceUsage | null;
  cap: MachineCap | null;
  /** the fleet's word on a machine, through the ONE derivation every surface uses (machineState).
   *  `seenAt` is the replica's own live heartbeat when the caller holds one (see newestSeen). */
  stateOf(machineId: string, seenAt?: string | null): (MachineStateOut & { intent: MachineIntentRow }) | null;
  /** the machine the head's pill speaks for: the member's own cloud machine, else the runner */
  pillFor(selfUserId: string | null): (MachineStateOut & { intent: MachineIntentRow }) | null;
}

export function useCompute(workspace: string | null): ComputeView {
  const [, bump] = useState(0);
  useEffect(() => {
    if (!workspace) return;
    const off = listen(() => bump((n) => n + 1));
    if (store.workspace !== workspace) { store.usage = null; store.credits = null; }
    void refreshCompute(workspace);
    return off;
  }, [workspace]);
  const usage = store.workspace === workspace ? store.usage : null;
  const credits = store.workspace === workspace ? store.credits : null;
  const cap: MachineCap | null = usage ? { minutes: usage.minutes, capMinutes: usage.capMinutes, outOfCredits: usage.outOfCredits ?? false } : null;
  const stateOf = (machineId: string, seenAt?: string | null) => {
    const m = usage?.machines.find((x) => x.id === machineId);
    if (!m) return null;
    return { ...machineState({ desiredReplicas: m.desiredReplicas, lastSeenAt: newestSeen(m.lastSeenAt, seenAt), lastWakeAt: m.lastWakeAt, lifecycle: m.lifecycle }, cap, Date.now()), intent: m };
  };
  const pillFor = (selfUserId: string | null) => {
    const mine = usage?.machines.find((m) => m.kind === 'member' && m.ownerUserId === selfUserId);
    const runner = usage?.machines.find((m) => m.kind === 'runner');
    const pick = mine ?? runner;
    return pick ? stateOf(pick.id) : null;
  };
  return { usage, credits, cap, stateOf, pillFor };
}

/** m:ss / 2h 14m — the facts line's durations */
export function fmtDur(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60_000));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h}h ${m % 60}m` : `${Math.floor(h / 24)}d`;
}
