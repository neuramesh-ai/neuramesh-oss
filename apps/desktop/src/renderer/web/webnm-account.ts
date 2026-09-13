// THE ACCOUNT LANES — who you are, which workspaces you belong to, what you pay, and the four
// capabilities that live on a MACHINE rather than in an account.
//
// Eighteen bridge methods, and they split cleanly in two:
//
//   HTTP — /v1/workspaces, /v1/invites, /v1/invites/mine, /v1/billing/*, /v1/commands and
//   /auth/clerk are the SAME routes the desktop's main process calls; the browser issues them
//   itself with the same bearer. Each port names the handler it came from so drift has an address.
//
//   REFUSALS — provider re-auth re-runs a vendor CLI, Claude Design edits ~/.claude's MCP config,
//   the MCP keys live in a file under userData that is deliberately never synced ("machine-local,
//   never on our server"), and a machine transfer re-registers THIS Mac as the primary and
//   relaunches. A tab has no CLI, no userData and is never the workspace's machine, so these get
//   named refusals — the webnm-local.ts doctrine, applied to the account surface.
//
// WHY REFUSE RATHER THAN LEAVE THEM UNWIRED: the fallback resolves an empty array-like, which is
// an OBJECT and therefore TRUTHY. `const { user } = await nm.login(...)` would have destructured
// a truthy proxy and signed the app in as nobody; `claudeDesignConnect` would have handed the
// card a launch object it then paints "Connected." over. Both are the machineLimitInfo bug in a
// new place: a lane that decides whether something renders must answer, not guess.
import type { PowerSyncDatabase } from '@powersync/web';
import type { CreditHistory, NMBridge } from '../src/bridge/nm';
import type { PendingInvite, WorkspaceMembership } from '../src/bridge/rows-crew';
import { authHeaders, postCommand, type WebNmConfig } from './webnm';

/** /v1/workspaces rows carry more than the switcher's shape — `onboarded` is the one extra field
 *  read here (see myInvites), and it is the SAME field bootstrap resolves onboarding against. */
type WorkspaceRow = WorkspaceMembership & { onboarded?: boolean };

/** the server's own words when it refuses, not just a status code: "billing not configured" and
 *  "no Stripe customer yet — subscribe first" are the two answers a human can act on. Mirrors
 *  postCommand's error extraction in webnm.ts, for the routes that are not /v1/commands. */
async function readErr(res: Response, path: string): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return String(body.error ?? `${path} failed ${res.status}`);
}

async function apiGet<T>(cfg: WebNmConfig, path: string): Promise<T> {
  const res = await fetch(`${cfg.apiUrl}${path}`, { headers: await authHeaders(cfg) });
  if (!res.ok) throw new Error(await readErr(res, path));
  return (await res.json()) as T;
}

async function apiPost<T>(cfg: WebNmConfig, path: string, body: unknown): Promise<T> {
  const res = await fetch(`${cfg.apiUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(await authHeaders(cfg)) },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readErr(res, path));
  return (await res.json()) as T;
}

async function myWorkspaces(cfg: WebNmConfig): Promise<WorkspaceRow[]> {
  return (await apiGet<{ workspaces?: WorkspaceRow[] }>(cfg, '/v1/workspaces')).workspaces ?? [];
}

/**
 * The desktop hands a hosted Stripe URL to `shell.openExternal`. The browser's own version of
 * that is a new tab — except a tab opened after an `await` can fall outside the click's transient
 * activation and be blocked, and a blocked popup would leave `{ ok: true }` describing a checkout
 * that never opened. So a blocked popup falls back to the CURRENT tab, which is how Stripe's own
 * client redirects anyway, and the human always ends up on the page they asked for.
 */
function openHosted(url: string): void {
  const opened = window.open(url, '_blank', 'noopener');
  if (!opened) location.assign(url);
}

async function billing(cfg: WebNmConfig, kind: 'checkout' | 'portal'): Promise<{ ok: boolean }> {
  const { url } = await apiPost<{ url?: string }>(cfg, `/v1/billing/${kind}`, { workspace: cfg.workspaceId() });
  if (url) openHosted(url);
  return { ok: !!url };
}

/** the lanes that are a real network call from the page — ported route for route */
function httpLanes(cfg: WebNmConfig): Partial<NMBridge> {
  return {
    // sync/ipc/settings.ts nm:machines-usage — today's meter plus the fleet's INTENT per machine.
    // A browser needs this exactly as much as the desktop does: `desired_replicas` is outside the
    // sync publication, so without it every surface has to fall back to "offline" and guess.
    machinesUsage: async () => {
      const res = await fetch(`${cfg.apiUrl}/v1/machines/usage?workspace=${encodeURIComponent(cfg.workspaceId())}`, { headers: await authHeaders(cfg) });
      // null is "we could not look", which the callers render differently from an empty day
      if (!res.ok) { console.warn(`[webnm] /v1/machines/usage failed ${res.status} — compute state will read unknown`); return null; }
      return res.json();
    },

    // the human's "start it anyway". The 409 is a REAL answer (capped), not a failure, so it is
    // parsed rather than thrown — the caller sends the person to the upgrade from it.
    machineWake: async () => {
      const res = await fetch(`${cfg.apiUrl}/v1/machines/wake`, {
        method: 'POST', headers: { 'content-type': 'application/json', ...(await authHeaders(cfg)) },
        body: JSON.stringify({ workspace: cfg.workspaceId() }),
      });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (res.ok) return { ok: true, woken: Number(body['woken'] ?? 0) };
      return { ok: false, capped: body['code'] === 'COMPUTE_CAPPED', error: String(body['error'] ?? `wake failed ${res.status}`) };
    },

    // sync/ipc/account.ts:32 — the same bare /v1/workspaces read. The delete dialog lists what
    // would be orphaned, so its rows are the gate: never answer this from a swallowed failure.
    accountBlockers: async () => apiGet(cfg, '/v1/workspaces'),

    // sync/ipc/account.ts:40. NOT EXERCISED against the live stack, on purpose — it deletes the
    // caller's account, and there is no undo to verify it with.
    accountDelete: async () => postCommand(cfg, { type: 'account.delete' }),

    // sync/ipc/membership.ts:55. The desktop serves this from its cached membership list so the
    // switcher renders offline; a browser has no such cache, so the read IS the list and a
    // failure throws — App.tsx's catch keeps the previous list, which is the same outcome.
    workspaces: async () => ({ active: cfg.workspaceId(), workspaces: await myWorkspaces(cfg) }),

    // sync/ipc/membership.ts:41 — including its `[]` on a non-OK response, which is the desktop's
    // contract (the return type has nowhere to carry an error). Faithful, but SAID OUT LOUD:
    // "we could not look" and "nobody is invited" render identically, and only the console
    // separates them.
    invites: async () => {
      const path = `/v1/invites?workspace=${encodeURIComponent(cfg.workspaceId())}`;
      const res = await fetch(`${cfg.apiUrl}${path}`, { headers: await authHeaders(cfg) });
      if (!res.ok) {
        console.warn(`[webnm] ${path} failed ${res.status} — the Members tab will show no pending invitations`);
        return [];
      }
      return ((await res.json()) as { invites?: Awaited<ReturnType<NMBridge['invites']>> }).invites ?? [];
    },

    // sync/ipc/membership.ts:65. NOTHING IS SWALLOWED HERE. The invitations waiting on you gate
    // the first-run latch (App.tsx: `needsOnboarding && wsInvites.length === 0` opens the
    // wizard), so a failed read that answered `[]` could walk an invited newcomer into creating
    // their own empty second workspace. The caller's own catch keeps the last good list; a throw
    // is what reaches it. `needsOnboarding` is bootstrap's rule, not a second one.
    myInvites: async () => {
      const [workspaces, mine] = await Promise.all([
        myWorkspaces(cfg),
        apiGet<{ invites?: PendingInvite[] }>(cfg, '/v1/invites/mine'),
      ]);
      const active = workspaces.find((w) => w.id === cfg.workspaceId()) ?? workspaces[0];
      return { invites: mine.invites ?? [], needsOnboarding: workspaces.length === 0 || active?.onboarded === false };
    },

    // sync/ipc/settings.ts:166 and :171 — mint the hosted URL, open it, report whether there was
    // one. The human pays on Stripe's page, never in-app, on the web exactly as on the desktop.
    billingCheckout: () => billing(cfg, 'checkout'),
    billingPortal: () => billing(cfg, 'portal'),
    creditsHistory: async () => (await apiGet(cfg, `/v1/credits/history?workspace=${encodeURIComponent(cfg.workspaceId())}`).catch(() => null)) as CreditHistory | null,
    creditsCheckout: async (credits: number) => {
      const { url } = await apiPost<{ url?: string }>(cfg, '/v1/billing/credits-checkout', { workspace: cfg.workspaceId(), credits });
      if (url) openHosted(url);
      return { ok: !!url };
    },

    // authipc.ts:26. The desktop's version hands off to the SYSTEM browser and waits on a loopback
    // callback; in a browser Clerk is already in the page (webnm-auth.ts owns the sign-in buttons),
    // so all that is left of this lane is its second half: exchange the live session for the nm
    // identity — the same POST /auth/clerk, unauthenticated by design, the token IS the credential.
    // Signed out there is nothing to exchange, and saying so beats resolving a truthy nobody.
    authClerk: async () => {
      const token = await cfg.clerkBearer();
      if (!token) throw new Error('no Clerk session in this browser — use the sign-in buttons on this screen');
      const body = await apiPost<{ userId: string; email: string | null }>(cfg, '/auth/clerk', { token });
      return { user: { id: body.userId, email: body.email ?? '' } };
    },
  };
}

/** the shape a machine-shaped refusal wears here — one reason, said the same way every time.
 *  Two pieces because these messages COMPOSE: a refusal that already named the browser appends
 *  only the tail, or it reads "machine-local — not available in the browser — needs a machine". */
const VIA_RELAY = 'this needs a machine, which reaches you through nm-relay';
const NO_MACHINE = `not available in the browser — ${VIA_RELAY}`;

/** the lanes a browser genuinely cannot serve (webnm-local.ts's doctrine, account edition) */
function machineLanes(): Partial<NMBridge> {
  return {
    // authipc.ts:16 and :21 — the LEGACY supabase/dev sign-in, which has no web implementation at
    // all: `mode === 'clerk'` routes Login.tsx to the authClerk* lanes instead, and these two are
    // reached only if that mode ever changes under it. They must THROW rather than resolve,
    // because Login destructures `const { user } = await nm.login(...)` and hands `user` straight
    // to onDone — the fallback's truthy empty would have signed the app in as an object with no
    // id. Login already renders a thrown message as the form's error.
    login: async () => { throw new Error('this build signs in with Clerk — use the buttons above, not the legacy password lane'); },
    loginGitHub: async () => { throw new Error('this build signs in with Clerk — use Continue with GitHub above'); },

    // sync/ipc/settings.ts:180 — "make THIS Mac the workspace's primary machine, then relaunch".
    // A browser is never the workspace's machine (the same reason machineLimitInfo answers null
    // in webnm-local.ts), so there is nothing here to transfer to. The modal that calls this
    // cannot render on the web precisely because machineLimitInfo is null; `{ ok: false }` is the
    // answer if anything ever reaches it anyway.
    machineTransfer: async () => { console.warn(`[webnm] machineTransfer: ${NO_MACHINE}`); return { ok: false }; },

    // sync/ipc/agents.ts:86 — a preference the MAIN PROCESS reads to decide whether OS
    // notifications fire. Nothing in the browser client raises a notification, so there is no
    // notifier for this to reach. The renderer's own localStorage is where the toggle's state
    // actually lives (shell/appearance.tsx), so `{ ok: false }` costs the toggle nothing and
    // refuses to claim a delivery path that does not exist. Asking for the Notification
    // permission instead would be the fake success: permission for notifications never sent.
    setNotificationsEnabled: async () => ({ ok: false }),

    // sync/ipc/agents.ts:173 — re-runs `claude auth login` / `codex login` / `agy` in a PTY on
    // this host and polls detection afterwards. `{ authed: false }` is a real state of this
    // contract and matches what detectProviders already answers in the browser (nothing is
    // installed HERE); AuthCard renders it as 'failed', which is the truth.
    providerReauth: async () => ({ authed: false }),

    // sync/ipc/agents.ts:116 — shells out to `claude mcp get claude-design`. `configured: false`
    // with the reason in `detail` is exactly the shape the desktop returns when the CLI is
    // missing, and QuestionFlow prints `detail` verbatim, so the card explains itself.
    claudeDesignStatus: async () => ({ configured: false, claudeAuthed: false, detail: 'Claude Design connects through the Claude CLI on a machine — not from the browser.' }),

    // sync/ipc/agents.ts:133 — writes an MCP server into the user's Claude config and returns the
    // cwd + command a terminal is opened on. THROWS, and the throw is the point: the caller sets
    // "Connected." and dispatches a terminal launch on whatever this resolves, so any object here
    // paints a success over a machine that was never touched.
    claudeDesignConnect: async () => { throw new Error(`Claude Design ${NO_MACHINE}`); },

    // sync/ipc/projects.ts:63/68/75 — the marketing MCP credentials, kept in mcp-keys.json under
    // userData and deliberately "never synced, never on our server". A tab has no userData, so
    // there is nowhere to read from, nowhere to write to, and no node to probe an MCP endpoint
    // from. Presence is honestly all-false; the setter refuses out loud rather than reporting a
    // presence map that would say the key never landed while implying it was offered a home.
    mcpKeys: async () => ({ presence: { posthog: false, meta: false, instagram: false, tiktok: false }, metaUrl: '', tiktokUrl: '' }),
    mcpKeySet: async () => { throw new Error(`MCP connector keys are machine-local (mcp-keys.json) — ${VIA_RELAY}`); },
    mcpVerify: async () => ({ ok: false, detail: `cannot probe an MCP endpoint from the browser — ${VIA_RELAY}` }),
  };
}

/**
 * The account tranche. `_db` is unused: every lane here is either an HTTP call or a refusal —
 * none of this is replicated (workspaces, invites and billing are operator state that is
 * deliberately outside the sync publication). The parameter stays so every override module in
 * this directory is wired the same way.
 */
export function accountOverrides(cfg: WebNmConfig, _db: PowerSyncDatabase): Partial<NMBridge> {
  return { ...httpLanes(cfg), ...machineLanes() };
}
