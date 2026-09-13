// The page Stripe returns a buyer to — success, cancel, and the billing-portal round trip.
//
// Extracted from account.tsx when the success screen learned to tell a CREDIT PACK from a
// subscription (2026-09-01): the two returns say different things, offer different next steps,
// and the branching earned its own file rather than another sixty lines in the account screen.
import { useEffect, useState } from 'react';
import { useClerk, useUser } from '@clerk/clerk-react';
import { Footer } from './shell';
import { DlNav } from './downloads';
import { CLERK_PK } from './auth';
import { completeDesktopHandoff } from './pro';
import { takeNonce } from './pro-handoff';

// hq is the app; this page is the marketing site. A buyer returning from Stripe is on the
// wrong host to be shown anything about their account, so the confirmation's job is to hand
// them back — see viewFromUrl in wtabs/guests.tsx for the half that reads `?view=credits`.
const HQ = 'https://hq.neuramesh.app';

/** how many credits this return is confirming, from Stripe's own success_url. */
function creditsFromUrl(): number | null {
  try {
    const n = Number(new URLSearchParams(window.location.search).get('credits'));
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

// The desktop's half of Get Pro (pro.tsx): /pro stashed the app's nonce before Stripe, and the
// paid return finishes the sign-in here, so the app learns of the session only once Pro is paid.
// Mounted only with Clerk configured (the hooks need the provider).
const HANDOFF_COPY = {
  busy: 'The app signs in now…',
  done: 'The app is signed in. Go back to neuramesh.',
  fail: 'The app sign-in did not complete. Choose Get Pro in the app again.',
};

function DesktopHandoffFinish({ nonce }: { nonce: string }) {
  const { isSignedIn, isLoaded } = useUser();
  const clerk = useClerk();
  const [state, setState] = useState<'busy' | 'done' | 'fail'>('busy');
  const [detail, setDetail] = useState('');
  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) { setState('fail'); return; }
    void (async () => {
      try {
        const token = await clerk.session?.getToken();
        if (!token) throw new Error('no active session token');
        await completeDesktopHandoff(nonce, token);
        setState('done');
      } catch (e) {
        setDetail(e instanceof Error ? e.message : String(e));
        setState('fail');
      }
    })();
  }, [isLoaded, isSignedIn, clerk, nonce]);
  return <p className="billretnote">{state === 'fail' && detail ? `${HANDOFF_COPY.fail} (${detail})` : HANDOFF_COPY[state]}</p>;
}

export function BillingReturnPage({ kind, onBack }: { kind: 'success' | 'cancel' | 'portal'; onBack: () => void }) {
  // A CREDIT PACK IS NOT A SUBSCRIPTION. Both land here, and the page used to greet a $5
  // top-up with "You're on Cloud — your subscription is active", which is wrong twice: it
  // describes a plan the buyer may not have, and says nothing about what they actually bought.
  // Stripe already carries the answer in the success_url it was given (George, 2026-09-01).
  const credits = kind === 'success' ? creditsFromUrl() : null;
  // the app's nonce, once: finished on a paid Pro return, dropped on cancel (Pro did not happen,
  // so the app is not signed in), untouched by the portal round trip
  const [nonce] = useState<string | null>(() => {
    if (typeof sessionStorage === 'undefined') return null;
    if (kind === 'success' && !credits) return takeNonce(sessionStorage);
    if (kind === 'cancel') takeNonce(sessionStorage);
    return null;
  });
  const copy = {
    success: credits
      ? {
          ico: '🎉',
          title: <><span className="oak">{credits.toLocaleString('en-US')}</span> credits added</>,
          lead: 'They are in your workspace now and never expire. Your monthly grant spends first, so what you bought keeps.',
          note: 'Already on your balance. Open neuramesh to see it.',
        }
      : { ico: '🎉', title: <>You are on <span className="oak">Pro</span></>, lead: 'Your subscription is active. Every member gets a cloud machine. Invites, seats, and sync across devices are on.', note: 'Switch back to neuramesh and your Pro features are already on.' },
    cancel: { ico: '↩️', title: <>Checkout cancelled</>, lead: 'No charge was made. Choose Get Pro in the app, or on the pricing page, when you are ready.', note: 'Nothing on your account changed.' },
    portal: { ico: '✅', title: <>Billing updated</>, lead: 'Your changes sync to neuramesh in a moment. You can close this tab.', note: 'Switch back to neuramesh to see the update.' },
  }[kind];
  return (
    <>
      <DlNav onBack={onBack} />
      <section className="section billret">
        <div className="wrap billretwrap">
          <div className="billretico">{copy.ico}</div>
          <div className="seyebrow">Billing</div>
          <h1>{copy.title}</h1>
          <p className="lead">{copy.lead}</p>
          {/* ONE ACTION. This used to be `neuramesh://signin` — a DESKTOP protocol handler, which
              a web buyer has no registration for, so the browser swallowed the click and the only
              control on the page did nothing at all. A real https link to the app replaces it.
              No desktop deep link sits beside it: the desktop re-reads billing on window focus,
              so someone who bought from the app just switches back and it is already there. */}
          <div className="billretactions">
            {credits ? (
              <a className="btn primary big" href={`${HQ}/?view=credits`}>See your credits →</a>
            ) : (
              <a className="btn primary big" href={HQ}>Open neuramesh →</a>
            )}
          </div>
          <p className="billretnote">{copy.note}</p>
          {nonce && CLERK_PK ? <DesktopHandoffFinish nonce={nonce} /> : null}
        </div>
      </section>
      <Footer />
    </>
  );
}
