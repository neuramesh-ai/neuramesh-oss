// Sign-in. Extracted from App.tsx (track A4).
import { PorchMark } from '../brand';
import { IS_WEB } from '../lib/platform';

import { nm as nmBridge } from '../bridge/nm';
import { useEffect, useState, type ReactNode } from 'react';

// Imported bindings lose control-flow narrowing inside closures, so re-bind (same as App.tsx).
const nm = nmBridge;

// App sign-in (handoff design-diff 4-app-signin.png): the installed app's first screen,
// framed as a desktop window (traffic-light titlebar + ambient glow). Plugs into the SAME
// Clerk auth the web hands off to (authClerk*); the supabase path is the legacy fallback.
// signin (default) vs signup modes; the CTA proceeds into the existing onboarding.
// `update` is the shell's update card, docked under the sign-in card — so a build the server
// no longer accepts can be updated from HERE, without ever getting past this screen.
export function Login({ onDone, mode, update }: { onDone: (u: { id: string; email: string }) => void; mode?: string; update?: ReactNode }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState<null | 'google' | 'github'>(null);
  const [waitLeft, setWaitLeft] = useState(60); // browser-handoff countdown → buttons re-enable at 0
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');
  const isClerk = mode === 'clerk';
  const signup = authMode === 'signup';
  const cleanErr = (e: unknown, fallback: string) =>
    e instanceof Error ? e.message.replace(/^Error invoking remote method.*?: Error: /, '').slice(0, 140) : fallback;

  // Social sign-in hands off to the system browser (Clerk OAuth via a loopback page) and
  // blocks until it's done — surface a "continue in your browser" state so it isn't silent.
  const oauth = async (provider: 'google' | 'github') => {
    if (!nm || busy) return;
    setBusy(true);
    setErr('');
    setWaiting(provider);
    try {
      const { user } = isClerk ? await nm.authClerkOAuth(provider) : await nm.loginGitHub();
      onDone(user);
    } catch (e) {
      setErr(cleanErr(e, `${provider} sign-in failed`));
    } finally {
      setBusy(false);
      setWaiting(null);
    }
  };
  const provLabel = (p: 'google' | 'github') => (p === 'github' ? 'GitHub' : 'Google');
  const submitEmail = async () => {
    if (!nm || busy) return;
    setBusy(true);
    setErr('');
    try {
      // signup mode creates the account (clerk mode only — the legacy path has no
      // signup endpoint); both modes land signed-in and proceed into onboarding.
      const { user } = isClerk
        ? signup
          ? await nm.authClerkSignup(email.trim(), password)
          : await nm.authClerkPassword(email.trim(), password)
        : await nm.login(email.trim(), password);
      onDone(user);
    } catch (e) {
      setErr(cleanErr(e, signup ? 'account creation failed' : 'sign-in failed'));
    } finally {
      setBusy(false);
    }
  };

  // Mirror the main process's browser-handoff timeout as a visible countdown; at 0 the poll has
  // given up (main rejects) and the buttons re-enable for a fresh retry with a new nonce.
  useEffect(() => {
    if (!waiting) return;
    setWaitLeft(60);
    const id = setInterval(() => setWaitLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [waiting]);

  return (
    <div className="appauth">
      <div className="appauthbody">
        <div className="appauthcard">
          <span className="appauthlogo">
            <PorchMark size={52} />
          </span>
          <h2 className="appauthh">{signup ? 'Create your account' : 'Welcome back'}</h2>
          <p className="appauthsub">{signup ? 'Start free — the full local loop, your keys, your machine.' : 'Sign in to pick up where your agents left off.'}</p>
          {waiting && (
            <div className="appauthwait" role="status">
              <span className="appauthwaitico">↗</span>
              <span>
                Continue with <b>{provLabel(waiting)}</b> in your browser — finish there and you'll land right back here.
                <span className="appauthwaitcd">{waitLeft > 0 ? `Stuck? You can start over in ${waitLeft}s.` : 'Wrapping up…'}</span>
              </span>
            </div>
          )}
          <button className="btn ghbtn" disabled={busy} onClick={() => void oauth('github')}>
            <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/>
            </svg>
            {waiting === 'github' ? 'Waiting for your browser…' : 'Continue with GitHub'}
          </button>
          {isClerk && (
            <button className="btn ghbtn" disabled={busy} onClick={() => void oauth('google')}>
              <svg width="15" height="15" viewBox="0 0 48 48" aria-hidden>
                <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
              </svg>
              {waiting === 'google' ? 'Waiting for your browser…' : 'Continue with Google'}
            </button>
          )}
          <div className="ordivide"><span>or with email</span></div>
          <input placeholder="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          <input placeholder="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void submitEmail()} />
          <button className="btn primary" disabled={busy} onClick={() => void submitEmail()}>
            {busy ? (signup ? 'creating…' : 'signing in…') : signup ? 'Create account →' : 'Sign in →'}
          </button>
          <div className="loginerr">{err}</div>
          <div className="appauthswitch">
            {signup ? 'Already have an account? ' : 'New to neuramesh? '}
            <button onClick={() => { setErr(''); setAuthMode(signup ? 'signin' : 'signup'); }}>{signup ? 'Sign in' : 'Create your account'}</button>
          </div>
        </div>
        {update}
        <div className="appauthfoot"><span className="appauthdot" /> {IS_WEB ? 'Your agents run on your own machines — local or cloud' : 'Running locally · your keys never leave this machine'}</div>
      </div>
    </div>
  );
}
