// THIS MACHINE'S ROW on a connection: register once, heartbeat every 30s (docs/03 §4).
//
// Per connection, because presence is per backend: the same laptop is a machine in the local
// workspace AND in a cloud workspace, and each stack keeps its own `machines` row for it.
import { hostname } from 'node:os';
import { app } from 'electron';
import { localRuntimes } from '../agents';
import { apiAuthHeaders } from '../apiauth';
import type { Connection } from '../connections';

/**
 * This machine's name — the identity `machines` upserts on, per `(workspace_id, name)`.
 *
 * `NM_MACHINE_NAME` overrides the hostname. Shared compute (0114) is about SEVERAL members'
 * machines serving one workspace, and two app instances on one physical Mac share a hostname —
 * so without an override they collapse into a single machines row and the whole feature is
 * untestable on a developer's laptop. Same reasoning as dev-mode workspace resolution: if the
 * loop cannot be exercised here, it cannot be dogfooded here (CLAUDE.md — this repo is user zero).
 * Unset in every normal run, where the hostname is exactly right.
 */
export function machineName(): string {
  const override = process.env['NM_MACHINE_NAME']?.trim();
  // the name is an ADDRESS on the server (`machine:<name>`, the event target), so it carries only
  // what an address may: an override with a space or a quote is folded to hyphens, never a 500
  return (override || hostname().replace(/\.local$/i, '')).toLowerCase().replace(/[^a-z0-9.-]+/g, '-').replace(/^-+|-+$/g, '');
}

export async function registerThisMachine(conn: Connection, actorId: (c: Connection) => string): Promise<string | null> {
  const name = machineName();
  conn.thisMachineName = name;
  const headers = () => apiAuthHeaders(conn.apiUrl, { kind: 'human', id: actorId(conn) });
  try {
    const res = await fetch(`${conn.apiUrl}/v1/commands`, {
      method: 'POST',
      headers: await headers(),
      // `runtimes` publishes what this machine can actually serve (0114). Peers read it to tell
      // "the origin's machine is busy" from "it can never run this" — without it, failover either
      // waits out a grace window for a host that will never answer, or races one that would have.
      body: JSON.stringify({ type: 'machine.register', workspace: conn.ws, name, platform: process.platform, daemonVersion: app.getVersion(), runtimes: await localRuntimes().catch(() => []) }),
    });
    if (!res.ok) {
      const text = await res.text();
      let parsed: { error?: string; code?: string } = {};
      try { parsed = JSON.parse(text) as { error?: string; code?: string }; } catch { /* non-JSON body */ }
      // A 2nd machine on a Free workspace — surface the transfer-or-upgrade card, don't fail silently.
      // Log it. A refusal here leaves the agent host unstarted — no agent responds, monitors or
      // summarises — and returning null silently made that look identical to "still booting".
      // The renderer gets its transfer-or-upgrade card either way; this is for whoever is
      // reading the log wondering why the daemon is inert.
      if (parsed.code === 'MACHINE_LIMIT') {
        console.warn(`machine_limit name=${name} — this machine was NOT registered, so no agent host started. ${parsed.error ?? ''}`);
        conn.machineLimit = { message: parsed.error ?? 'This workspace is active on another machine.' };
        return null;
      }
      throw new Error(`register ${res.status}`);
    }
    const { machineId } = (await res.json()) as { machineId: string };
    conn.thisMachineId = machineId;
    console.log(`machine_registered id=${machineId.slice(0, 8)} name=${name} conn=${conn.id}`);
    const beat = setInterval(() => {
      // the mint is async, so the beat fires a promise it does not await — a heartbeat that
      // slipped a tick is not worth holding the timer for
      void (async () => {
        await fetch(`${conn.apiUrl}/v1/commands`, {
          method: 'POST',
          headers: await headers(),
          body: JSON.stringify({ type: 'machine.heartbeat', machineId }),
        }).catch(() => {});
      })();
    }, 30_000);
    app.on('before-quit', () => clearInterval(beat));
    return machineId;
  } catch (err) {
    console.error('machine registration failed:', err);
    return null;
  }
}
