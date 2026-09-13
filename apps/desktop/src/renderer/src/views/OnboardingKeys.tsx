// The wizard's Keys step — split out of views/Onboarding.tsx (its 250-line cap), matching
// OnboardingPacks / OnboardingCrew / OnboardingMachine / OnboardingLaunch.
//
// The browser's difference is real, not cosmetic: there is no disk on this side to probe for
// a vendor CLI, so a subscription cannot be VERIFIED here. Choosing it records the intent and
// the cloud machine completes the sign-in through its own terminal after launch — which is
// also why the platform never handles the vendor login (the Anthropic rail). Cards say so
// rather than reporting a detection that could never happen.
// The skip lane (starter-brain round, 2026-08-28) is the round's whole point: a door, not an
// escape hatch. Two lines, value first, styled as the one distinguished object on the step — an
// offer rather than a consolation, so choosing it reads as a choice and not a failure to
// configure. It carries NO per-reply price (George, mockup r2): a per-message rate makes a free
// product feel like a taxi meter, and it is a number nobody can act on in the moment. The BALANCE
// is the honest unit, and it comes from SIGNUP_GRANT_CREDITS so the copy can never drift from the
// grant the server actually writes.
//
// BOTH CLIENTS. This was web-only, on the reasoning that "the starter brain is the browser
// client's story" — true when written, and false since the daemon grew its own starter lane
// (orchturn's geminiDispatch → control-api's metered proxy). A Mac with no CLI installed runs the
// house brain exactly as a browser tab does, so hiding this door there left those users unable to
// finish onboarding at all.
//
// EXCEPT ON A LOCAL CONNECTION (the source-release round, review F13, artboard G): Local mode has no
// credits and no metered proxy, so the door would open onto nothing. There the step is "Connect a
// brain", a provider is required, and the door is ABSENT — the rule is keys-step.ts, shared with
// the Continue button's gate in Onboarding.tsx.
import { BRAIN_PROVIDERS } from '../brain/providers';
import { IS_WEB } from '../lib/platform';
import { ProviderCard, type ProviderMode } from '../settings/providerui';
import { SIGNUP_GRANT_CREDITS } from '@neuramesh/shared';
import { KEYS_LOCAL_COPY, keysStepFor } from './keys-step';
import { type ProviderId, type ProviderStatus } from '../bridge/rows-infra';

type ProviderEntry = { provider: ProviderId; mode: 'none' | 'subscription' | 'apikey'; key: string };

export function OnboardingKeys({ providers, setProviders, detection, setDetection, setupOpen, setSetupOpen, providerReady, anyReady, onStarter, local = false }: {
  providers: ProviderEntry[];
  setProviders: React.Dispatch<React.SetStateAction<ProviderEntry[]>>;
  detection: Record<ProviderId, ProviderStatus> | null;
  setDetection: (d: Record<ProviderId, ProviderStatus> | null) => void;
  setupOpen: ProviderId | null;
  setSetupOpen: (p: ProviderId | null) => void;
  providerReady: (p: ProviderEntry) => boolean;
  anyReady: boolean;
  /** take the house brain and move on — seats the platform pack, then advances the wizard */
  onStarter: () => void;
  /** a local connection (main/connections.ts): no starter door, a provider required */
  local?: boolean;
}) {
  const step = keysStepFor({ local, anyReady });
  return (
    <>
      <h1 className="obtitle">{local ? KEYS_LOCAL_COPY.title : 'Bring your own brain'}</h1>
      <p className="obsub">{local ? KEYS_LOCAL_COPY.sub : IS_WEB
        ? 'Reuse the subscriptions you already pay for, or add an API key. You sign in on your cloud machine after launch, so NeuraMesh never handles your vendor login.'
        : 'Reuse the subscriptions you already pay for, or add an API key. Your keys stay on this machine.'}</p>
      <div className="obbrains">
        {BRAIN_PROVIDERS.map((bp) => {
          const p = providers.find((x) => x.provider === bp.id)!;
          const set = (patch: Partial<{ mode: ProviderMode; key: string }>) =>
            setProviders((ps) => ps.map((x) => (x.provider === bp.id ? { ...x, ...patch } : x)));
          return (
            <ProviderCard
              key={bp.id}
              bp={bp}
              status={detection?.[bp.id]}
              probing={!detection}
              mode={p.mode}
              keyValue={p.key}
              ready={providerReady(p)}
              setupOpen={setupOpen === bp.id}
              onMode={(mode) => set({ mode })}
              onKey={(key) => set({ key })}
              onToggleSetup={() => setSetupOpen(setupOpen === bp.id ? null : bp.id)}
              onRefresh={() => setDetection(null)}
            />
          );
        })}
      </div>
      {step.door && (
        <div className="obskip">
          <b>Or start now. Your agents are ready.</b>
          <span className="obskipsub">Every workspace comes with credits. Connect your own brain later.</span>
          <div className="obskipact">
            <button type="button" className="btn primary" onClick={onStarter}>Start with {SIGNUP_GRANT_CREDITS} credits →</button>
          </div>
        </div>
      )}
    </>
  );
}
