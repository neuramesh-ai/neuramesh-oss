/// <reference types="vite/client" />
// the browser client's entry (W2, plan §3.1): the SAME renderer + App the desktop runs,
// with the web bridge on window.nm instead of the preload. mirrors preview/main.tsx's
// shape — bridge installed before App's module evaluates (App reads window.nm at import
// time) — with the mock swapped for the live web implementation.
import { createRoot } from 'react-dom/client';
import { authHeaders, makeWebNm, openWebDb } from './webnm';
import { authOverrides, clerkBearer, clerkSessionDead, liveClerkSessionId, rememberClerkSessionId, restoreSession } from './webnm-auth';
import { bootOverrides } from './webnm-boot';
import { onboardOverrides } from './webnm-onboard';
import { convoOverrides } from './webnm-convo';
import { signDevPowerSyncToken } from './webnm-devtoken';
import { roomOverrides } from './webnm-rooms';
import { rowOverrides } from './webnm-rows';
import { boardOverrides } from './webnm-board';
import { actionOverrides } from './webnm-actions';
import { attachOverrides } from './webnm-attach';
import { contentOverrides } from './webnm-content';
import { accountOverrides } from './webnm-account';
import { opsOverrides } from './webnm-ops';
import { localOverrides } from './webnm-local';
import { relayOverrides } from './webnm-relay';
import '@neuramesh/fonts/neuramesh-sans.css';
import '@fontsource-variable/geist-mono/wght.css';
import '@fontsource-variable/bricolage-grotesque/wght.css';
import '../src/tokens.css';

// dev default '' = same-origin through the vite proxy (no CORS); production sets the real base
const API_URL = (import.meta.env['VITE_NM_API_URL'] as string | undefined) ?? '';
// NO literal fallback (the source-release round): a bundle that points every visitor at one
// hard-coded PowerSync instance is the class of bug electron.vite.config.ts refuses at build time
// for the desktop, and the browser build refuses it the same way — loudly, at boot, never silently.
const POWERSYNC_URL = (import.meta.env['VITE_NM_POWERSYNC_URL'] as string | undefined) ?? '';
if (!POWERSYNC_URL) throw new Error('VITE_NM_POWERSYNC_URL is not set: the browser build has no PowerSync endpoint (set it on the site\'s deployment)');

const CLERK_PK = (import.meta.env['VITE_NM_CLERK_PK'] as string | undefined) ?? '';

const DEV_USER = (import.meta.env['VITE_NM_DEV_USER'] as string | undefined) ?? '';
const DEV_RELAY_TOKEN = (import.meta.env['VITE_NM_DEV_RELAY_TOKEN'] as string | undefined) ?? '';

// the relay origin. UNSET IS A VALID BUILD: without it the terminal lanes keep
// webnm-local's honest "No shell here.", which is the correct answer for an environment
// that has no relay deployed. Setting it is what turns those three lanes real.
const RELAY_URL = (import.meta.env['VITE_NM_RELAY_URL'] as string | undefined) ?? '';

const cfg = {
  apiUrl: API_URL,
  powersyncUrl: POWERSYNC_URL,
  clerkSessionId: async () => localStorage.getItem('nm:web:clerkSession'),
  // the mint asks the LIVE client first and only falls back to the stored snapshot above; a
  // verified-dead session lands on sign-in rather than retrying forever (webnm-credentials.ts)
  liveClerkSessionId: () => (CLERK_PK ? liveClerkSessionId() : Promise.resolve(null)),
  rememberClerkSessionId,
  onSessionDead: () => { if (CLERK_PK) clerkSessionDead(); },
  // local harness only: DEV_USER is a build-time env no deployed bundle sets
  ...(DEV_USER
    ? {
        devPowerSyncToken: () => signDevPowerSyncToken(DEV_USER),
        // ?db=<name> gives the harness a clean replica when a previous page still holds the
        // OPFS locks — see the note on dbFilename
        dbFilename: new URLSearchParams(location.search).get('db') ?? undefined,
      }
    : {}),
  clerkBearer: () => (CLERK_PK ? clerkBearer() : Promise.resolve(null)),
  relayBearer: () => DEV_RELAY_TOKEN ? Promise.resolve(DEV_RELAY_TOKEN) : (CLERK_PK ? clerkBearer() : Promise.resolve(null)),
  actorId: () => DEV_USER || localStorage.getItem('nm:web:actorId') || '',
  workspaceId: () => localStorage.getItem('nm:web:workspaceId') ?? '',
};

// async boot, the preview harness's ordering kept: window.nm exists BEFORE App's module
// evaluates. an existing clerk session (or a just-completed oauth redirect) re-establishes
// the nm identity first, so authStatus answers signed-in on reload.
void (async () => {
  if (CLERK_PK) await restoreSession(CLERK_PK, API_URL);
  else console.warn('[webnm] VITE_NM_CLERK_PK unset — sign-in disabled (dev identity lanes only)');
  // the replica opens first: the launch step's overrides query it to find the workspace's
  // runner, so they need the same handle the bridge syncs on.
  const db = openWebDb(cfg);
  const { nm, handles } = makeWebNm(cfg, db, {
    ...localOverrides(),
    ...(RELAY_URL ? relayOverrides({ ...cfg, authHeaders: () => authHeaders(cfg) }, RELAY_URL) : {}),
    ...bootOverrides(cfg),
    ...rowOverrides(cfg, db),
    ...roomOverrides(cfg, db),
    ...convoOverrides(cfg, db),
    ...boardOverrides(cfg, db),
    ...actionOverrides(cfg, db),
    ...attachOverrides(cfg, db),
    ...contentOverrides(cfg, db),
    ...accountOverrides(cfg, db),
    ...opsOverrides(cfg, db),
    ...onboardOverrides(cfg, db),
    ...(CLERK_PK ? authOverrides(CLERK_PK, API_URL) : {}),
  });
  (window as unknown as { nm: unknown }).nm = nm;
  // LOCAL HARNESS ONLY: the replica handle, so a sync problem can be inspected from the console
  // instead of guessed at. DEV_USER is a build-time env no deployed bundle sets.
  if (DEV_USER) (window as unknown as { __nmDb: unknown }).__nmDb = handles.db;
  const { App } = await import('../src/App');
  createRoot(document.getElementById('root')!).render(<App />);
})();
