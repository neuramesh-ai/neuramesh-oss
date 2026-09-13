// THE OS KEYCHAIN — where a secret this app minted lives (doctrine §5: keys live in the keychain).
//
// Local mode's `nmh_` human bearer is the first tenant: minted once per install, handed to the
// stack only as a hash, and never written to disk in the clear. The provider keys the agents
// use are the control-api's (credential.set) or the runtimes' own logins (detect.ts reads Claude
// Code's Keychain item), so until now the app never WROTE a keychain entry of its own — this is
// that writer, on the same `security` CLI detect.ts already reads with.
//
// Pure around an injected spawn so the argument shape is testable without touching a Keychain.
import { spawn as nodeSpawn } from 'node:child_process';

export interface Keychain {
  get(account: string): Promise<string | null>;
  set(account: string, secret: string): Promise<void>;
  delete(account: string): Promise<void>;
}

/** the one service name every NeuraMesh item is filed under */
export const KEYCHAIN_SERVICE = 'NeuraMesh';

export type Spawn = (bin: string, args: string[]) => { stdout: NodeJS.ReadableStream | null; stderr: NodeJS.ReadableStream | null; on: (ev: 'close' | 'error', cb: (v: number | Error) => void) => unknown };

const run = (spawn: Spawn, args: string[]): Promise<{ code: number; out: string; err: string }> =>
  new Promise((res) => {
    const p = spawn('security', args);
    let out = '';
    let err = '';
    p.stdout?.on('data', (d: Buffer) => { out += d.toString(); });
    p.stderr?.on('data', (d: Buffer) => { err += d.toString(); });
    p.on('close', (code) => res({ code: typeof code === 'number' ? code : 1, out, err }));
    p.on('error', () => res({ code: 1, out, err: 'security not found' }));
  });

/** the macOS Keychain through `security` — the same binary detect.ts reads Claude Code's login with */
export function macKeychain(spawn: Spawn = nodeSpawn as unknown as Spawn, service = KEYCHAIN_SERVICE): Keychain {
  return {
    async get(account) {
      const r = await run(spawn, ['find-generic-password', '-s', service, '-a', account, '-w']);
      return r.code === 0 && r.out.trim() ? r.out.trim() : null;
    },
    async set(account, secret) {
      // -U updates in place, so a re-mint never leaves two items behind
      const r = await run(spawn, ['add-generic-password', '-U', '-s', service, '-a', account, '-w', secret]);
      if (r.code !== 0) throw new Error(`keychain write failed (${r.code}): ${r.err.trim().slice(0, 120)}`);
    },
    async delete(account) {
      await run(spawn, ['delete-generic-password', '-s', service, '-a', account]);
    },
  };
}

/** an in-memory keychain — tests, and a platform with no `security` (Local mode is macOS-first) */
export function memoryKeychain(seed: Record<string, string> = {}): Keychain {
  const m = new Map(Object.entries(seed));
  return {
    async get(account) { return m.get(account) ?? null; },
    async set(account, secret) { m.set(account, secret); },
    async delete(account) { m.delete(account); },
  };
}

export const systemKeychain = (): Keychain => (process.platform === 'darwin' ? macKeychain() : memoryKeychain());
