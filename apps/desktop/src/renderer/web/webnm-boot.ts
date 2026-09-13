// the boot-critical bridge arms (web parity ledger: boot = L1 watches + THREE L2 calls —
// authStatus, workspaceSettings, bootstrap; everything L3/L4 in the path tolerates absence).
// each port names its desktop source so drift has an address.

/// <reference types="vite/client" />
import { authHeaders, postCommand, type WebNmConfig } from './webnm';
import { applyBootRoute, switchTo } from './slugroute';

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

async function myWorkspaces(cfg: WebNmConfig): Promise<WorkspaceRow[]> {
  const body = (await apiGet(cfg, '/v1/workspaces')) as { workspaces?: WorkspaceRow[] };
  return body.workspaces ?? [];
}

/** the slice-1 boot arms, layered over the warn-once proxy */
export function bootOverrides(cfg: WebNmConfig): Record<string, unknown> {
  return {
    // shape-holding answers for calls whose consumers member-read unconditionally at mount (the
    // .agents/.phase crash class). L3 processList stays empty until the relay lane. The room,
    // project and activity lanes are NO LONGER STUBS — they read the replica in webnm-rooms.ts,
    // which is layered after this one.
    processList: async () => ({ agents: [], terminals: [] }),

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
      const w = (await myWorkspaces(cfg)).find((x) => x.id === cfg.workspaceId());
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
      const ws = (await myWorkspaces(cfg)).find((w) => w.id === workspaceId);
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

    // ported from sync.ts nm:bootstrap — the web derives what the desktop boot resolved:
    // memberships from /v1/workspaces, invites from /v1/invites/mine, the active workspace
    // from the stored choice (else the first membership).
    bootstrap: async () => {
      const workspaces = await myWorkspaces(cfg);
      const invites = ((await apiGet(cfg, '/v1/invites/mine').catch(() => ({}))) as { invites?: unknown[] }).invites ?? [];
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
        workspaces,
        invites,
      };
    },
  };
}
