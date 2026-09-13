// /pro: the one door to the hosted cloud, for a visitor from the pricing page and for the
// desktop's Get Pro (artboards C1 and C2). The desktop opens this page with a one-time ?nonce
// (POST /auth/desktop/start) and polls. The page signs the person up or in with Clerk, establishes
// the nm identity (POST /auth/clerk, where the first hosted sign-in makes the workspace, U1b),
// names that workspace to POST /v1/billing/checkout, and sends the browser to Stripe. Stripe
// returns to /billing/success, which finishes the desktop handoff (POST /auth/desktop/complete)
// when a nonce was stashed, so the desktop learns of the session only once Pro is paid. One
// sign-in, reused: the Clerk widgets, the appearance, and the handoff URL are /desktop-signin's.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { SignIn, SignUp, useClerk, useUser } from '@clerk/clerk-react';
import { DesktopAuthMsg } from './account';
import { AuthNav, CLERK_PK, NM_API, clerkAppearance } from './auth';
import { HQ_URL } from './copy';
import { isPro, pickWorkspace, stashNonce, takeNonce, type WorkspaceRow } from './pro-handoff';
import { handoffUrl, type SigninMode } from './signin-mode';

// Every sentence a person reads on this page, in one place (CLAUDE.md #11).
export const PRO_COPY = {
  sub: 'Pro is the hosted cloud around the free Mac app. $22 per seat, per month. Sign in, then pay on Stripe.',
  moment: 'One moment',
  signin: 'We check your sign-in.',
  wait: 'Your workspace is not ready yet. Please wait…',
  checkout: 'Checkout opens next.',
  timeoutTitle: 'Your workspace is not ready yet.',
  timeoutBody: 'Try again in a moment.',
  proTitle: 'You are on Pro',
  proApp: 'The app is signed in. Go back to neuramesh. You can close this tab.',
  proWeb: 'Open neuramesh in your browser, or go back to the app.',
  open: 'Open neuramesh',
  errorTitle: 'Checkout did not start',
  errorApp: 'Choose Get Pro in the app again.',
  retry: 'Try again',
  expired: 'The app waited too long. Choose Get Pro in the app again.',
  unconfigured: { title: 'Sign-in is not set up here', body: 'This build has no sign-in. Get Pro at neuramesh.app/pro.' },
};

/** how long the page waits for the server to make the workspace after the first sign-in */
export const WORKSPACE_WAIT_MS = 20_000;
const WORKSPACE_POLL_MS = 1_000;

type Phase = 'idle' | 'signin' | 'waiting' | 'checkout' | 'pro' | 'timeout' | 'error';

async function errorOf(res: Response, fallback: string): Promise<string> {
  const j = (await res.json().catch(() => ({}))) as { error?: string };
  return j.error || fallback;
}

const json = (body: unknown, bearer?: string): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
  body: JSON.stringify(body),
});

/** the person's workspace, polled once a second until it exists or the window closes */
async function waitForWorkspace(bearer: () => Promise<string>): Promise<WorkspaceRow | null> {
  const deadline = Date.now() + WORKSPACE_WAIT_MS;
  for (;;) {
    const res = await fetch(`${NM_API}/v1/workspaces`, { headers: { authorization: `Bearer ${await bearer()}` } });
    if (res.status === 401 || res.status === 403) throw new Error(await errorOf(res, `the sign-in was refused (${res.status})`));
    if (res.ok) {
      const { workspaces } = (await res.json()) as { workspaces?: WorkspaceRow[] };
      const ws = pickWorkspace(workspaces ?? []);
      if (ws) return ws;
    }
    if (Date.now() >= deadline) return null;
    await new Promise((r) => setTimeout(r, WORKSPACE_POLL_MS));
  }
}

/** POST /auth/desktop/complete: the desktop's poll turns `done` and it adds the Cloud connection */
export async function completeDesktopHandoff(nonce: string, token: string): Promise<void> {
  const res = await fetch(`${NM_API}/auth/desktop/complete`, json({ nonce, token }));
  if (res.status === 404) throw new Error(PRO_COPY.expired);
  if (!res.ok) throw new Error(await errorOf(res, `the app sign-in did not complete (${res.status})`));
}

/** one sentence, one full stop: server messages arrive with or without their own */
const sentence = (s: string) => `${s.replace(/\.$/, '')}.`;

function ProShell({ onBack, children }: { onBack: () => void; children: ReactNode }) {
  return (
    <><AuthNav onBack={onBack} />
    <div className="auth">
      <div className="authform">{children}</div>
    </div></>
  );
}

export function ProPage({ theme, onBack }: { theme: string; onBack: () => void }) {
  if (!CLERK_PK) {
    return <ProShell onBack={onBack}><div className="clerkmount"><DesktopAuthMsg title={PRO_COPY.unconfigured.title} body={PRO_COPY.unconfigured.body} /></div></ProShell>;
  }
  return <ProFlow theme={theme} onBack={onBack} />;
}

function ProFlow({ theme, onBack }: { theme: string; onBack: () => void }) {
  const params = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
  const nonce = params.get('nonce');
  // the pricing page opens the sign-up face, the desktop's Get Pro too; ?mode=signin flips it
  const mode: SigninMode = params.get('mode') === 'signin' ? 'signin' : 'signup';
  const { isSignedIn } = useUser();
  const clerk = useClerk();
  const [phase, setPhase] = useState<Phase>('idle');
  const [err, setErr] = useState('');
  const [attempt, setAttempt] = useState(0);
  const started = useRef(false);
  const appearance = clerkAppearance();
  const selfUrl = handoffUrl(nonce, 'signin', '/pro');
  const signUpUrl = handoffUrl(nonce, 'signup', '/pro');

  // the nonce must survive Stripe: stash it the moment the page opens with one
  useEffect(() => { if (nonce) stashNonce(sessionStorage, nonce); }, [nonce]);

  useEffect(() => {
    if (!isSignedIn || started.current) return;
    started.current = true;
    const bearer = async () => {
      const t = await clerk.session?.getToken();
      if (!t) throw new Error('no active session token');
      return t;
    };
    void (async () => {
      try {
        setPhase('signin');
        const est = await fetch(`${NM_API}/auth/clerk`, json({ token: await bearer() }));
        if (!est.ok) throw new Error(await errorOf(est, `the sign-in did not complete (${est.status})`));
        setPhase('waiting');
        const ws = await waitForWorkspace(bearer);
        if (!ws) { setPhase('timeout'); return; }
        if (isPro(ws.plan)) {
          // already paid (the desktop's "Open the page again", or a Pro owner on the pricing page):
          // no second checkout, just the handoff when the app waits for one
          if (nonce) { await completeDesktopHandoff(nonce, await bearer()); takeNonce(sessionStorage); }
          setPhase('pro');
          return;
        }
        setPhase('checkout');
        const res = await fetch(`${NM_API}/v1/billing/checkout`, json({ workspace: ws.id }, await bearer()));
        if (!res.ok) throw new Error(await errorOf(res, `checkout did not start (${res.status})`));
        const { url } = (await res.json()) as { url?: string };
        if (!url) throw new Error('checkout returned no url');
        location.assign(url);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
        setPhase('error');
      }
    })();
  }, [isSignedIn, attempt, clerk, nonce]);

  const retry = () => { started.current = false; setErr(''); setPhase('idle'); setAttempt((n) => n + 1); };

  return (
    <ProShell onBack={onBack}>
      <div className="clerkmount">
        {phase === 'pro' ? (
          <>
            <DesktopAuthMsg title={PRO_COPY.proTitle} body={nonce ? PRO_COPY.proApp : PRO_COPY.proWeb} />
            {!nonce && <div className="joinretry"><a className="btn primary" href={HQ_URL}>{PRO_COPY.open}</a></div>}
          </>
        ) : phase === 'timeout' ? (
          <>
            <DesktopAuthMsg title={PRO_COPY.timeoutTitle} body={PRO_COPY.timeoutBody} />
            <div className="joinretry"><button className="btn primary" onClick={retry}>{PRO_COPY.retry}</button></div>
          </>
        ) : phase === 'error' ? (
          <>
            <DesktopAuthMsg title={PRO_COPY.errorTitle} body={nonce ? `${sentence(err)} ${PRO_COPY.errorApp}` : sentence(err)} />
            <div className="joinretry"><button className="btn primary" onClick={retry}>{PRO_COPY.retry}</button></div>
          </>
        ) : isSignedIn || phase !== 'idle' ? (
          <DesktopAuthMsg title={PRO_COPY.moment} body={phase === 'waiting' ? PRO_COPY.wait : phase === 'checkout' ? PRO_COPY.checkout : PRO_COPY.signin} spin />
        ) : (
          <>
            <p className="sub">{PRO_COPY.sub}</p>
            {mode === 'signup'
              ? <SignUp key={`pro-up-${theme}`} routing="virtual" appearance={appearance} forceRedirectUrl={signUpUrl} fallbackRedirectUrl={signUpUrl} signInUrl={selfUrl} />
              : <SignIn key={`pro-in-${theme}`} routing="virtual" appearance={appearance} forceRedirectUrl={selfUrl} fallbackRedirectUrl={selfUrl} signUpUrl={signUpUrl} />}
          </>
        )}
      </div>
    </ProShell>
  );
}
