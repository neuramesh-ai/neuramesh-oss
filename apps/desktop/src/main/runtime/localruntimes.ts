// What THIS machine can actually serve right now — a login present, or a key available (0114).
//
// Published on the `machines` row so PEERS can read it: the desktop at `machine.register`, a
// cloud machine on its heartbeat (member-machines round — it never registers, and a login made
// in its browser terminal has to reach the row or the ladder can never choose it while it
// sleeps). A host can probe itself, but the origin-affinity policy has to tell "the origin
// machine is busy" from "the origin machine can never run this" — and only that machine knows
// which. Without it, a member whose laptop has no Codex login would have every codex agent's
// work wait out a grace window before anyone stepped in, on every single item.
//
// Extracted from agents.ts (which sits at its size-ratchet cap) in the member-machines round.
import type { Runtime } from '@neuramesh/shared';
import { keyEnvFor, providerFor } from './adapter';
import { hasProviderLogin, hasSubscription } from './detect';

/** Every runtime, with the provider it authenticates against. */
const RUNTIME_PROVIDERS: ReadonlyArray<Runtime> = ['claude-code', 'codex', 'gemini'];

export async function localRuntimes(): Promise<string[]> {
  const out: string[] = [];
  await Promise.all(RUNTIME_PROVIDERS.map(async (runtime) => {
    const provider = providerFor(runtime);
    const [sub, login] = await Promise.all([hasSubscription(provider), hasProviderLogin(provider)]);
    const envKey = keyEnvFor(provider).some((k) => !!process.env[k]);
    if (sub || login || envKey) out.push(runtime);
  }));
  return out;
}

// THE WORKSPACE'S OWN KEYS, ON A CLOUD MACHINE (2026-09-25). A person who adds an API key in the
// Keys step stores it as the workspace credential, and resolveToken runs a turn on it. But the
// ladder reads only what a machine PUBLISHES, and a cloud machine has no login and no env key, so
// every agent on that provider was refused: "No machine available to me can serve Claude" (the
// k3d run behind this). On a cloud machine, a provider with a stored workspace API key is
// servable. A laptop keeps its own logins and keys: the stored credential never made it capable.

/** does the workspace hold an API key for this provider? */
export type KeyProbe = (provider: string) => Promise<boolean>;

/** the stored-credential probe, over the lane resolveToken already uses */
export function workspaceKeyProbe(apiUrl: string, workspace: string, headers: () => Promise<Record<string, string>>): KeyProbe {
  return async (provider) => {
    const r = await fetch(`${apiUrl}/v1/credentials/resolve?workspace=${encodeURIComponent(workspace)}&provider=${encodeURIComponent(provider)}`, { headers: await headers() });
    if (!r.ok) return false;
    const j = (await r.json()) as { token?: string | null; authMode?: string | null };
    return j.authMode === 'apikey' && !!j.token;
  };
}

/** what a machine can serve: its own logins and env keys, and on a cloud machine the workspace's
 *  stored API keys as well. A probe that fails counts as no key, never as a refusal of the rest. */
export async function machineRuntimes(o: { cloud: boolean; hasKey: KeyProbe; local?: () => Promise<string[]> }): Promise<string[]> {
  const [local, stored] = await Promise.all([
    (o.local ?? localRuntimes)().catch(() => [] as string[]),
    o.cloud ? Promise.all(RUNTIME_PROVIDERS.map((r) => o.hasKey(providerFor(r)).catch(() => false))) : Promise.resolve([] as boolean[]),
  ]);
  return RUNTIME_PROVIDERS.filter((r, i) => local.includes(r) || stored[i] === true);
}

/** a host's view of itself, re-probed on demand: a key added a minute ago must serve the next
 *  message, so a host re-asks before it refuses a runtime it lacks, at most once per `minGapMs` */
export function runtimeProbe(o: { cloud: boolean; hasKey: KeyProbe; local?: () => Promise<string[]>; minGapMs?: number; now?: () => number }) {
  const now = o.now ?? Date.now;
  const gap = o.minGapMs ?? 30_000;
  let value: string[] = [];
  let at = Number.NEGATIVE_INFINITY;
  const refresh = async (): Promise<string[]> => {
    at = now();
    value = await machineRuntimes(o);
    return value;
  };
  return {
    refresh,
    current: (): string[] => value,
    /** the runtimes, re-probed first on a cloud machine when this one is missing and the last
     *  probe is stale. A laptop keeps its old rhythm: its logins refresh on the register beat. */
    ensure: async (runtime: string): Promise<string[]> => (!o.cloud || value.includes(runtime) || now() - at < gap ? value : refresh()),
  };
}
