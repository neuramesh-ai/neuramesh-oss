// Signed-in surfaces: the account menu, sign-up/sign-in returns, the invite join page.
import { useEffect, useRef, useState } from 'react';
import { SignIn, SignUp, useClerk, useUser } from '@clerk/clerk-react';
import { handoffUrl, signinMode } from './signin-mode';
import { IconChevron, IconSignOut } from './brand';
import { AuthNav, CLERK_PK, NM_API, clerkAppearance, openDesktopApp, useSession } from './auth';
import { Footer } from './shell';
import { HQ_URL } from './copy';
import { DL_STEPS, DlNav, RecommendedDownload, type Release, useIsAppleSilicon, useReleases } from './downloads';

export function DesktopAuthMsg({ title, body, spin }: { title: string; body: string; spin?: boolean }) {
  return (
    <div className="deskauthmsg">
      {spin ? <div className="deskauthspin" /> : null}
      <h2>{title}</h2>
      <p>{body}</p>
    </div>
  );
}

// The desktop sign-in destination. The packaged app opens this in the system browser with a
// one-time ?nonce; the user signs in HERE (on neuramesh.app — same-site with the Clerk FAPI,
// so OAuth/cookies work where the 127.0.0.1 loopback can't), then we hand the Clerk session
// token to control-api keyed by the nonce, and the desktop polls to claim it. Unlike the
// marketing ClerkAuth, the OAuth redirect is pinned back HERE (not /welcome) — see App()'s
// desktop-aware signIn/signUpForceRedirectUrl — so the full-page round-trip returns to this
// route and the handoff runs.
export function DesktopSignIn({ theme, onBack }: { theme: string; onBack: () => void }) {
  const params = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
  const nonce = params.get('nonce');
  // the phone's Start free opens this page in sign-up mode (the mobile-cloud round, D15) — one
  // page, two faces, and the completion below is the same for both
  const mode = signinMode(params.get('mode'));
  const { isSignedIn } = useUser();
  const clerk = useClerk();
  const [phase, setPhase] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
  const [err, setErr] = useState('');
  const appearance = clerkAppearance();
  const selfUrl = handoffUrl(nonce, 'signin');
  const signUpUrl = handoffUrl(nonce, 'signup');

  useEffect(() => {
    if (!isSignedIn || !nonce || phase !== 'idle') return;
    setPhase('sending');
    void (async () => {
      try {
        const token = await clerk.session?.getToken();
        if (!token) throw new Error('no active session token');
        const res = await fetch(`${NM_API}/auth/desktop/complete`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ nonce, token }),
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(j.error || `sign-in handoff failed (${res.status})`);
        }
        setPhase('done');
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
        setPhase('error');
      }
    })();
  }, [isSignedIn, nonce, phase, clerk]);

  return (
    <><AuthNav onBack={onBack} />
    <div className="auth">
      <div className="authform">
        <div className="clerkmount">
          {!nonce ? (
            <DesktopAuthMsg title="Open sign-in from the app" body="Launch neuramesh and choose Sign in. The app opens this page with a secure code, so your session lands back in the app." />
          ) : phase === 'done' ? (
            <DesktopAuthMsg title="You're signed in ✓" body="Go back to neuramesh. You are all set. You can close this tab." />
          ) : phase === 'error' ? (
            <DesktopAuthMsg title="Sign-in didn't complete" body={`${err}. Close this tab and try again from the app.`} />
          ) : isSignedIn || phase === 'sending' ? (
            <DesktopAuthMsg title="Finishing sign-in…" body="Handing your session to neuramesh." spin />
          ) : (
            mode === 'signup'
              ? <SignUp key={`desk-up-${theme}`} routing="virtual" appearance={appearance} forceRedirectUrl={selfUrl} fallbackRedirectUrl={selfUrl} signInUrl={selfUrl} />
              : <SignIn key={`desk-${theme}`} routing="virtual" appearance={appearance} forceRedirectUrl={selfUrl} fallbackRedirectUrl={selfUrl} signUpUrl={signUpUrl} />
          )}
        </div>
      </div>
    </div></>
  );
}

// Signed-in account control: an avatar button that opens a dropdown (identity + sign out).
export function AccountMenu() {
  const { email, name, imageUrl, signOut } = useSession();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onClick); document.removeEventListener('keydown', onKey); };
  }, [open]);
  const face = imageUrl ? <img src={imageUrl} alt="" /> : email?.charAt(0).toUpperCase();
  return (
    <div className="navuser" ref={ref}>
      <button className={`avatarbtn${open ? ' on' : ''}`} onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} title={email ?? undefined}>
        <span className="avatarface">{face}</span><span className="avatarcaret"><IconChevron /></span>
      </button>
      {open && (
        <div className="usermenu" role="menu">
          <div className="usermenuhead">
            <span className="usermenuav">{face}</span>
            <div className="usermenuwho">
              {name && <span className="usermenuname">{name}</span>}
              <span className="usermenuemail">{email}</span>
            </div>
          </div>
          <div className="usermenudiv" />
          <button className="usermenuitem" role="menuitem" onClick={signOut}><IconSignOut /> Sign out</button>
        </div>
      )}
    </div>
  );
}

// Web does the cheap, shareable part: create an account → download. Demo fallback only
// (the real flow uses ClerkAuth above when Clerk is configured).
export function CreateAccount({ onBack, onCreated }: { onBack: () => void; onCreated: () => void }) {
  const create = () => onCreated();
  return (
    <><AuthNav onBack={onBack} />
    <div className="auth">
      <div className="authform">
        <h2>Create your account</h2>
        <p className="sub">Pro is the hosted cloud. Create your account, then pay $22 per seat, per month on Stripe. The Mac app stays free.</p>
        <button className="authbtn" onClick={create}><span style={{ fontWeight: 900 }}>⌥</span> Continue with GitHub</button>
        <button className="authbtn" onClick={create}><span style={{ color: 'var(--accent)', fontWeight: 900 }}>G</span> Continue with Google</button>
        <div className="ordiv">or with email</div>
        <div className="fld"><label>Work email</label><input type="email" placeholder="you@company.com" onKeyDown={(e) => e.key === 'Enter' && create()} /></div>
        <div className="fld"><label>Password</label><input type="password" placeholder="••••••••••" onKeyDown={(e) => e.key === 'Enter' && create()} /></div>
        <button className="btn primary" onClick={create}>Create account →</button>
        <div className="authswitch">Already have an account? <button onClick={openDesktopApp}>Sign in in the app →</button></div>
      </div>
    </div></>
  );
}

// /welcome — shown right after a web sign-up: confirms the account, points to the
// download, and walks through what happens next. Distinct from /downloads.
export function PostSignup({ onBack }: { onBack: () => void }) {
  const { email } = useSession();
  const chipEmail = email || (CLERK_PK ? null : 'you@acme.dev');
  const { state, releases } = useReleases();
  const isArm = useIsAppleSilicon();
  const latest = releases[0] as Release | undefined;
  return (
    <>
      <DlNav onBack={onBack} />
      <section className="section dlwrap">
        <div className="wrap dlgrid">
          <div className="dlleft">
            <span className="eyebrow ready">Account ready ✓</span>
            <h1>You're in. Open your workspace.</h1>
            <p className="lead">Your workspace runs in the browser, on the neuramesh Starter model. Add your Mac later for local repos and your own CLI logins.</p>
            <div><a className="btn primary big dlopenweb" href={HQ_URL}>Open your workspace →</a></div>
            <RecommendedDownload state={state} latest={latest} isArm={isArm} screen="welcome" />
            {chipEmail && <div className="dlchip"><span className="chipdot" /> Account ready: <b>{chipEmail}</b> · the same sign-in works in the app</div>}
          </div>
          <div className="dlnext">
            <div className="dlnexthead">What happens next</div>
            {DL_STEPS.map((s) => (
              <div className="dlstep" key={s.n}><span className="dlstepn">{s.n}</span><div><b>{s.t}</b><p>{s.d}</p></div></div>
            ))}
            <button className="btn dark dlopen" onClick={openDesktopApp}>I installed it. Open the app →</button>
            <p className="dlopennote">The app opens to sign-in, then walks you through setup.</p>
          </div>
        </div>
      </section>
      <Footer />
    </>
  );
}

// Real path routes: /downloads (standalone) + /welcome (post-signup) + /signup
// + /terms + /privacy + /support. Legacy ?screen=/?account= links still resolve (older
// bookmarks); the Clerk redirect now targets /welcome. Vercel rewrites these paths to index.html.
// /billing/{success,cancel,portal-return} — where Stripe sends the browser back after Checkout/Portal
// (NM_BILLING_RETURN_URL = https://neuramesh.app/billing). The desktop re-reads the plan on window
// focus, so gates already unlock on return; this just confirms the outcome and offers a one-click hop
// back to the app (neuramesh:// — safe while signed in; re-signin only happens on logout).

// /join?token=… — where a workspace invitation lands (docs/27 §1d). This page NEVER grants
// membership: it reads the token to show WHICH workspace and WHO, then hands off to Clerk. The
// membership is created server-side when they sign in and the control-api matches their VERIFIED
// email against the pending invite — so the flow completes even if they lose this tab, sign up
// from the homepage a week later, or already had an account. The link is the courtesy; the
// verified-email claim is the mechanism.
export function JoinPage({ theme, onBack }: { theme: string; onBack: () => void }) {
  const token = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('token') : null;
  const [inv, setInv] = useState<{ workspace: string; email: string; role: string } | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'gone' | 'error'>(token ? 'loading' : 'gone');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!token) return;
    setState('loading');
    void (async () => {
      try {
        const res = await fetch(`${NM_API}/invites/${encodeURIComponent(token)}`);
        // A 404 is the ONLY answer that means the invitation itself is over. Anything else —
        // a 5xx, a dropped connection, a fetch the browser rejected before we saw a status —
        // is us failing to ask, and rendering "expired" there tells someone holding a perfectly
        // good link that it's dead. It did: every invite link 'expired' while /invites/* was
        // mounted without CORS headers, because a blocked fetch lands in this catch.
        if (res.status === 404) { setState('gone'); return; }
        if (!res.ok) { setState('error'); return; }
        setInv((await res.json()) as { workspace: string; email: string; role: string });
        setState('ready');
      } catch { setState('error'); }
    })();
  }, [token, attempt]);

  const appearance = clerkAppearance();
  return (
    <><AuthNav onBack={onBack} />
    <div className="auth">
      <div className="authform">
        {state === 'loading' ? (
          <DesktopAuthMsg title="Checking your invitation…" body="One moment." spin />
        ) : state === 'error' ? (
          <>
            <DesktopAuthMsg
              title="We couldn't check this invitation"
              body="That is on our side, not your link. Your link is still good. Try again in a moment, or sign in if you already have an account on that address."
            />
            <div className="joinretry"><button className="btn primary" onClick={() => setAttempt((n) => n + 1)}>Try again</button></div>
          </>
        ) : state === 'gone' ? (
          <DesktopAuthMsg
            title="This invitation has expired"
            body="Invitations last 14 days. Ask whoever invited you to send another, or sign in if you already have an account on that address."
          />
        ) : (
          <>
            <div className="joininv">
              <div className="joinws">{inv!.workspace}</div>
              <div className="joinsub">You&rsquo;ve been invited as a {inv!.role}. Create your account with <b>{inv!.email}</b> and you&rsquo;ll land straight in.</div>
            </div>
            <div className="clerkmount">
              {CLERK_PK ? <SignUp key={`join-${theme}`} routing="virtual" appearance={appearance} initialValues={{ emailAddress: inv!.email }} /> : null}
            </div>
          </>
        )}
      </div>
    </div></>
  );
}
