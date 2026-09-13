// THE PHONE'S EDGE OF nm-relay (docs/42; the mobile-cloud round, S5.2) — the same relay-client the
// browser and the desktop's Code bridge use, composed for Expo: the API url and the /v1 auth
// headers from the one client, the attach credential (the Clerk bearer in production, the dev
// relay token on the engineering harness), and the machine the session names. One socket per
// app, many channels; bytes not strings — the package owns that. IT NEVER PRETENDS: no relay url
// means no lane, and Code says so instead of rendering an empty transcript.
import { ensureMachine, openRelayJsonChannel, type EnsurePhase, type RelayConfig } from '@neuramesh/relay-client';
import { machineState, type EngineeringCommand, type EngineeringOpenMeta, type EngineeringRuntimeEvent, type MachineCap } from '@neuramesh/shared';
import { api, currentBearer } from './auth';
import { DEV_RELAY_TOKEN, RELAY_URL } from './config';

export const relayConfigured = (): boolean => RELAY_URL.length > 0;

export interface EngineeringHandle {
  subId: string;
  send(command: EngineeringCommand): Promise<void>;
  close(): void;
}

/** the attach credential — the dev relay token on the harness, the Clerk bearer in production; the terminal page (S8) is handed the same one */
export const relayBearer = async (): Promise<string | null> => DEV_RELAY_TOKEN || currentBearer();

/** the runner's id when a session names no machine — one runner per workspace by construction */
async function runnerId(workspace: string): Promise<string | null> {
  try {
    const u = await api.machinesUsage(workspace);
    return u.machines.find((m) => m.kind === 'runner')?.id ?? u.machines[0]?.id ?? null;
  } catch {
    return null;
  }
}

/** open the Engineering lane to the machine the meta names (else the runner); the attach frame
 *  carries the machine id, so it is stripped from what the machine sees (it means nothing there) */
export function openEngineering(workspace: string, meta: EngineeringOpenMeta, onEvent: (e: EngineeringRuntimeEvent) => void, onExit: () => void): EngineeringHandle {
  const { machineId: named, ...rest } = meta;
  const cfg: RelayConfig = { relayUrl: RELAY_URL, clientBearer: relayBearer, machineId: named ? async () => named : () => runnerId(workspace) };
  const channel = openRelayJsonChannel(cfg, {
    lane: 'engineering',
    meta: rest as unknown as Record<string, unknown>,
    onMessage: (message) => onEvent(message as EngineeringRuntimeEvent),
    onExit,
    onError: (message) => onEvent({ type: 'error', message }),
  });
  return { subId: channel.subId, send: (command) => channel.send(command), close: () => channel.close() };
}

/** the boot card's work: wake the machine if it sleeps, wait for it to answer — the SHARED ensure
 *  (the same phases the browser shows), with the fleet's own state derivation for "is it up" */
export async function ensureCodeMachine(workspace: string, machineId: string, onPhase: (p: EnsurePhase) => void, cancelled?: () => boolean) {
  const status = async () => {
    try {
      const u = await api.machinesUsage(workspace);
      const m = u.machines.find((x) => x.id === machineId);
      if (!m) return null;
      const cap: MachineCap | null = u.capMinutes == null ? null : { minutes: u.minutes ?? 0, capMinutes: u.capMinutes, outOfCredits: u.outOfCredits ?? false };
      return machineState({ desiredReplicas: m.desiredReplicas, lastSeenAt: m.lastSeenAt, lastWakeAt: m.lastWakeAt, lifecycle: m.lifecycle }, cap, Date.now()).status;
    } catch {
      return null;
    }
  };
  return ensureMachine({
    machineId: async () => machineId,
    status,
    wake: async () => {
      try {
        const r = await api.wakeMachine(workspace, machineId);
        return { ok: !!r.ok, capped: !!r.capped };
      } catch {
        return { ok: false, capped: false };
      }
    },
    wait: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: () => Date.now(),
    cancelled,
  }, onPhase);
}
