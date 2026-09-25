// THE TERMINAL LANES, OVER nm-relay (plan §3.5) — the three call sites webnm-local.ts
// named when it wrote "WHEN THE RELAY LANDS, these are the call sites to replace".
//
// LAYERED ON TOP OF localOverrides, NEVER INSTEAD OF IT. main.tsx spreads this after the
// local refusals, so a build with no relay configured keeps the honest "No shell here."
// and a build with one gets a real shell. The feature is therefore additive: nothing
// regresses if the relay is down, unreachable, or simply not deployed to this environment.
import { ensureMachine, openRelayJsonChannel, openRelayPty, type RelayConfig } from '@neuramesh/relay-client';
import { machineState, type MachineCap } from '@neuramesh/shared';

/** what the relay bridge needs from its HOST. The browser hands its config plus its auth
 *  headers (main.tsx); the desktop hands what its main process answers over three IPC calls
 *  (src/bridge/desktop-relay.ts). One bridge, two hosts — the desktop Code bridge, 2026-09-04. */
export interface RelayEnv {
  apiUrl: string;
  workspaceId(): string;
  /** /v1 auth headers: the Clerk bearer in production, x-nm-actor on the dev stacks */
  authHeaders(): Promise<Record<string, string>>;
  /** the relay attach credential (docs/42): the Clerk bearer, or a dev-only identity token */
  relayBearer(): Promise<string | null>;
}
import type { NMBridge } from '../src/bridge/nm';
import type { EngineeringCommand } from '../../engineering-protocol';

interface MachineRow {
  id: string; name: string; desiredReplicas: number;
  lastSeenAt: string | null; lastWakeAt: string | null; lifecycle: string | null;
}
interface UsageReply { machines?: MachineRow[]; minutes?: number; capMinutes?: number | null; plan?: string }

export function createEngineeringAttachmentAcknowledgements(timeoutMs = 30_000) {
  const pending = new Map<string, { resolve(): void; reject(error: unknown): void; timer: ReturnType<typeof setTimeout> }>();
  return {
    wait(key: string): Promise<void> {
      return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(key); reject(new Error('The Engineering attachment upload timed out.')); }, timeoutMs);
        pending.set(key, { resolve, reject, timer });
      });
    },
    resolve(key: string): void {
      const item = pending.get(key);
      if (!item) return;
      clearTimeout(item.timer); pending.delete(key); item.resolve();
    },
    cancel(key: string): void {
      const item = pending.get(key);
      if (!item) return;
      clearTimeout(item.timer); pending.delete(key);
    },
    rejectAll(error: Error): void {
      for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error); }
      pending.clear();
    },
  };
}

/** the workspace's runner id, cached briefly.
 *
 *  Cached because every terminal open would otherwise re-ask, and a person opening three
 *  tabs should not cost three round-trips for an answer that changes when a machine is
 *  created — which is approximately never. Short, because the FIRST wake creates the row,
 *  and a long cache would make the terminal keep saying "no machine yet" for minutes after
 *  one appeared. */
/** machine.promote for the shell: `promoted` is true only when the row was a claim and is now a
 *  volume coming back; a refusal (not this person's machine) or a volume already answers false,
 *  and the shell opens on what is there — a promotion never blocks a terminal */
async function nmPromote(env: RelayEnv, machineId: string): Promise<{ ok?: boolean; promoted?: boolean } | null> {
  try {
    const res = await fetch(`${env.apiUrl}/v1/commands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await env.authHeaders()) },
      body: JSON.stringify({ type: 'machine.promote', workspace: env.workspaceId(), machineId }),
    });
    return res.ok ? ((await res.json()) as { ok?: boolean; promoted?: boolean }) : null;
  } catch { return null; }
}

/** POST the wake. A capped refusal is a 409 with a code, not a failure to report as one. */
async function nmWake(env: RelayEnv): Promise<{ ok?: boolean; capped?: boolean } | null> {
  try {
    const res = await fetch(`${env.apiUrl}/v1/machines/wake`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await env.authHeaders()) },
      body: JSON.stringify({ workspace: env.workspaceId() }),
    });
    return (await res.json()) as { ok?: boolean; capped?: boolean };
  } catch { return null; }
}

function machineResolver(env: RelayEnv): () => Promise<string | null> {
  let cached: string | null = null;
  let at = 0;
  return async () => {
    if (cached && Date.now() - at < 30_000) return cached;
    try {
      const res = await fetch(
        `${env.apiUrl}/v1/machines/usage?workspace=${encodeURIComponent(env.workspaceId())}`,
        { headers: await env.authHeaders() },
      );
      if (!res.ok) return cached; // keep the last good answer; a failed read is not "no machine"
      const body = (await res.json()) as UsageReply;
      // one runner per workspace by construction (the machines_one_runner unique index)
      const id = body.machines?.[0]?.id ?? null;
      if (id) { cached = id; at = Date.now(); }
      return id;
    } catch {
      return cached;
    }
  };
}

/** the usage read, shared by the id resolver and the status probe so a boot costs one poll */
async function readUsage(env: RelayEnv): Promise<UsageReply | null> {
  try {
    const res = await fetch(
      `${env.apiUrl}/v1/machines/usage?workspace=${encodeURIComponent(env.workspaceId())}`,
      { headers: await env.authHeaders() },
    );
    return res.ok ? ((await res.json()) as UsageReply) : null;
  } catch { return null; }
}

export function relayOverrides(env: RelayEnv, relayUrl: string): Partial<NMBridge> {
  const machineId = machineResolver(env);
  const relay: RelayConfig = { relayUrl, clientBearer: env.relayBearer, machineId };

  // the SAME derivation every other compute surface uses — a second opinion about whether a
  // machine is awake is how two surfaces come to disagree about one machine
  const status = async (): Promise<ReturnType<typeof machineState>['status'] | null> => {
    const u = await readUsage(env);
    const m = u?.machines?.[0];
    if (!m) return null;
    const cap: MachineCap | null = u?.capMinutes == null
      ? null
      : { minutes: u.minutes ?? 0, capMinutes: u.capMinutes };
    return machineState(
      { desiredReplicas: m.desiredReplicas, lastSeenAt: m.lastSeenAt, lastWakeAt: m.lastWakeAt, lifecycle: m.lifecycle },
      cap,
      Date.now(),
    ).status;
  };

  return {
    // the SHELL's ensure (guests.tsx is its one caller): a claim runner gets its own disk before
    // the prompt appears, so a sign-in typed into it survives the next stop (round §4.2, D2)
    machineEnsure: async (onPhase, cancelled) => {
      const out = await ensureMachine({
        machineId,
        status,
        wake: async () => {
          const r = await nmWake(env);
          return { ok: !!r?.ok, capped: !!r?.capped };
        },
        promote: async () => {
          const id = await machineId();
          if (!id) return { restarting: false };
          const r = await nmPromote(env, id);
          return { restarting: !!r?.promoted };
        },
        lastSeenAt: async () => {
          const m = (await readUsage(env))?.machines?.[0];
          return m?.lastSeenAt ? Date.parse(m.lastSeenAt) : null;
        },
        wait: (ms) => new Promise((r) => setTimeout(r, ms)),
        now: () => Date.now(),
        cancelled,
      }, onPhase);
      return out.ok ? { ok: true } : { ok: false, reason: out.reason, detail: out.detail };
    },

    engineeringInfo: async () => {
      const id = await machineId();
      return { available: id !== null, ...(id === null ? { reason: 'No cloud machine is available for this workspace yet.' } : {}) };
    },

    openEngineering: (meta, onEvent, onExit) => {
      const acknowledgements = createEngineeringAttachmentAcknowledgements();
      // rule D9: a session that names its machine dials THAT machine; the attach frame carries the
      // id, so the choice is stripped from the meta the machine sees (it means nothing there)
      const { machineId: named, ...rest } = meta;
      const target: RelayConfig = named ? { ...relay, machineId: async () => named } : relay;
      const channel = openRelayJsonChannel(target, {
        lane: 'engineering', meta: rest as unknown as Record<string, unknown>,
        onMessage: (message) => {
          const event = message as Parameters<typeof onEvent>[0];
          if (event.type === 'attachment_ack') {
            acknowledgements.resolve(`${event.id}:${event.index}`);
            return;
          }
          onEvent(event);
        },
        onExit: () => { acknowledgements.rejectAll(new Error('The Engineering relay closed during upload.')); onExit(); },
        onError: (message) => onEvent({ type: 'error', message }),
      });
      const acknowledgementKey = (command: EngineeringCommand): string | null => command.type === 'attachment_start'
        ? `${command.id}:-1` : command.type === 'attachment_chunk' ? `${command.id}:${command.index}` : command.type === 'attachment_end' ? `${command.id}:-2` : null;
      return { subId: channel.subId, send: async (command) => {
        const key = acknowledgementKey(command);
        if (!key) { await channel.send(command); return; }
        const acknowledged = acknowledgements.wait(key);
        try { await channel.send(command); await acknowledged; }
        catch (error) { acknowledgements.cancel(key); throw error; }
      }, close: () => { acknowledgements.rejectAll(new Error('The Engineering relay channel closed.')); channel.close(); } };
    },

    // AVAILABILITY IS "there is a machine to talk to", not "the folder exists". The desktop
    // can stat the worktree; a browser cannot, and guessing yes would put a terminal button
    // in front of a workspace that has never woken. The machine edge resolves the path and
    // says so in the pane if it is missing — the same note the desktop prints today.
    terminalInfo: async () => ({ available: (await machineId()) !== null, cwd: null }),

    openTerminal: (taskNumber, hasRepo, cols, rows, onData, onExit) =>
      openRelayPty(relay, { cols, rows, taskNumber, hasRepo, onData, onExit }),

    openTerminalCwd: (cwd, cols, rows, onData, onExit) =>
      openRelayPty(relay, { cols, rows, cwd, onData, onExit }),
  };
}
