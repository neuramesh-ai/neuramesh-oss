// the boot-critical bridge arms (web parity ledger: boot = L1 watches + THREE L2 calls —
// authStatus, workspaceSettings, bootstrap; everything L3/L4 in the path tolerates absence).
// each port names its desktop source so drift has an address.

/// <reference types="vite/client" />
import type { NMBridge } from '../src/bridge/nm';
import type { PendingInvite, WorkspaceMembership } from '../src/bridge/rows-crew';
import { authHeaders, commandsPosted, postCommand, type WebNmConfig } from './webnm';
import { applyBootRoute, switchTo } from './slugroute';
import { keepIdentity } from './webnm-watch';

const NO_PROCESSES = { agents: [], terminals: [] };

interface WorkspaceRow {
  id: string;
  name?: string;
  slug?: string;
  autoFailover?: boolean;
  activeModelPack?: string;
  commRules?: unknown;
  plan?: string;
  seats?: number;
  subscriptionStatus?: string | null;
  currentPeriodEnd?: string | null;
  primaryMachineId?: string | null;
  /** false = exists but never finished the wizard (see the boot rule in wsident.ts) */
  onboarded?: boolean;
}

async function apiGet(cfg: WebNmConfig, path: string): Promise<unknown> {
  const headers = await authHeaders(cfg);
  // signed out: a gated read can only answer 401, so it is not sent (the callers catch and default)
  if (!Object.keys(headers).length) throw new Error(`${path}: signed out`);
  const res = await fetch(`${cfg.apiUrl}${path}`, { headers });
  if (!res.ok) throw new Error(`${path} failed ${res.status}`);
  return res.json();
}

/**
 * How long one server answer about memberships stands. App polls bootstrap every 1.5 s — cheap
 * IPC on the desktop, but two HTTP reads per poll here: 80 requests a minute from every open tab,
 * and a new object each time, which re-rendered the whole shell at idle. A command this page
 * posts, and the tab coming back into view, both end the wait early, so only a change made
 * somewhere else waits out the window.
 */
const BOOT_FRESH_MS = 15_000;

/** the last membership list this browser got, per person. A reload paints from it while the
 *  server is asked, the way the desktop boots on its last-synced identity (docs/09 §5). */
const seenKey = (cfg: WebNmConfig) => `nm:web:boot:${cfg.actorId() || 'anon'}`;
function readSeen(cfg: WebNmConfig): WorkspaceRow[] | null {
  try {
    const raw = localStorage.getItem(seenKey(cfg));
    return raw ? (JSON.parse(raw) as WorkspaceRow[]) : null;
  } catch { return null; }
}
function writeSeen(cfg: WebNmConfig, rows: WorkspaceRow[]): void {
  try { localStorage.setItem(seenKey(cfg), JSON.stringify(rows)); } catch { /* private mode: every boot asks the server */ }
}

type BootAnswer = Awaited<ReturnType<NMBridge['bootstrap']>>;

/** the web derives what the desktop boot resolved: memberships, invites, and the active workspace
 *  from the url, else the stored choice, else the first membership */
function bootAnswer(cfg: WebNmConfig, workspaces: WorkspaceRow[], invites: unknown[]): BootAnswer {
  // the url picks the workspace (slugroute.ts): /<slug> when the member belongs to it,
  // otherwise the one they were last in — and the address bar is corrected either way, so
  // what the browser shows is always the workspace actually open.
  const routed = applyBootRoute(workspaces.filter((w): w is typeof w & { slug: string } => !!w.slug).map((w) => ({ id: w.id, slug: w.slug! })));
  const active = workspaces.find((w) => w.id === routed?.id) ?? workspaces.find((w) => w.id === cfg.workspaceId()) ?? workspaces[0];
  // HAVING a workspace is not FINISHING one. The browser mints its workspace at the wizard's
  // first step — the cloud machine is provisioned against that id — so `length === 0` stopped
  // being the right question the moment that changed: refreshing at the brain step left a
  // real, empty workspace and dropped the user into an app with no crew and no rooms.
  // `onboarded === false` is the only value that resumes; undefined means a server that does
  // not answer the question, and guessing there would eject a working user.
  const unfinished = active && active.onboarded === false ? active : null;
  return {
    needsOnboarding: workspaces.length === 0 || !!unfinished,
    resumeWorkspaceId: unfinished?.id,
    machineName: 'browser',
    workspace: { name: active?.name ?? '', slug: active?.slug ?? '' },
    workspaceId: active?.id,
    workspaces: workspaces as WorkspaceMembership[],
    invites: invites as PendingInvite[],
  } as BootAnswer;
}

/** the slice-1 boot arms, layered over the warn-once proxy */
export function bootOverrides(cfg: WebNmConfig): Record<string, unknown> {
  // one /v1/workspaces read in flight at a time, shared by every lane that asks for it
  let wsInflight: Promise<WorkspaceRow[]> | null = null;
  let wsLast: { at: number; rows: WorkspaceRow[] } | null = null;
  const myWorkspaces = (maxAgeMs = 0): Promise<WorkspaceRow[]> => {
    if (wsLast && Date.now() - wsLast.at < maxAgeMs) return Promise.resolve(wsLast.rows);
    wsInflight ??= apiGet(cfg, '/v1/workspaces')
      .then((body) => {
        const rows = (body as { workspaces?: WorkspaceRow[] }).workspaces ?? [];
        wsLast = { at: Date.now(), rows };
        return rows;
      })
      .finally(() => { wsInflight = null; });
    return wsInflight;
  };

  // bootstrap's answer: the server's, once it has spoken in this page — until then the last one
  // this browser saw. `answeredAt` = when the server last answered, `epoch` = the command count then.
  let current: BootAnswer | null = null;
  let answeredAt = 0;
  let epoch = -1;
  let refreshing: Promise<BootAnswer> | null = null;
  const stable = keepIdentity(async (a: BootAnswer) => a);
  const refresh = (): Promise<BootAnswer> => {
    refreshing ??= (async () => {
      const startEpoch = commandsPosted();
      const [workspaces, invites] = await Promise.all([
        myWorkspaces(),
        apiGet(cfg, '/v1/invites/mine').then((b) => (b as { invites?: unknown[] }).invites ?? []).catch(() => [] as unknown[]),
      ]);
      writeSeen(cfg, workspaces);
      current = await stable(bootAnswer(cfg, workspaces, invites));
      answeredAt = Date.now();
      epoch = startEpoch;
      return current;
    })().finally(() => { refreshing = null; });
    return refreshing;
  };
  // back in view: the next poll asks the server rather than trusting the window
  const stale = () => { answeredAt = 0; };
  window.addEventListener('focus', stale);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') stale(); });

  return {
    // shape-holding answers for calls whose consumers member-read unconditionally at mount (the
    // .agents/.phase crash class). L3 processList stays empty until the relay lane. The room,
    // project and activity lanes are NO LONGER STUBS — they read the replica in webnm-rooms.ts,
    // which is layered after this one. ONE object: App polls this every 3 s into state.
    processList: async () => NO_PROCESSES,

    // machineLimitInfo, terminalInfo and the rest of the machine-local refusals moved to
    // webnm-local.ts — they share one reason, and splitting them is how they drifted.

    // ported from main/update.ts's consumer contract (rows-infra UpdateState): the web
    // client has no self-updater — it is always the deployed version. 'idle' forever.
    updateState: async () => ({ phase: 'idle' as const }),
    onUpdate: () => () => {},

    // the auth gate (App.tsx:1166). clerk is the web's real mode; VITE_NM_DEV_USER is the
    // LOCAL-STACK escape hatch (the mobile app's NM_AUTH=dev lane, same idea): it names a
    // seeded user uuid so boot proceeds without clerk, and authHeaders then falls through to
    // x-nm-actor — which only a dev control-api accepts (prod runs NM_ALLOW_ACTOR_HEADER=0).
    // it is a build-time env, so it cannot exist in a production bundle.
    authStatus: async () => {
      const devUser = import.meta.env['VITE_NM_DEV_USER'] as string | undefined;
      if (devUser) return { mode: 'dev' as const, user: { id: devUser, email: 'dev@local' } };
      const raw = localStorage.getItem('nm:web:user');
      const user = raw ? (JSON.parse(raw) as { id: string; email: string }) : null;
      return { mode: 'clerk' as const, user };
    },

    // ported from sync/ipc/settings.ts nm:workspace-settings — same /v1/workspaces read,
    // same defaults, issued from the page.
    workspaceSettings: async () => {
      const w = (await myWorkspaces(BOOT_FRESH_MS)).find((x) => x.id === cfg.workspaceId());
      return {
        autoFailover: !!w?.autoFailover,
        activeModelPack: w?.activeModelPack ?? 'custom',
        commRules: w?.commRules ?? null,
        plan: w?.plan ?? 'free',
        seats: w?.seats ?? 1,
        subscriptionStatus: w?.subscriptionStatus ?? null,
        currentPeriodEnd: w?.currentPeriodEnd ?? null,
        primaryMachineId: w?.primaryMachineId ?? null,
      };
    },

    // ported from sync/ipc/settings.ts nm:usage — the nav foot's credit ring, same /v1/usage
    // read. Same absence contract: null when the deployment doesn't serve credits (501) or the
    // read fails, so the ring draws nothing instead of a full ring built on a failed fetch.
    usage: async () => apiGet(cfg, `/v1/usage?workspace=${encodeURIComponent(cfg.workspaceId())}`).catch(() => null),

    // a browser has no disk to probe for vendor CLIs, so this answers honestly rather than
    // leaving the wizard's probe unsettled: nothing is installed HERE. subscriptions are
    // signed into on the cloud machine after launch (the Keys step says so).
    detectProviders: async () => ({
      anthropic: { installed: false, authed: false, method: null },
      openai: { installed: false, authed: false, method: null },
      gemini: { installed: false, authed: false, method: null },
    }),

    // switching is a URL change here, not the desktop's relaunch — the reload rebinds the
    // replica the same way and leaves a shareable address behind (ledger red flag 7).
    switchWorkspace: async (workspaceId: string) => {
      const ws = (await myWorkspaces()).find((w) => w.id === workspaceId);
      if (!ws?.slug) throw new Error('unknown workspace');
      switchTo({ id: ws.id, slug: ws.slug });
      return { ok: true as const, switching: true as const };
    },

    // the browser wizard's first step: create the workspace ALONE. the id it returns is what
    // the fleet provisions the workspace's cloud machine against (FLEET_AUTOPROVISION), which
    // is the whole reason the browser order leads with Workspace instead of Machine.
    workspaceCreate: async (input: { name: string; slug: string }) => {
      const res = (await postCommand(cfg, { type: 'workspace.create', name: input.name, slug: input.slug })) as { workspaceId?: string };
      if (!res.workspaceId) throw new Error('workspace.create returned no id');
      localStorage.setItem('nm:web:workspaceId', res.workspaceId);
      return { workspaceId: res.workspaceId };
    },

    // ported from sync.ts nm:bootstrap (bootAnswer above holds the derivation). A RELOAD PAINTS
    // FROM THE REPLICA: the first call answers from the last membership list this browser saw and
    // asks the server behind it, so rows already on this machine are not held behind two round
    // trips — and an unreachable server keeps the app open on local data instead of the splash.
    // A browser that has never booted, or whose last answer was mid-wizard, still waits.
    bootstrap: async () => {
      if (!current) {
        const seen = readSeen(cfg);
        const early = seen ? bootAnswer(cfg, seen, []) : null;
        if (early && !early.needsOnboarding) {
          current = await stable(early);
          void refresh().catch(() => { /* the poll asks again */ });
          return current;
        }
        return refresh();
      }
      if (Date.now() - answeredAt < BOOT_FRESH_MS && epoch === commandsPosted()) return current;
      return refresh().catch((e: unknown) => {
        // offline or a blip: the answer this page already stands on stays standing
        if (current) return current;
        throw e;
      });
    },
  };
}
