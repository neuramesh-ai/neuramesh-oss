// A member's OWN API key, stored on their OWN machine and never uploaded (0114).
//
// Shared compute means several members' machines serve one workspace, each under that member's
// own subscription or key. `provider_credentials` is workspace-scoped, so before this the only
// key a joining teammate could use was whoever-configured-the-workspace's — the opposite of
// "your keys, your machine", and another plaintext token server-side.
//
// The key never leaves this machine: it is not synced, not posted, and not readable through the
// API. The server learns nothing about it. That is the whole point, and it is why this is a
// local file rather than another `provider_credentials` scope.
//
// Not encryption, but not worse than what it replaces either: the alternative today is an env
// var in the user's shell, and the file sits inside the app's own userData directory, which the
// agent sandbox already jails agents out of (fsjail's CRED_TARGETS).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const FILE = 'member-keys.json';
const keyFile = (userDataDir: string): string => join(userDataDir, FILE);

type Store = Record<string, string>;

function readAll(userDataDir: string): Store {
  try {
    const raw = JSON.parse(readFileSync(keyFile(userDataDir), 'utf8')) as Store;
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {}; // missing or corrupt → no local key, fall back to the workspace credential
  }
}

/** This member's own key for a provider on THIS machine, or null. */
export function readMemberKey(userDataDir: string, provider: string): string | null {
  const v = readAll(userDataDir)[provider];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/** Set (or clear, with null) this member's own key. Writes only to disk — never to the server. */
export function writeMemberKey(userDataDir: string, provider: string, key: string | null): void {
  mkdirSync(userDataDir, { recursive: true });
  const all = readAll(userDataDir);
  if (key && key.trim()) all[provider] = key.trim();
  else delete all[provider];
  writeFileSync(keyFile(userDataDir), JSON.stringify(all), { encoding: 'utf8', mode: 0o600 });
}

/** Which providers this machine holds a member key for — safe to surface in the UI (no values). */
export function memberKeyProviders(userDataDir: string): string[] {
  return Object.keys(readAll(userDataDir));
}
