// THE CLOUD MACHINE'S METER + INTENT, in one hook (cloud-cap round, 2026-08-29).
//
// Everything else on this screen is WATCHED — the replica pushes changes and the UI re-renders.
// This one is POLLED, and the reason is structural rather than lazy: `desired_replicas` is the
// fleet's own bookkeeping and is deliberately outside the sync publication, so there is no local
// row to watch. Without it a surface cannot tell "asleep on purpose" from "offline", which is the
// whole defect this round exists to fix — so it rides an HTTP read instead of a schema change and
// a PowerSync re-snapshot.
//
// ONE STORE, not one per caller. The chrome's pill and the thread's cap gate both want this, and
// two independent pollers would both double the traffic AND let two surfaces disagree about the
// same machine for up to a minute — which is precisely the class of bug this round is fixing, so
// reproducing it here would be a poor joke. The store holds the last reply, the subscribers, and
// one timer that runs only while somebody is listening.
import { useEffect, useState } from 'react';
import { machineState, type MachineCap, type MachineStateOut } from '@neuramesh/shared';
import { nm } from '../bridge/nm';

interface MachineIntentRow {
  id: string; name: string; desiredReplicas: number;
  lastSeenAt: string | null; lastWakeAt: string | null; lifecycle: string | null;
  // the answers to "how long has it been up" and "when does it sleep". They reached the bridge
  // type and stopped there, so the API's answers never became pixels.
  startedAt?: string | null; lastActiveAt?: string | null; idleStopMin?: number | null;
}
interface UsageReply {
  day: string; minutes: number; capMinutes: number | null; plan: string; machines: MachineIntentRow[];
  /** the workspace cannot pay for compute — the only thing that refuses a wake */
  outOfCredits?: boolean;
}

export interface ComputeView extends MachineStateOut {
  cap: MachineCap | null;
  plan: string;
  machineName: string;
  /** null while stopped — uptime is only shown when there IS a start, never guessed */
  startedAt: string | null;
  lastSeenAt: string | null;
  lastActiveAt: string | null;
  /** minutes of idle before the fleet parks it; null = never auto-stop */
  idleStopMin: number | null;
  /** minutes used today, and the cap that applies — null capMinutes = Cloud, uncapped */
  minutes: number;
  capMinutes: number | null;
}

let usage: UsageReply | null = null;
const subs = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

/** re-read now. Exported because a wake, an upgrade, or anything else that should have changed
 *  the answer must not wait out the poll interval to show it. */
export function refreshCompute(): void {
  void nm?.machinesUsage?.()
    // a meter that cannot be read leaves the last good answer standing rather than blanking every
    // surface — "we could not look" is not "your machine is off"
    .then((u) => { if (u) { usage = u as UsageReply; subs.forEach((f) => f()); } })
    .catch(() => {});
}

function listen(fn: () => void): () => void {
  subs.add(fn);
  if (!timer) { timer = setInterval(refreshCompute, 60_000); window.addEventListener('focus', refreshCompute); }
  return () => {
    subs.delete(fn);
    if (subs.size === 0 && timer) {
      clearInterval(timer); timer = null; window.removeEventListener('focus', refreshCompute);
    }
  };
}

export function useCompute(authed: boolean): ComputeView | null {
  const [, bump] = useState(0);
  useEffect(() => {
    if (!authed) return;
    const off = listen(() => bump((n) => n + 1));
    refreshCompute();
    return off;
  }, [authed]);

  // ONE runner per workspace by construction (the machines_one_runner unique index), so the
  // workspace's compute state IS that machine's — there is no "best of" reduction to get wrong.
  const m = usage?.machines?.[0];
  if (!usage || !m) return null;
  const cap: MachineCap = { minutes: usage.minutes, capMinutes: usage.capMinutes, outOfCredits: usage.outOfCredits === true };
  return {
    ...machineState(m, cap, Date.now()),
    cap, plan: usage.plan, machineName: m.name,
    startedAt: m.startedAt ?? null, lastSeenAt: m.lastSeenAt, lastActiveAt: m.lastActiveAt ?? null,
    idleStopMin: m.idleStopMin ?? null,
    minutes: usage.minutes, capMinutes: usage.capMinutes,
  };
}
