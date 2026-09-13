// Provider auth detection (per machine). For each model provider we report whether its CLI
// is available and whether the user is already logged in with a subscription — read straight
// from the CLIs' own local login stores (~/.claude / ~/.codex / ~/.gemini, or the macOS
// Keychain). Nothing here leaves the machine; this only drives the "Bring your own brain"
// status UI and the daemon's subscription-first token resolution.
//
// The exact "is authenticated" signal differs per tool and may evolve — each probe is
// isolated below and any error/uncertainty is treated as "not authenticated".
import { spawn } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { which } from './cli';
import type { ProviderName } from './adapter';

export interface ProviderStatus {
  installed: boolean; // the provider's CLI is on PATH (Anthropic is always available via the SDK)
  authed: boolean; // a usable login exists on this machine
  method: 'subscription' | 'apikey' | null; // how that login authenticates
}

function fileExists(p: string): Promise<boolean> {
  return access(p).then(() => true).catch(() => false);
}

// A Claude login is only USABLE if its OAuth access token is still valid, or there's a refresh
// token to renew it. An expired token with no refresh (e.g. a one-shot setup-token that lapsed)
// would just 401 — treat it as unauthenticated so token resolution falls back to the API key.
function claudeTokenUsable(raw: string): boolean {
  try {
    const j = JSON.parse(raw) as Record<string, unknown>;
    const o = (j['claudeAiOauth'] as Record<string, unknown> | undefined) ?? j;
    const exp = typeof o['expiresAt'] === 'number' ? (o['expiresAt'] as number) : null;
    const hasRefresh = typeof o['refreshToken'] === 'string' && (o['refreshToken'] as string).length > 0;
    if (exp == null) return true; // no expiry info → trust the login
    return exp > Date.now() || hasRefresh; // still valid, or renewable
  } catch {
    return true; // present but unparseable → don't false-negative; let the SDK try
  }
}
function claudeKeychainRaw(): Promise<string | null> {
  return new Promise((res) => {
    const p = spawn('security', ['find-generic-password', '-s', 'Claude Code-credentials', '-w']);
    let out = '';
    p.stdout?.on('data', (d) => (out += d.toString()));
    p.on('close', (code) => res(code === 0 && out.trim() ? out.trim() : null));
    p.on('error', () => res(null));
  });
}
function claudeKeychainExists(): Promise<boolean> {
  return new Promise((res) => {
    const p = spawn('security', ['find-generic-password', '-s', 'Claude Code-credentials']);
    p.on('close', (code) => res(code === 0));
    p.on('error', () => res(false));
  });
}
// macOS keeps the Claude Code login in the encrypted Keychain; Linux/Windows use a file.
async function claudeAuthed(): Promise<boolean> {
  const cfgDir = process.env['CLAUDE_CONFIG_DIR'] || join(homedir(), '.claude');
  const fileRaw = await readFile(join(cfgDir, '.credentials.json'), 'utf8').catch(() => '');
  if (fileRaw) return claudeTokenUsable(fileRaw);
  if (process.platform === 'darwin') {
    const raw = await claudeKeychainRaw();
    if (raw) return claudeTokenUsable(raw); // read the token → validate expiry/refresh
    return claudeKeychainExists(); // couldn't read the secret → fall back to presence
  }
  return false;
}

// codex caches login in ~/.codex/auth.json — a `tokens` object means a ChatGPT OAuth
// (subscription) login; a bare key means api-key auth.
async function codexAuth(): Promise<{ authed: boolean; method: 'subscription' | 'apikey' | null }> {
  try {
    const j = JSON.parse(await readFile(join(homedir(), '.codex', 'auth.json'), 'utf8')) as {
      tokens?: unknown;
      OPENAI_API_KEY?: string;
    };
    if (j.tokens) return { authed: true, method: 'subscription' };
    if (j.OPENAI_API_KEY) return { authed: true, method: 'apikey' };
  } catch { /* no/invalid auth.json → not authenticated */ }
  return { authed: false, method: null };
}

// Google's consumer `gemini` CLI was deprecated 2026-06-18; its successor is Antigravity's `agy`,
// which signs in with a Google account (OS keyring, NO API key). There's no cheap "is signed in"
// probe, so we treat the deliberate install (the `agy` binary on disk — `which` also looks in
// ~/.local/bin where it lands) as the Google/OAuth signal; an un-signed-in `agy` surfaces an
// actionable "run `agy` to sign in" error on first use.
function geminiAuthed(): Promise<boolean> {
  return which('agy').then((p) => !!p);
}

// Per-provider subscription check used by the daemon's token resolution to prefer a
// subscription over an API key.
export async function hasSubscription(provider: ProviderName): Promise<boolean> {
  if (provider === 'anthropic') return claudeAuthed();
  if (provider === 'openai') return (await codexAuth()).method === 'subscription';
  return geminiAuthed();
}

// Does a subscription LOGIN exist for this provider AT ALL — present on disk/keychain — even if
// it's expired/unusable? `hasSubscription` validates the token (e.g. Claude OAuth expiry) and so
// can be false for a lapsed login; this returns true as long as the login was ever established.
// The daemon uses the gap (login present + not usable) to tell "subscription lapsed" (→ surface a
// reconnect card) apart from "never used a subscription" (→ a genuine API-key user, don't block).
export async function hasProviderLogin(provider: ProviderName): Promise<boolean> {
  if (provider === 'anthropic') {
    const cfgDir = process.env['CLAUDE_CONFIG_DIR'] || join(homedir(), '.claude');
    if (await fileExists(join(cfgDir, '.credentials.json'))) return true;
    if (process.platform === 'darwin') return claudeKeychainExists();
    return false;
  }
  // codex/gemini logins don't expose an expiry we can read, so "present" == "subscription".
  if (provider === 'openai') return (await codexAuth()).method === 'subscription';
  return geminiAuthed();
}

// Full snapshot for the UI — installed + authed + method per provider, probed concurrently.
export async function detectProviders(): Promise<Record<ProviderName, ProviderStatus>> {
  const [codexBin, agyBin, claudeOk, codex, geminiOk] = await Promise.all([
    which('codex'),
    which('agy'), // Google's runtime is the Antigravity CLI now (was the deprecated `gemini` CLI)
    claudeAuthed(),
    codexAuth(),
    geminiAuthed(),
  ]);
  return {
    // Anthropic runs through the bundled Agent SDK, so it's always "installed".
    anthropic: { installed: true, authed: claudeOk, method: claudeOk ? 'subscription' : null },
    openai: { installed: !!codexBin, authed: codex.authed, method: codex.method },
    gemini: { installed: !!agyBin, authed: geminiOk, method: geminiOk ? 'subscription' : null },
  };
}
