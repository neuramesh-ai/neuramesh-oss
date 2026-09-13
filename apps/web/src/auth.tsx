// Clerk session plumbing and every signed-in surface — extracted from App.tsx (track D-web).
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { SignIn, SignUp, useClerk, useUser } from '@clerk/clerk-react';
import { BrandLockup } from './brand';


// Web auth runs on the SAME Clerk instance as the desktop (VITE_CLERK_PUBLISHABLE_KEY =
// CLERK_PUBLISHABLE_KEY). Embedded Clerk widgets, themed to ember; when unconfigured the
// CreateAccount screen falls back to a demo that just proceeds to download.
export const CLERK_PK = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

// control-api base for the desktop sign-in handoff (POST /auth/desktop/complete). Prod
// default; VITE_NM_API points it at the local dev control-api for e2e.
export const NM_API = import.meta.env.VITE_NM_API || 'https://api.neuramesh.app';

// Read a live theme token so the Clerk widget tracks the exact ember palette (handoff §6).
export function tok(name: string, fallback: string) {
  if (typeof document === 'undefined') return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

// The sign-up screen has NO card: the form sits on --paper in one centred column, on the
// site's own type system (NeuraMesh Sans, mono labels and buttons, 3px corners, the ink primary).
// Clerk's card is made invisible and each part is styled to those tokens; hover/focus ride
// Clerk's variable-driven defaults. Fallbacks mirror the light tokens (only reachable if the
// CSS custom properties somehow fail to resolve).
export function clerkAppearance() {
  const accent = tok('--accent', '#834a2b');
  const ink = tok('--ink', '#0c0b0a');
  const muted = tok('--muted', '#6b665f');
  const surface = tok('--surface', '#ffffff');
  const line = tok('--line', '#dedbd6');
  const sans = "'NeuraMesh Sans', -apple-system, BlinkMacSystemFont, sans-serif";
  const mono = "'Geist Mono Variable', ui-monospace, Menlo, monospace";
  const label = { fontFamily: mono, fontSize: '11px', fontWeight: '500', letterSpacing: '-0.02em', textTransform: 'uppercase' as const };
  return {
    variables: {
      colorPrimary: accent,
      colorBackground: tok('--paper', '#f5f4f2'),
      colorInputBackground: surface,
      colorInputText: ink,
      colorText: ink,
      colorTextSecondary: muted,
      colorNeutral: ink,
      borderRadius: '3px',
      fontFamily: sans,
      fontFamilyButtons: mono,
      fontSize: '14px',
    },
    elements: {
      rootBox: { width: '100%' },
      // Clerk v5 wraps .cl-card in an outer .cl-cardBox that carries the border + drop
      // shadow + radius — flatten it too so the form sits on --paper with no card.
      cardBox: { background: 'transparent', boxShadow: 'none', border: 'none', borderRadius: '0' },
      card: { background: 'transparent', boxShadow: 'none', border: 'none', padding: '0', margin: '0', width: '100%', gap: '22px' },
      header: { textAlign: 'left', alignItems: 'flex-start', gap: '8px' },
      headerTitle: { fontFamily: sans, fontWeight: '500', fontSize: '32px', letterSpacing: '-0.03em', lineHeight: '1.1', color: ink },
      headerSubtitle: { fontSize: '15px', lineHeight: '1.5', color: muted },
      socialButtons: { display: 'flex', flexDirection: 'column', gap: '10px' },
      socialButtonsBlockButton: { ...label, fontSize: '13px', background: surface, borderRadius: '3px', padding: '10px', color: ink },
      dividerLine: { background: line },
      dividerText: { ...label, color: muted },
      formFieldLabel: { ...label, color: muted },
      formFieldInput: { background: surface, borderRadius: '3px', padding: '10px 12px', fontSize: '14px', color: ink },
      formButtonPrimary: { ...label, fontSize: '13px', background: ink, color: tok('--paper', '#f5f4f2'), padding: '11px', borderRadius: '3px', boxShadow: 'none' },
      footer: { display: 'none' },
    },
  };
}

export function openDesktopApp() { try { window.location.href = 'neuramesh://signin'; } catch { /* not installed */ } }

// Session context — lets the marketing UI react to Clerk auth (real email, sign out) while
// staying demo-safe: with no ClerkProvider the default below applies, so nothing calls Clerk
// hooks and the site simply renders its signed-out state.
export type Session = { signedIn: boolean; email: string | null; name: string | null; imageUrl: string | null; signOut: () => void };

export const SessionContext = createContext<Session>({ signedIn: false, email: null, name: null, imageUrl: null, signOut: () => {} });

export const useSession = () => useContext(SessionContext);

export function ClerkSessionBridge({ children }: { children: ReactNode }) {
  const { user, isLoaded } = useUser();
  const clerk = useClerk();
  const email = (isLoaded && user?.primaryEmailAddress?.emailAddress) || null;
  const name = user?.fullName || user?.firstName || null;
  const imageUrl = user?.hasImage ? user.imageUrl : null;
  const value = useMemo<Session>(() => ({ signedIn: !!email, email, name, imageUrl, signOut: () => { void clerk.signOut(); } }), [email, name, imageUrl, clerk]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

// The auth screens carry the site's bar and nothing else: the brand panel that filled the
// left half retired (George, 2026-09-08: "everything on the left can be thrown away").
export function AuthNav({ onBack }: { onBack: () => void }) {
  return (
    <nav className="nav">
      <div className="wrap inner">
        <button className="brand" onClick={onBack}><BrandLockup /></button>
      </div>
    </nav>
  );
}

export function ClerkAuth({ mode, theme, onBack }: { mode: 'signup' | 'signin'; theme: string; onBack: () => void }) {
  const [m, setM] = useState<'signup' | 'signin'>(mode);
  // key on mode+theme so Clerk remounts and re-reads the recomputed ember appearance.
  // Post-auth navigation — including the OAuth full-page redirect — is owned by
  // ClerkProvider's signUp/signInForceRedirectUrl (→ the download "you're in" screen),
  // so it survives the round-trip back from GitHub/Google instead of landing on /.
  const appearance = clerkAppearance();
  return (
    <><AuthNav onBack={onBack} />
    <div className="auth">
      <div className="authform">
        <div className="clerkmount">
          {m === 'signup'
            ? <SignUp key={`up-${theme}`} routing="virtual" appearance={appearance} />
            : <SignIn key={`in-${theme}`} routing="virtual" appearance={appearance} />}
        </div>
        <div className="authswitch">
          {m === 'signup' ? 'Already have an account? ' : 'New to neuramesh? '}
          <button onClick={() => setM(m === 'signup' ? 'signin' : 'signup')}>{m === 'signup' ? 'Sign in' : 'Create account'}</button>
        </div>
      </div>
    </div></>
  );
}

// neuramesh frames an account as a workspace; name fields are hidden via CSS (.cl-formFieldRow__name).
export const CLERK_LOCALIZATION = { signUp: { start: { title: 'Create your workspace' } } };

// After auth (email *or* the OAuth full-page redirect), land on the /welcome
// post-signup screen (account-ready chip + what-happens-next), not /downloads.
export const POST_AUTH_URL = '/welcome';
