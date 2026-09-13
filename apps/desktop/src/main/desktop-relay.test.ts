// The desktop Code bridge's composition (renderer/src/bridge/desktop-relay.ts): it attaches exactly
// the engineering keys onto the desktop bridge, never a terminal one, never over a method the
// desktop already has, and only when main names a relay.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attachDesktopRelay, codeBridge, composeLanes, RELAY_KEYS } from '../renderer/src/bridge/desktop-relay';
import type { NMBridge } from '../renderer/src/bridge/nm';
import type { RelayEnv } from '../renderer/web/webnm-relay';

type Fake = Partial<NMBridge> & Record<string, unknown>;

function desktop(relayUrl: string, extra: Record<string, unknown> = {}): Fake {
  return {
    relayEnv: async () => ({ relayUrl, apiUrl: 'http://api.test', workspaceId: 'w1' }),
    relayHeaders: async () => ({ 'x-nm-actor': '{"kind":"human","id":"u1"}' }),
    relayBearer: async () => 'dev-token',
    // the desktop's own terminal lane — main's ptys — must survive the composition untouched
    terminalInfo: async () => ({ available: true, cwd: '/home' }),
    openTerminal: () => ({ subId: 'local', write: () => {}, resize: () => {}, close: () => {} }),
    ...extra,
  } as unknown as Fake;
}

/** a lane that reports what it was built with, offering every key the relay bridge offers */
function lane(seen: { env?: RelayEnv; url?: string }) {
  return (env: RelayEnv, url: string): Partial<NMBridge> => {
    seen.env = env; seen.url = url;
    return {
      engineeringInfo: async () => ({ available: true }),
      openEngineering: () => ({ subId: 'x', send: async () => {}, close: () => {} }),
      machineEnsure: async () => ({ ok: true }),
      terminalInfo: async () => ({ available: true, cwd: null }),
    } as unknown as Partial<NMBridge>;
  };
}

test('attaches exactly the engineering keys — and never a terminal one', async () => {
  const nm = desktop('ws://relay.test');
  const before = nm['terminalInfo'];
  const seen: { env?: RelayEnv; url?: string } = {};
  const out = await attachDesktopRelay(nm as NMBridge, lane(seen));
  assert.deepEqual(out, { attached: ['engineeringInfo', 'openEngineering'], relayUrl: 'ws://relay.test', local: null });
  assert.equal(typeof nm['engineeringInfo'], 'function');
  assert.equal(nm['terminalInfo'], before, 'the desktop keeps its own terminals');
  assert.equal(seen.url, 'ws://relay.test');
  assert.deepEqual([...RELAY_KEYS], ['engineeringInfo', 'openEngineering'], 'machineEnsure is never composed: its presence means "the browser"');
});

test('no relay named by main and no local host → nothing attaches, and the result says so', async () => {
  const nm = desktop('');
  const out = await attachDesktopRelay(nm as NMBridge, lane({}));
  assert.deepEqual(out, { attached: [], relayUrl: '', local: null });
  assert.equal(nm['engineeringInfo'], undefined);
});

test('a bridge without relay facts (the web, the harness) is left alone', async () => {
  const out = await attachDesktopRelay({} as NMBridge, lane({}));
  assert.deepEqual(out, { attached: [], relayUrl: '', local: null });
  assert.deepEqual(await attachDesktopRelay(undefined, lane({})), { attached: [], relayUrl: '', local: null });
});

test('a method the desktop already has is never replaced', async () => {
  const own = async () => ({ available: true as const });
  const nm = desktop('ws://relay.test', { engineeringInfo: own });
  const out = await attachDesktopRelay(nm as NMBridge, lane({}));
  assert.deepEqual(out.attached, ['openEngineering']);
  assert.equal(nm['engineeringInfo'], own);
});

test('a FROZEN bridge (the contextBridge proxy) still gets its lane: composed in module state, read through codeBridge()', async () => {
  const nm = Object.freeze(desktop('ws://relay.test')) as unknown as NMBridge;
  const out = await attachDesktopRelay(nm, lane({}));
  assert.deepEqual(out.attached, ['engineeringInfo', 'openEngineering']);
  assert.equal((nm as unknown as Record<string, unknown>)['engineeringInfo'], undefined, 'the frozen object refused the key');
  const code = codeBridge();
  assert.equal(typeof code?.engineeringInfo, 'function');
  assert.deepEqual(await code!.engineeringInfo!(), { available: true });
});

test('the env hands main\'s headers and bearer through, and re-reads the workspace on every authenticated call', async () => {
  let ws = 'w1';
  const nm = desktop('ws://relay.test', { relayEnv: async () => ({ relayUrl: 'ws://relay.test', apiUrl: 'http://api.test', workspaceId: ws }) });
  const seen: { env?: RelayEnv; url?: string } = {};
  await attachDesktopRelay(nm as NMBridge, lane(seen));
  const env = seen.env!;
  assert.equal(env.apiUrl, 'http://api.test');
  assert.equal(env.workspaceId(), 'w1');
  assert.deepEqual(await env.authHeaders(), { 'x-nm-actor': '{"kind":"human","id":"u1"}' });
  assert.equal(await env.relayBearer(), 'dev-token');
  ws = 'w2';
  await env.authHeaders();
  assert.equal(env.workspaceId(), 'w2', 'the workspace you switched to, not the one you booted into');
});

// ── the LOCAL lane (slice B1) and the routing between the two ───────────────────────────────
type Meta = Parameters<NonNullable<NMBridge['openEngineering']>>[0];
const meta = (machineId?: string | null): Meta => ({ threadId: 't', repoId: 'r', repoName: 'app', branch: 'main', mode: 'plan', permissions: { read: true, edit: false, command: false, web: false, mcp: false }, ...(machineId === undefined ? {} : { machineId }) } as unknown as Meta);
function fakeLane(name: string, log: string[]): Lane {
  return {
    engineeringInfo: async () => ({ available: name === 'relay-ok', ...(name === 'relay-none' ? { reason: 'No cloud machine is available for this workspace yet.' } : {}) }),
    openEngineering: (m: Meta) => { log.push(`${name}:${(m as { machineId?: string | null }).machineId ?? '-'}`); return { subId: name, send: async () => {}, close: () => {} }; },
    machineEnsure: async () => ({ ok: true as const }),
  } as unknown as Lane;
}
type Lane = Pick<NMBridge, 'engineeringInfo' | 'openEngineering' | 'machineEnsure'>;
/** the app's own host as the composition sees it: asked when asked, and answering with this Mac's id */
function fakeLocal(log: string[], answer: { available: boolean; reason?: string; machineId: string | null } = { available: true, machineId: 'm-here' }, failFirst = 0) {
  let calls = 0;
  return {
    info: async () => { if (calls++ < failFirst) throw new Error("No handler registered for 'nm:engineering-local-info'"); return { ...answer, machineName: 'george-mac' }; },
    open: (m: Meta) => { log.push(`local:${(m as { machineId?: string | null }).machineId ?? '-'}`); return { subId: 'local', send: async () => {}, close: () => {} }; },
  };
}

test('local only (a dev stack with no relay): Code is available, and every session runs here', async () => {
  const log: string[] = [];
  const lane = composeLanes(null, fakeLocal(log));
  assert.deepEqual(await lane.engineeringInfo!(), { available: true });
  lane.openEngineering!(meta(), () => {}, () => {});
  lane.openEngineering!(meta('m-cloud'), () => {}, () => {}); // nowhere else to go
  assert.deepEqual(log, ['local:-', 'local:m-cloud']);
});

test('relay only: the browser\'s behaviour, unchanged', async () => {
  const log: string[] = [];
  const lane = composeLanes(fakeLane('relay-none', log), null);
  assert.deepEqual(await lane.engineeringInfo!(), { available: false, reason: 'No cloud machine is available for this workspace yet.' });
  lane.openEngineering!(meta('m-cloud'), () => {}, () => {});
  assert.deepEqual(log, ['relay-none:-'], 'the client-side choice is stripped: the attach frame names the machine');
});

test('both lanes: this Mac\'s id routes here, anything else — and the default — dials the relay', async () => {
  const log: string[] = [];
  const lane = composeLanes(fakeLane('relay-ok', log), fakeLocal(log));
  assert.deepEqual(await lane.engineeringInfo!(), { available: true }, 'a host on this Mac makes Code available whatever the fleet says');
  lane.openEngineering!(meta('m-here'), () => {}, () => {});
  lane.openEngineering!(meta('m-cloud'), () => {}, () => {});
  lane.openEngineering!(meta(), () => {}, () => {});
  assert.deepEqual(log, ['local:m-here', 'relay-ok:-', 'relay-ok:-']);
});

test('the desktop bridge attaches the composed lanes and reports the local machine', async () => {
  const nm = desktop('ws://relay.test', {
    engineeringLocalInfo: async () => ({ available: true, machineId: 'm-here', machineName: 'george-mac' }),
    openEngineeringLocal: () => ({ subId: 'local', send: async () => {}, close: () => {} }),
  });
  const out = await attachDesktopRelay(nm as NMBridge, lane({}));
  assert.deepEqual(out, { attached: ['engineeringInfo', 'openEngineering'], relayUrl: 'ws://relay.test', local: 'this-mac' });
  const noRuntime = desktop('', { engineeringLocalInfo: async () => ({ available: false, reason: 'no runtime', machineId: 'm-here', machineName: 'george-mac' }), openEngineeringLocal: () => ({ subId: 'x', send: async () => {}, close: () => {} }) });
  // the lane is the CAPABILITY; a host that cannot load the runtime says so when Code asks
  assert.deepEqual(await attachDesktopRelay(noRuntime as NMBridge, lane({})), { attached: ['engineeringInfo', 'openEngineering'], relayUrl: '', local: 'this-mac' });
  assert.deepEqual(await codeBridge()!.engineeringInfo!(), { available: false, reason: 'no runtime' });
});

test('the local host is asked when Code asks, never at boot: a cold sign-in keeps This Mac (v0.122.0 draft check)', async () => {
  // before sign-in the IPC is not registered yet and the call throws; after sync starts it answers
  const log: string[] = [];
  const lane = composeLanes(fakeLane('relay-ok', log), fakeLocal(log, { available: true, machineId: 'm-here' }, 1));
  assert.deepEqual(await lane.engineeringInfo!(), { available: true }, 'the relay answered while the host was not up');
  lane.openEngineering!(meta('m-here'), () => {}, () => {});
  assert.deepEqual(log, ['relay-ok:-'], 'this Mac was not known yet, so the id could only dial the relay');
  assert.deepEqual(await lane.engineeringInfo!(), { available: true });
  lane.openEngineering!(meta('m-here'), () => {}, () => {});
  assert.deepEqual(log.at(-1), 'local:m-here', 'once the host answered, this Mac routes here');
});
