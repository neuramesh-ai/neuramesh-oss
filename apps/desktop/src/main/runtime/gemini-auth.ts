import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

type Login = { present: boolean; usable: boolean };
type LoginStores = { keychain: () => Promise<string | null>; file: () => Promise<string | null> };

// agy stores both personal and Enterprise Google OAuth profiles. macOS go-keyring wraps
// the JSON in base64; the fallback file on headless machines contains the JSON directly.
// Never return the profile or tokens: only these two availability flags leave the reader.
export function geminiLogin(raw: string, now = Date.now()): Login {
  try {
    const prefix = 'go-keyring-base64:';
    const json = raw.startsWith(prefix) ? Buffer.from(raw.slice(prefix.length), 'base64').toString('utf8') : raw;
    const j = JSON.parse(json) as { auth_method?: string; token?: { access_token?: string; refresh_token?: string; expiry?: string } };
    const token = j.token;
    const access = typeof token?.access_token === 'string' && token.access_token.length > 0;
    const refresh = typeof token?.refresh_token === 'string' && token.refresh_token.length > 0;
    const present = (j.auth_method === 'consumer' || j.auth_method === 'gcp') && (access || refresh);
    const expiry = token?.expiry ? Date.parse(token.expiry) : null;
    return { present, usable: present && (refresh || (access && (expiry === null || expiry > now))) };
  } catch { return { present: false, usable: false }; }
}

function agyKeychain(): Promise<string | null> {
  if (process.platform !== 'darwin') return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile('/usr/bin/security', ['find-generic-password', '-s', 'gemini', '-a', 'antigravity', '-w'],
      { encoding: 'utf8', timeout: 2_000, maxBuffer: 64 * 1024 }, (error, stdout) => {
        resolve(error ? null : stdout.trim() || null);
      });
  });
}

const stores: LoginStores = {
  keychain: agyKeychain,
  file: () => readFile(join(homedir(), '.gemini', 'antigravity-cli', 'antigravity-oauth-token'), 'utf8').catch(() => null),
};

export async function geminiAuth(source: LoginStores = stores): Promise<Login> {
  // Match agy's keyring-first selection. A stale legacy file must not override the active
  // Keychain account, including when that account's token needs reconnection.
  const raw = await source.keychain().catch(() => null) || await source.file().catch(() => null) || '';
  return geminiLogin(raw);
}
