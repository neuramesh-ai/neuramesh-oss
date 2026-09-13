// Truth table for the provider-auth resolution policy (the no-silent-billing rules). Run:
//   node --import <tsx> --test apps/desktop/src/main/runtime/authpolicy.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideAuth, type AuthInputs } from './authpolicy';

// sensible defaults; each case overrides only what it exercises.
const base: AuthInputs = {
  provider: 'anthropic',
  storedAuthMode: null,
  storedToken: null,
  autoFailover: false,
  subActive: false,
  loginPresent: false,
  envKey: null,
};
const decide = (o: Partial<AuthInputs>) => decideAuth({ ...base, ...o });

test('subscription active → use the subscription (no token)', () => {
  // auto-detected (a CLI login, no stored pref)
  let r = decide({ loginPresent: true, subActive: true });
  assert.equal(r.authMode, 'subscription');
  assert.equal(r.token, null);
  assert.equal(r.blocked, undefined);
  // explicit subscription preference
  r = decide({ storedAuthMode: 'subscription', subActive: true });
  assert.equal(r.authMode, 'subscription');
});

test('subscription expired + Manual failover + env key present → BLOCKED, never the key', () => {
  // explicit subscription
  let r = decide({ storedAuthMode: 'subscription', loginPresent: true, subActive: false, autoFailover: false, envKey: 'sk-ant-should-not-be-used' });
  assert.equal(r.token, null, 'must NOT bill the API key');
  assert.equal(r.authMode, 'none');
  assert.ok(r.blocked, 'blocked must be set');
  assert.equal(r.blocked?.reason, 'expired');
  assert.equal(r.blocked?.provider, 'anthropic');
  // auto-detected subscription (no cred row) that lapsed, with an env key sitting around
  r = decide({ storedAuthMode: null, loginPresent: true, subActive: false, autoFailover: false, envKey: 'sk-ant-x' });
  assert.equal(r.token, null);
  assert.ok(r.blocked);
});

test('subscription down + Auto failover + a key → fail over to the key', () => {
  // env key
  let r = decide({ storedAuthMode: 'subscription', loginPresent: true, subActive: false, autoFailover: true, envKey: 'sk-env' });
  assert.equal(r.token, 'sk-env');
  assert.equal(r.authMode, 'apikey');
  assert.equal(r.source, 'failover');
  assert.equal(r.blocked, undefined);
  // stored failover key on the subscription credential
  r = decide({ storedAuthMode: 'subscription', storedToken: 'sk-stored', loginPresent: true, subActive: false, autoFailover: true });
  assert.equal(r.token, 'sk-stored');
  assert.equal(r.source, 'failover');
});

test('Auto failover ON but NO key available → still BLOCKED (nothing to fail over to)', () => {
  const r = decide({ storedAuthMode: 'subscription', loginPresent: true, subActive: false, autoFailover: true, envKey: null, storedToken: null });
  assert.equal(r.token, null);
  assert.ok(r.blocked);
});

test('explicit API-key mode → always the key, never subscription, never blocked', () => {
  // stored key
  let r = decide({ storedAuthMode: 'apikey', storedToken: 'sk-cred' });
  assert.equal(r.token, 'sk-cred');
  assert.equal(r.source, 'cred');
  // env key fallback in apikey mode
  r = decide({ storedAuthMode: 'apikey', storedToken: null, envKey: 'sk-env' });
  assert.equal(r.token, 'sk-env');
  assert.equal(r.source, 'env');
  // apikey mode is never blocked even if a (stale) subscription login exists
  r = decide({ storedAuthMode: 'apikey', storedToken: 'sk-cred', loginPresent: true, subActive: false });
  assert.equal(r.blocked, undefined);
});

test('genuine API-key user (no CLI login) with an env key → use the key, NOT blocked', () => {
  const r = decide({ storedAuthMode: null, loginPresent: false, subActive: false, envKey: 'sk-env' });
  assert.equal(r.token, 'sk-env');
  assert.equal(r.authMode, 'apikey');
  assert.equal(r.blocked, undefined, 'a pure API-key user is never blocked');
});

test('nothing configured → none', () => {
  const r = decide({});
  assert.equal(r.authMode, 'none');
  assert.equal(r.source, 'none');
  assert.equal(r.token, null);
  assert.equal(r.blocked, undefined);
});

test('expired vs unavailable reason: login present → expired; absent → unavailable', () => {
  assert.equal(decide({ storedAuthMode: 'subscription', loginPresent: true, subActive: false }).blocked?.reason, 'expired');
  assert.equal(decide({ storedAuthMode: 'subscription', loginPresent: false, subActive: false }).blocked?.reason, 'unavailable');
});

// ── shared compute: whose key gets billed (0114) ─────────────────────────────
// Under shared compute several members' machines serve one workspace. `storedToken` is the
// WORKSPACE credential — whoever configured it — so a member who supplied their own key on their
// own machine must never silently bill a teammate's. These pin that order.

test('a member key on this machine outranks the workspace credential', () => {
  const r = decide({ storedAuthMode: 'apikey', storedToken: 'ws-key', memberKey: 'my-key' });
  assert.equal(r.token, 'my-key');
  assert.equal(r.source, 'member');
});

test('...and outranks it on the no-subscription-intent path too', () => {
  const r = decide({ storedToken: 'ws-key', memberKey: 'my-key' });
  assert.equal(r.token, 'my-key');
  assert.equal(r.source, 'member');
});

test('...and is the key that fails over when a subscription is down', () => {
  const r = decide({ storedAuthMode: 'subscription', subActive: false, loginPresent: true, autoFailover: true, storedToken: 'ws-key', memberKey: 'my-key' });
  assert.equal(r.token, 'my-key');
  // the NAME of the failover is unchanged — only which key it reaches for
  assert.equal(r.source, 'failover');
});

test('no member key → the old order stands exactly (workspace, then env)', () => {
  assert.equal(decide({ storedToken: 'ws-key', envKey: 'env-key' }).token, 'ws-key');
  assert.equal(decide({ envKey: 'env-key' }).token, 'env-key');
  assert.equal(decide({ storedAuthMode: 'apikey', storedToken: 'ws-key' }).source, 'cred');
});

test('a member key never defeats a WORKING subscription — local login still wins', () => {
  // the member set a key AND is signed in; the subscription is what they are paying for
  const r = decide({ storedAuthMode: 'subscription', subActive: true, loginPresent: true, memberKey: 'my-key' });
  assert.equal(r.authMode, 'subscription');
  assert.equal(r.token, null);
});

test('a member key does NOT unblock a manual-failover subscription outage', () => {
  // no-silent-billing survives: having your own key is not consent to spend it mid-run
  const r = decide({ storedAuthMode: 'subscription', subActive: false, loginPresent: true, autoFailover: false, memberKey: 'my-key' });
  assert.equal(r.token, null);
  assert.equal(r.blocked?.reason, 'expired');
});

// ── the starter lane (starter-brain round) ────────────────────────────────────────────────
// `platformModel` says this agent is seated on the HOUSE model, which control-api serves from
// its own key through a metered proxy. It is a rescue, never a preference: every credential the
// user actually has must still win, or connecting a brain would not take over and we would keep
// spending our own credits for someone who is paying elsewhere.

test('the house model is served by the platform when the user has nothing', () => {
  const r = decide({ platformModel: true });
  assert.equal(r.authMode, 'starter');
  // no token, by design — a token would mean the platform key reached a machine, and a key on a
  // machine cannot be metered
  assert.equal(r.token, null);
  assert.equal(r.source, 'starter');
});

test('without the house model, nothing-resolves is still nothing', () => {
  assert.equal(decide({}).authMode, 'none');
});

test("the user's own credential ALWAYS beats the house model", () => {
  // workspace key
  assert.equal(decide({ platformModel: true, storedToken: 'ws-key' }).authMode, 'apikey');
  // their own machine-local key
  assert.equal(decide({ platformModel: true, memberKey: 'my-key' }).token, 'my-key');
  // an env key on this machine
  assert.equal(decide({ platformModel: true, envKey: 'env-key' }).token, 'env-key');
  // explicit apikey mode with a key present
  assert.equal(decide({ platformModel: true, storedAuthMode: 'apikey', storedToken: 'k' }).source, 'cred');
});

test('explicit apikey mode with NO key falls to the house model rather than dead-ending', () => {
  const r = decide({ platformModel: true, storedAuthMode: 'apikey' });
  assert.equal(r.authMode, 'starter');
});

test('on a machine you OWN a blocked subscription still BLOCKS the house model — not a silent downgrade', () => {
  // the block exists so we never spend something the user did not opt into for this run. quietly
  // switching them to platform credits would be exactly that, with our money instead of theirs.
  // This holds where the login is genuinely reconnectable: the user's own laptop.
  const r = decide({ platformModel: true, storedAuthMode: 'subscription', subActive: false, loginPresent: true });
  assert.equal(r.authMode, 'none');
  assert.equal(r.source, 'subscription-blocked');
});

test('on a CLOUD machine the house model serves a blocked subscription — there is no login to reconnect', () => {
  // A cloud machine carries no vendor logins by design, so the preference that blocks here was set
  // on a machine the user owns and can NEVER be satisfied on this one. Blocking left a fresh cloud
  // machine unusable with credits unspent (George, 2026-09-08): the house brain is its default.
  const r = decide({ cloudMachine: true, platformModel: true, storedAuthMode: 'subscription', subActive: false, loginPresent: false });
  assert.equal(r.authMode, 'starter');
  assert.equal(r.source, 'starter');
  assert.equal(r.blocked, undefined, 'a cloud machine must not dead-end on a login it cannot have');
});

test('a cloud machine still blocks when the agent is NOT on the house model', () => {
  // the platform key only ever covers the house model — there is nothing to serve a real model with
  const r = decide({ cloudMachine: true, storedAuthMode: 'subscription', subActive: false, loginPresent: false });
  assert.equal(r.source, 'subscription-blocked');
});

test("a cloud machine still prefers the user's own credential over house credits", () => {
  // the rescue must not outrank a credential that actually resolves, or connecting a brain on the
  // cloud machine would not take over
  assert.equal(decide({ cloudMachine: true, platformModel: true, storedAuthMode: 'subscription', subActive: true }).authMode, 'subscription');
  assert.equal(decide({ cloudMachine: true, platformModel: true, storedAuthMode: 'subscription', subActive: false, autoFailover: true, storedToken: 'k' }).source, 'failover');
});
