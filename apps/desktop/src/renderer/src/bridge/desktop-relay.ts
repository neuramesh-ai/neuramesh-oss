// THE DESKTOP CODE BRIDGE (2026-09-04, George: "users who download the desktop app, while having
// a cloud machine, can't code but can run chat threads on their machine").
//
// Code (the Engineering OS) reaches a machine through nm-relay, and until today only the browser
// client dialled it. The desktop composes TWO lanes onto the same bridge methods:
//   · the RELAY lane — the browser's own relay bridge, built from three facts main answers over
//     IPC (the relay URL, the /v1 auth headers, the relay attach credential); one implementation,
//     one protocol, one set of traps (docs/42);
//   · the LOCAL lane (slice B1) — the app's own engineering host, in process, no relay in the path.
// A session names its machine (`meta.machineId`): this Mac's id routes to the local lane, anything
// else to the relay, and the default is the relay where one exists (the browser's behaviour) and
// this Mac otherwise. Only the two Code keys are composed: the desktop is a machine, its terminals
// are its own and stay local — and `machineEnsure` stays off it on purpose, because the app reads
// that method's mere PRESENCE as "this is the browser" (compute/NeedsMachine.tsx).
//
// THE BRIDGE IS FROZEN. `window.nm` is a contextBridge proxy: a new key assigned to it is refused
// (silently, or as a TypeError under strict mode), which is how the first build of this lane
// composed everything and attached nothing. So the composed lane lives HERE, in renderer module
// state, and `codeBridge()` is what the runtime hook reads — the bridge itself on the web, where
// the methods are its own, and the composition on the desktop.
// Plan: docs/design/desktop-code-bridge-2026-09/plan.md.
import { relayOverrides as defaultOverrides, type RelayEnv } from '../../web/webnm-relay';
import { nm, type NMBridge } from './nm';

/** the keys the Code lanes compose — never a terminal one, never machineEnsure */
export const RELAY_KEYS = ['engineeringInfo', 'openEngineering'] as const;
export type RelayKey = (typeof RELAY_KEYS)[number];

export interface DesktopRelayResult { attached: RelayKey[]; relayUrl: string; local: string | null }

export type CodeLane = Pick<NMBridge, 'engineeringInfo' | 'openEngineering'>;
type Lane = CodeLane & Pick<NMBridge, 'machineEnsure'>;
/** the app's own host, asked WHEN ASKED: its IPC exists only once sync runs, so its answer is read
 *  at engineeringInfo time (the Code view mounting, after sign-in) and never at boot */
export interface LocalLane {
  info: NonNullable<NMBridge['engineeringLocalInfo']>;
  open: NonNullable<NMBridge['openEngineeringLocal']>;
}

let composed: CodeLane | null = null;
/** the Code methods to call: the composition on the desktop, the bridge's own on the web */
export function codeBridge(): CodeLane | undefined { return composed ?? nm; }

/** the two lanes composed into one: the routing rule, pure and tested.
 *
 *  THE LOCAL HOST IS ASKED LATE. On a cold sign-in the app boots to the Clerk screen and its
 *  engineering IPC is registered only when sync starts afterwards — so a boot-time read answered
 *  "no host" and Code on This Mac stayed dark for the whole session (found booting the v0.122.0
 *  draft on a fresh profile, 2026-09-05). The dev instance never showed it: dev auth starts sync
 *  at boot. Now `engineeringInfo` asks the host each time it is called — the Code view calls it
 *  on mount, after sign-in — and remembers the answer (availability, this Mac's id) for the
 *  routing `openEngineering` does synchronously. */
export function composeLanes(relay: Lane | null, local: LocalLane | null): Lane {
  let known: { available: boolean; machineId: string | null } | null = null;
  const pick = (machineId: string | null | undefined): 'local' | 'relay' | null => {
    const here = !!local && !!known?.available;
    if (!relay && !here) return local ? 'local' : null;
    if (here && (!relay || (machineId != null && machineId === known!.machineId))) return 'local';
    return relay ? 'relay' : 'local';
  };
  return {
    // a host on this Mac makes Code available whatever the fleet says; without one, the relay answers
    engineeringInfo: async () => {
      const li = local ? await local.info().catch(() => null) : null;
      known = li ? { available: li.available, machineId: li.machineId } : null;
      if (li?.available) return { available: true };
      if (relay) return relay.engineeringInfo!();
      return { available: false, reason: li?.reason ?? 'Code needs a machine: this Mac has no host yet and no cloud machine is reachable.' };
    },
    openEngineering: (meta, onEvent, onExit) => {
      const lane = pick(meta.machineId);
      if (lane === 'local') return local!.open(meta, onEvent, onExit);
      // the relay's attach frame names the machine; the client-side choice does not travel
      const { machineId: _machine, ...rest } = meta;
      return relay!.openEngineering!(rest, onEvent, onExit);
    },
    machineEnsure: relay?.machineEnsure ?? (async () => ({ ok: true as const })),
  };
}

/** compose the Code lanes onto the desktop bridge. Idempotent about what the bridge already has:
 *  a method the desktop implements itself (machineEnsure, through main) is never replaced. */
export async function attachDesktopRelay(
  nm: NMBridge | undefined,
  overrides: (env: RelayEnv, relayUrl: string) => Partial<NMBridge> = defaultOverrides,
): Promise<DesktopRelayResult> {
  if (!nm?.relayEnv) return { attached: [], relayUrl: '', local: null };
  const first = await nm.relayEnv();
  let relay: Lane | null = null;
  if (first.relayUrl) {
    // the workspace can change under a running app; every authenticated read re-asks main, so
    // the next usage read names the workspace you are standing in, not the one you booted into
    let workspaceId = first.workspaceId;
    const env: RelayEnv = {
      apiUrl: first.apiUrl,
      workspaceId: () => workspaceId,
      authHeaders: async () => {
        const [fresh, headers] = await Promise.all([nm.relayEnv!(), nm.relayHeaders?.() ?? Promise.resolve({})]);
        workspaceId = fresh.workspaceId;
        return headers;
      },
      relayBearer: () => nm.relayBearer?.() ?? Promise.resolve(null),
    };
    relay = overrides(env, first.relayUrl) as Lane;
  }
  // the local lane is the CAPABILITY, not a boot-time answer: its IPC is asked when Code asks
  const local: LocalLane | null = nm.engineeringLocalInfo && nm.openEngineeringLocal
    ? { info: () => nm.engineeringLocalInfo!(), open: (meta, onEvent, onExit) => nm.openEngineeringLocal!(meta, onEvent, onExit) }
    : null;
  if (!relay && !local) return { attached: [], relayUrl: first.relayUrl, local: null };
  const lane = composeLanes(relay, local);
  const attached: RelayKey[] = [];
  const target = nm as unknown as Record<string, unknown>;
  const picked: Partial<CodeLane> = {};
  for (const key of RELAY_KEYS) {
    if (!lane[key] || target[key]) continue;
    attached.push(key);
    (picked as Record<string, unknown>)[key] = lane[key];
    try { target[key] = lane[key]; } catch { /* the frozen bridge: the composition is read from here instead */ }
  }
  if (attached.length) composed = { ...picked };
  return { attached, relayUrl: first.relayUrl, local: local ? 'this-mac' : null };
}
