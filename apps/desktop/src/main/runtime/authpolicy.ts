// The provider-auth resolution POLICY — a pure function (no I/O) so it's unit-testable and the
// rules live in one obvious place. `resolveToken` (agents.ts) gathers the inputs — the user's
// stored credential preference, the workspace failover policy, this machine's CLI-login detection,
// and the env key — then delegates the decision here.
//
// The doctrine it encodes: a SUBSCRIPTION (a local CLI login) is preferred when the user has one;
// if that login is down we NEVER silently bill an API key. Auto failover (an explicit workspace
// opt-in) may use a provided key; otherwise we return a `blocked` result and the caller surfaces a
// reconnect/switch card. A genuine API-key user (no CLI login, or explicit apikey mode) is never
// blocked.
import type { ProviderName } from './adapter';

export interface AuthResolution {
  token: string | null;
  // 'starter' = the PLATFORM pays: the agent is seated on the house model, which control-api
  // serves from its own key through a metered proxy. there is no token here by design — a token
  // would mean the key reached a machine, and a key on a machine is unmeterable.
  authMode: 'subscription' | 'apikey' | 'none' | 'starter';
  source: string;
  // Set when the user PREFERS a subscription but it isn't usable AND failover is Manual (or no key
  // is available): we resolve to no token rather than billing a key. Callers post an auth card.
  blocked?: { provider: ProviderName; reason: 'expired' | 'unavailable' };
}

export interface AuthInputs {
  provider: ProviderName;
  storedAuthMode: 'apikey' | 'subscription' | null; // the user's stored preference (null = none set)
  storedToken: string | null; // a stored key: the apikey credential, or a subscription's failover key
  autoFailover: boolean; // workspace policy: auto = may fall over to a key; manual (default) = block
  subActive: boolean; // hasSubscription(provider) — a usable CLI login exists right now
  loginPresent: boolean; // hasProviderLogin(provider) — a CLI login exists at all (maybe expired)
  envKey: string | null; // the machine's env API key for this provider, if any
  // THIS member's own key, held on THIS machine and never uploaded (0114). It outranks
  // `storedToken` wherever a key is used: under shared compute the stored one is the WORKSPACE's
  // key — whoever configured it — and a member who supplied their own must never silently bill a
  // teammate's. Absent for everyone who has not set one, so the old order is unchanged for them.
  memberKey?: string | null;
  /** the agent is seated on the platform's own model (rates.ts STARTER_MODEL). it rescues only
   *  the outcomes that would otherwise be 'none': a user's own credential always wins, so
   *  connecting a brain takes over immediately and never silently keeps drawing credits. */
  platformModel?: boolean;
  /** this agent runs on a CLOUD machine (`machines.kind` 'runner' | 'member'), which carries no
   *  vendor logins by design — machined sets NM_MACHINE_KIND. It widens the house-model rescue to
   *  cover a blocked subscription, because that subscription can never be satisfied here. Absent
   *  on a laptop the user owns, where the block stands. */
  cloudMachine?: boolean;
}

/** The key this machine should bill, in precedence order: mine, then the workspace's, then env. */
const keyFor = (i: AuthInputs): { token: string; source: string } | null => (
  i.memberKey ? { token: i.memberKey, source: 'member' }
    : i.storedToken ? { token: i.storedToken, source: 'cred' }
      : i.envKey ? { token: i.envKey, source: 'env' }
        : null
);

export function decideAuth(i: AuthInputs): AuthResolution {
  // Explicit API-key mode: always the key (the user's choice). Never subscription, never blocked.
  if (i.storedAuthMode === 'apikey') {
    const k = keyFor(i);
    return k ? { token: k.token, authMode: 'apikey', source: k.source } : starterOr(i, { token: null, authMode: 'none', source: 'none' });
  }

  // Otherwise the user PREFERS a subscription when one exists — explicitly (authMode
  // 'subscription') or by auto-detection (no cred row + a CLI login present on this machine).
  const prefersSub = i.storedAuthMode === 'subscription' || i.loginPresent;
  if (prefersSub) {
    if (i.subActive) return { token: null, authMode: 'subscription', source: 'subscription' };
    // Preferred subscription isn't usable. Auto failover (+ a key) → use it; else BLOCK so we
    // never silently bill a key the user didn't opt into for this run.
    // `source` stays exactly 'failover' — it is an established value the wake log prints and a
    // test pins. The member key changes WHICH key fails over, not what the failover is called.
    const failoverKey = keyFor(i);
    if (i.autoFailover && failoverKey) return { token: failoverKey.token, authMode: 'apikey', source: 'failover' };
    const blocked: AuthResolution = { token: null, authMode: 'none', source: 'subscription-blocked', blocked: { provider: i.provider, reason: i.loginPresent ? 'expired' : 'unavailable' } };
    // A CLOUD machine carries no vendor logins BY DESIGN — you install nothing on it, and the house
    // brain is what it comes with. The preference that blocks here was set on a machine the user
    // OWNS and can never be satisfied on this one, so the block made a fresh cloud machine unusable
    // out of the box: every agent refused, with credits sitting unspent (George, 2026-09-08).
    // Serving the house model from the workspace's own credits is that machine's DEFAULT, not a
    // downgrade. On a machine the user owns the block still stands — there the login is genuinely
    // reconnectable, and spending platform credits instead of telling them would be the silent
    // downgrade this rule exists to prevent.
    return i.cloudMachine ? starterOr(i, blocked) : blocked;
  }

  // No subscription intent at all → my key, the workspace's, or the env's, in that order.
  const k = keyFor(i);
  if (k) return { token: k.token, authMode: 'apikey', source: k.source };
  // nothing of the user's resolved. if this agent runs the HOUSE model, the platform serves it
  // — that is the whole starter lane, and it is the only path that reaches a metered proxy.
  return starterOr(i, { token: null, authMode: 'none', source: 'none' });
}

/** the house-model rescue, applied only where the answer would otherwise be "no credential" */
function starterOr(i: AuthInputs, fallback: AuthResolution): AuthResolution {
  return i.platformModel ? { token: null, authMode: 'starter', source: 'starter' } : fallback;
}
