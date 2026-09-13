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
