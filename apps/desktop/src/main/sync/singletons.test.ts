// THE SINGLETONS ARE GONE — a source contract, so they cannot come back one `let` at a time.
//
// `WS`, `API_URL`, `POWERSYNC_URL`, `activeDb`, `session` and a load-time `AUTH_MODE` read were
// the one-backend assumption written into sync.ts. Local mode (connections.ts) makes the backend a
// list, so every read is a getter on the foreground connection. This reads the sources the way
// mock-drift.test.ts reads the bridge: a handler module that takes a `WS: string` again would
// capture one workspace at boot and answer for it forever after a swap.
//   pnpm exec tsx --test src/main/sync/singletons.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MAIN = join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(join(MAIN, p), 'utf8');
const ipcFiles = () => readdirSync(join(MAIN, 'sync', 'ipc')).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));

test('sync.ts exports no reassignable backend singleton', () => {
  const src = read('sync.ts');
  for (const name of ['WS', 'API_URL', 'POWERSYNC_URL', 'activeDb', 'session', 'wsInfo', 'needsOnboarding'])
    assert.ok(!new RegExp(`^(export )?let ${name}\\b`, 'm').test(src), `sync.ts still holds \`let ${name}\``);
  assert.ok(/export const ws = \(\): string => cur\(\)\.ws;/.test(src), 'ws() reads the foreground connection');
  assert.ok(/export const apiUrl = \(\): string => cur\(\)\.apiUrl;/.test(src), 'apiUrl() reads the foreground connection');
});

test('every IPC module takes the workspace and the replica as GETTERS, never as captured values', () => {
  for (const f of ipcFiles()) {
    const src = read(join('sync', 'ipc', f));
    assert.ok(!/\bWS: string;/.test(src), `${f} still declares WS: string`);
    assert.ok(!/\bdb: PowerSyncDatabase;/.test(src), `${f} still declares db: PowerSyncDatabase`);
    assert.ok(!/\{ db: PowerSyncDatabase \}/.test(src), `${f} still takes a captured db`);
    // no module imports a workspace or url VALUE from sync — only functions
    const imp = /import \{([^}]*)\} from '\.\.\/\.\.\/sync';/.exec(src)?.[1] ?? '';
    for (const bad of ['WS', 'API_URL', 'activeDb']) assert.ok(!imp.split(',').map((s) => s.trim()).includes(bad), `${f} imports ${bad} from sync`);
  }
});

test('AUTH_MODE is read per api url, and the only load-time read is the environment fallback', () => {
  const api = read('apiauth.ts');
  assert.ok(/export function authModeFor\(apiUrl: string\)/.test(api), 'authModeFor exists');
  assert.ok(/connections\.byApiUrl\(apiUrl\)\?\.authMode \?\? AUTH_MODE/.test(api), 'the connection decides, the environment is the fallback');
  for (const f of ['sync.ts', 'index.ts', 'relayipc.ts', 'sync/boot.ts', 'sync/connector.ts']) {
    const src = read(f);
    assert.ok(!/\bAUTH_MODE\b/.test(src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')), `${f} still reads the process-wide AUTH_MODE`);
  }
});

test('the agent host is guarded per (backend, workspace), not per process', () => {
  const src = read('agents.ts');
  assert.ok(!/^let hostStarted = false;/m.test(src));
  assert.ok(/const hostsStarted = new Set<string>\(\);/.test(src));
  assert.ok(/const hostKey = `\$\{apiUrl\}\|\$\{workspace\}`;/.test(src));
});
