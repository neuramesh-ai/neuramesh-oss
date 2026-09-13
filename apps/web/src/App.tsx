import { useEffect, useState } from 'react';
import { Analytics } from '@vercel/analytics/react';
import { ClerkProvider } from '@clerk/clerk-react';

import { track } from './analytics';
import { CLERK_LOCALIZATION, CLERK_PK, ClerkAuth, ClerkSessionBridge, POST_AUTH_URL } from './auth';
import { CreateAccount, DesktopSignIn, JoinPage, PostSignup } from './account';
import { BillingReturnPage } from './billing-return';
import { Footer, Nav, type Nav as NavFn, type Screen, useScrollReveal } from './shell';
import { Hero, Stage } from './hero';
import { Experts, ProofStrip, WhyFast } from './fast';
import { Loop, Rooms } from './rooms';
import { Crew, Rules } from './crew';
import { Close, Pricing, Surfaces } from './surfaces';
import { Compute } from './compute';
import { DownloadsPage } from './downloads';
import { applyPageMeta } from './seo';
import { PrivacyPage, TermsPage } from './legal';
import { SupportPage } from './support';
import { ModelBenchmarksPage } from './bench';
import { ProPage } from './pro';

const PATH_FOR: Record<Screen, string> = { landing: '/', join: '/join', signup: '/signup', downloads: '/downloads', welcome: '/welcome', terms: '/terms', privacy: '/privacy', support: '/support', 'billing-success': '/billing/success', 'billing-cancel': '/billing/cancel', 'billing-portal': '/billing/portal-return', 'desktop-signin': '/desktop-signin', 'model-benchmarks': '/model-benchmarks', pro: '/pro' };
function screenFromLocation(): Screen {
  if (typeof location === 'undefined') return 'landing';
  const path = location.pathname.replace(/\/+$/, '') || '/';
  if (path === '/join') return 'join';
  if (path === '/model-benchmarks') return 'model-benchmarks';
  if (path === '/downloads') return 'downloads';
  if (path === '/welcome') return 'welcome';
  if (path === '/signup') return 'signup';
  if (path === '/terms') return 'terms';
  if (path === '/privacy') return 'privacy';
  if (path === '/support') return 'support';
  if (path === '/billing/success') return 'billing-success';
  if (path === '/billing/cancel') return 'billing-cancel';
  if (path === '/billing/portal-return') return 'billing-portal';
  if (path === '/desktop-signin') return 'desktop-signin';
  if (path === '/pro') return 'pro';
  const params = new URLSearchParams(location.search);
  const s = params.get('screen');
  if (s === 'signup') return 'signup';
  if (s === 'download' || s === 'downloads') return params.get('account') === 'ready' ? 'welcome' : 'downloads';
  if (s === 'billing-success') return 'billing-success';
  if (s === 'billing-cancel') return 'billing-cancel';
  if (s === 'billing-portal') return 'billing-portal';
  return 'landing';
}

// Landing = the Foundry page (docs/designs/foundry-landing-fast-to-done.md): hero → the product
// frame → the proof strip → why fast works → vetted experts → the rooms → the loop → the crew →
// the rules → surfaces → shared compute → pricing → the close. Bands scroll free (the R4 deck's snap and its
// guide retired with it). Wrapped in its own component so the scroll-reveal observer (re)binds
// on every return to the landing screen, and so [data-reveal] elements exist when it scans.
function Landing({ nav }: { nav: NavFn }) {
  useScrollReveal();
  return (
    <>
      <Nav nav={nav} />
      <Hero nav={nav} />
      <Stage />
      <ProofStrip />
      <WhyFast />
      <Experts nav={nav} />
      <Rooms />
      <Loop />
      <Crew />
      <Rules />
      <Surfaces />
      <Compute />
      <Pricing nav={nav} />
      <Close nav={nav} />
      <Footer />
    </>
  );
}

function AppRouter() {
  const [screen, setScreen] = useState<Screen>(screenFromLocation);
  // Theme follows the OS — the inline script in index.html sets data-bt before paint (a
  // ?bt=dark|light URL param overrides, for screenshots/demos). We mirror it into state so the
  // Clerk widget re-keys when the OS flips; there is no manual switcher.
  const [theme, setTheme] = useState<'dark' | 'light'>(() =>
    typeof document !== 'undefined' && document.documentElement.getAttribute('data-bt') === 'dark' ? 'dark' : 'light');
  useEffect(() => {
    const forced = new URLSearchParams(location.search).get('bt');
    if (forced === 'dark' || forced === 'light' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => { const t = mq.matches ? 'dark' : 'light'; document.documentElement.setAttribute('data-bt', t); setTheme(t); };
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);
  const nav: NavFn = (to) => {
    setScreen(to);
    if (typeof history !== 'undefined') history.pushState({}, '', PATH_FOR[to]);
    window.scrollTo(0, 0);
  };
  const back = () => nav('landing');
  // Funnel top: page_view for every screen that can emit a download_click (landing,
  // /downloads, and /welcome — which renders the same download component), so click/view
  // ratios always have a denominator. Fires on first load and on every SPA navigation.
  useEffect(() => {
    if (screen === 'landing' || screen === 'downloads' || screen === 'welcome') track('page_view', { screen });
  }, [screen]);
  // The tab title, description, canonical and robots follow the screen (src/seo.ts).
  useEffect(() => { applyPageMeta(screen); }, [screen]);
  useEffect(() => {
    const onPop = () => setScreen(screenFromLocation());
    window.addEventListener('popstate', onPop);
    const id = typeof location !== 'undefined' ? location.hash.slice(1) : '';
    if (id) requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView());
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  if (screen === 'signup') {
    return CLERK_PK
      ? <ClerkAuth mode="signup" theme={theme} onBack={back} />
      : <CreateAccount onBack={back} onCreated={() => nav('welcome')} />;
  }
  if (screen === 'join') return <JoinPage theme={theme} onBack={back} />;
  if (screen === 'model-benchmarks') return <ModelBenchmarksPage onBack={back} />;
  if (screen === 'downloads') return <DownloadsPage onBack={back} />;
  if (screen === 'welcome') return <PostSignup onBack={back} />;
  if (screen === 'terms') return <TermsPage onBack={back} />;
  if (screen === 'privacy') return <PrivacyPage onBack={back} />;
  if (screen === 'support') return <SupportPage onBack={back} />;
  if (screen === 'billing-success') return <BillingReturnPage kind="success" onBack={back} />;
  if (screen === 'billing-cancel') return <BillingReturnPage kind="cancel" onBack={back} />;
  if (screen === 'billing-portal') return <BillingReturnPage kind="portal" onBack={back} />;
  if (screen === 'desktop-signin') return <DesktopSignIn theme={theme} onBack={back} />;
  if (screen === 'pro') return <ProPage theme={theme} onBack={back} />;
  return <Landing nav={nav} />;
}

// Vercel Web Analytics rides at the root so every screen counts: cookieless visitor counts +
// Web Vitals in the Vercel dashboard (traffic/perf lens), complementing the PostHog funnel
// beacon (event lens). Tracks SPA route changes via the History API our nav() already uses;
// no-ops off Vercel, so local dev and file:// captures stay silent.
export function App() {
  if (CLERK_PK) {
    // The Google/GitHub OAuth full-page redirect is routed by ClerkProvider's
    // sign-in/sign-up ForceRedirectUrl — with routing="virtual" the per-<SignIn>
    // forceRedirectUrl does not survive the round-trip, so the provider value wins.
    // On a hand-off route (/desktop-signin, and /pro for Get Pro), pin BOTH provider redirects
    // back to it (carrying the ?nonce) so the browser returns here to run the token hand-off
    // instead of the marketing /welcome screen.
    const handoffPath = typeof location !== 'undefined' && (location.pathname === '/desktop-signin' || location.pathname === '/pro') ? location.pathname : null;
    const postAuthUrl = handoffPath ? `${handoffPath}${location.search}` : POST_AUTH_URL;
    return (
      <ClerkProvider
        publishableKey={CLERK_PK}
        localization={CLERK_LOCALIZATION}
        signUpForceRedirectUrl={postAuthUrl}
        signInForceRedirectUrl={postAuthUrl}
        afterSignOutUrl="/"
      >
        <ClerkSessionBridge>
          <AppRouter />
          <Analytics />
        </ClerkSessionBridge>
      </ClerkProvider>
    );
  }
  return (
    <>
      <AppRouter />
      <Analytics />
    </>
  );
}
