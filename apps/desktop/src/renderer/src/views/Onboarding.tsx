// Onboarding — the first run: name a workspace, connect a provider, pick a brain, and
// meet the crew you start with. Extracted from App.tsx (track A2).
import { DEFAULT_CHANNELS, DEFAULT_TEAM } from '../lib/defaults';
import { MODEL_GROUPS } from '../lib/modelcatalog';
import { STARTER_MODEL, STARTER_PACK_ID, defaultDescription, defaultPackForProviders, isPackActivatable, packModelForRole, type AgentRole, type Provider } from '@neuramesh/shared';
import { Wordmark } from '../brand';
import { modelServiceable, runtimeForModel } from '../lib/models';
import { nm as nmBridge } from '../bridge/nm';
import { persona } from '../lib/persona';
import { slugifyName } from '../lib/text';
import { useEffect, useMemo, useRef, useState } from 'react';
import { type ProviderId, type ProviderStatus } from '../bridge/rows-infra';
import { randomWorkspaceName } from './onboarding-parts';
import { OnboardingPacks } from './OnboardingPacks';
import { OnboardingCrew } from './OnboardingCrew';
import { OnboardingMachine } from './OnboardingMachine';
import { OnboardingLaunch } from './OnboardingLaunch';
import { OnboardingKeys } from './OnboardingKeys';
import { IS_WEB } from '../lib/platform';
import { keysStepFor } from './keys-step';
import { onboardOrderFor, type StepId } from './onboard-order';
import { workspaceHost } from '../weburl';

// Imported bindings lose control-flow narrowing inside closures, so re-bind (same as App.tsx).
const nm = nmBridge;

export const ONBOARD_STEPS = ['Machine', 'Keys', 'Workspace', 'Team', 'Launch'] as const;

// The five steps are the same on every client; their ORDER is not (cloud-first round 4,
// approved 2026-08-28). Desktop leads with Machine because this Mac must connect before the
// Keys step can probe it for CLI logins. The browser leads with WORKSPACE because a cloud
// machine is provisioned against a workspace id — so the id has to exist before there is a
// machine step to show at all.
// A workspace's address is where it lives ON THE WEB — the app's host, not the marketing
// apex (which serves the deck, and would swallow a slug into its SPA catch-all). The same on
// every client: a workspace has one address whichever client you opened it from. It derives from
// the connection's web url (weburl.ts), not from a literal here.

// The Keys step stops being a wall (starter-brain round, 2026-08-28). A browser user with no
// subscription and no API key can now finish the wizard: `defaultPackForProviders([])` answers
// with the platform pack, so there is always a brain to launch on, and the Keys step's Continue
// no longer asks for a credential first. Two things that go with that, both load-bearing:
//
//   · the LAUNCH guard used to require `anyReady` too, and its else-branch reveals the assembled
//     team — so un-gating Continue alone would have shown "Team assembled" over a workspace that
//     was never created. The guard had to move in the same edit, not a later one.
//   · WEB ONLY. Desktop's Keys step probes this Mac for vendor CLIs and its whole first-run
//     promise is that the keys stay here; the starter lane is served by the platform's metered
//     proxy, which is the browser's story. `IS_WEB` gates the affordance and the gate together,
//     so desktop keeps the exact wizard it had.

// The Team step's picker when NOTHING is connected: the house brain, under the house name. It is
// a real group rather than an empty list because "no provider" is no longer "no choice".
const STARTER_GROUPS = [{ providerId: 'gemini' as ProviderId, provider: 'NeuraMesh', runtime: 'gemini', models: [STARTER_MODEL] }];

// the two orders and the resume rule live in onboard-order.ts, so the rule is a unit test
const LABEL: Record<StepId, string> = { machine: 'Machine', keys: 'Keys', workspace: 'Workspace', team: 'Team', launch: 'Launch' };

// 5-step onboarding (handoff 07-onboard-machine + 01–05-onboard.png): a guarded linear
// flow ending in the fan-out reveal. Preserves the nm.onboard backend contract, called at
// Launch; the browser additionally mints its workspace at its own first step.
export function Onboarding({ machineName, onDone, resumeWorkspaceId, resumeWorkspaceName, local = false }: {
  machineName: string;
  onDone: (orchestrator: string, goal: string) => void;
  /** an existing-but-unfinished workspace to carry on with, rather than mint a second one. set
   *  when the wizard was abandoned after its first step — see the boot rule in wsident.ts. */
  resumeWorkspaceId?: string;
  /** that workspace's real name. The steps after the skipped name step show it, so a resume must
   *  not show a random suggestion there (it read "Crimson Atelier" for a workspace with another name) */
  resumeWorkspaceName?: string;
  /** a local connection (main/connections.ts): the Keys step has no starter door and requires a provider (artboard G) */
  local?: boolean;
}) {
  // Resuming skips the workspace step, because its whole job is already done — re-running it
  // would ask for a name and mint a duplicate. The browser (which mints at its FIRST step) keeps
  // the step in its order and starts at step 2. The desktop (which mints at LAUNCH) drops the step
  // from its order (onboard-order.ts): the first hosted sign-in creates the workspace on the server
  // (U1b), so the steps before it are still to do and the Launch step ADOPTS the workspace (nm.onboard
  // with workspaceId) instead of minting a second one beside it.
  const ORDER = onboardOrderFor({ web: IS_WEB, resume: !!resumeWorkspaceId });
  const [step, setStep] = useState(() => (resumeWorkspaceId && ORDER[0] === 'workspace' ? 2 : 1)); // 1-based, so the ring and the harness driver read the same
  const at: StepId = ORDER[step - 1]!;
  const isLast = step === ORDER.length;
  const [machineConnected, setMachineConnected] = useState(false);
  // the browser's workspace exists from its first step; the id is what its cloud machine is
  // provisioned against. null on desktop, where nm.onboard still creates it at Launch.
  // seeded when resuming: the guard against minting a second workspace is a REF, so a refresh
  // wiped it — which is exactly how an abandoned wizard could have created another one.
  const wsIdRef = useRef<string | null>(resumeWorkspaceId ?? null);
  const [creatingWs, setCreatingWs] = useState(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const initialName = useMemo(() => (resumeWorkspaceId && resumeWorkspaceName?.trim()) || randomWorkspaceName(), []);
  const [name, setName] = useState(initialName);
  const [slug, setSlug] = useState(() => slugifyName(initialName));
  const [slugEdited, setSlugEdited] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const [providers, setProviders] = useState<Array<{ provider: ProviderId; mode: 'none' | 'subscription' | 'apikey'; key: string }>>([
    { provider: 'anthropic', mode: 'none', key: '' },
    { provider: 'openai', mode: 'none', key: '' },
    { provider: 'gemini', mode: 'none', key: '' },
  ]);
  const [detection, setDetection] = useState<Record<ProviderId, ProviderStatus> | null>(null); // null = still probing
  const [setupOpen, setSetupOpen] = useState<ProviderId | null>(null); // which provider's setup how-to is expanded
  // The starter crew the workspace launches with — orchestrator + the skill-matched pod. Each runs
  // the brain its ROLE draws from the active pack (seeded on the Team step); the human retunes any
  // model / face / name there. Replaces the single "first agent" the old flow named in the Workspace step.
  const [crew, setCrew] = useState<Array<{ role: AgentRole; name: string; emoji: string; model: string }>>(() =>
    [{ role: 'orchestrator' as AgentRole, name: 'rex' }, ...DEFAULT_TEAM.map((a) => ({ role: a.role as AgentRole, name: a.name }))]
      .map((c) => ({ ...c, emoji: persona(c.name).emoji, model: '' })),
  );
  const setCrewAt = (i: number, patch: Partial<{ name: string; emoji: string; model: string }>) =>
    setCrew((cw) => cw.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const [pickedPack, setPickedPack] = useState<string | null>(null); // explicit pack choice in the Workspace step (else the recommended)
  const [packsExpanded, setPacksExpanded] = useState(false); // the pack picker collapses to a one-line summary once chosen, so "Your first agent" stays in view
  const [err, setErr] = useState('');
  const [ready, setReady] = useState(false); // Launch step: true once the workspace + crew are created
  // the workspace address tracks the name until the human edits it — then it's theirs to set
  const onName = (v: string) => { setName(v); if (!slugEdited) setSlug(slugifyName(v)); };
  const onSlug = (v: string) => { setSlug(v.toLowerCase().replace(/[^a-z0-9-]/g, '-')); setSlugEdited(true); };
  const finalSlug = slugifyName(slug);
  // A provider is "ready" if it has a detected subscription (subscription mode) or a key.
  // a browser cannot verify a vendor login — there is no CLI on this side to ask. choosing
  // 'subscription' here records the INTENT; the cloud machine completes the sign-in through
  // its terminal after launch. gating on `authed` (which can never be true on web) would
  // strand the wizard on this step with Continue permanently disabled.
  const providerReady = (p: { provider: ProviderId; mode: string; key: string }): boolean =>
    p.mode === 'subscription' ? (IS_WEB || !!detection?.[p.provider]?.authed) : p.mode === 'apikey' && p.key.trim().length > 0;
  const anyReady = providers.some(providerReady);
  // Only offer orchestrator models for providers the human actually configured in Keys, so the
  // pick always has a credential behind it. Grows as they add providers.
  const readyProviderIds = new Set(providers.filter(providerReady).map((p) => p.provider));
  // …falling back to the house brain, which is the one model a workspace can pick with nothing
  // connected. Without this the Team step's pickers open on "No models match." — a dead dropdown
  // on the exact path the starter lane creates.
  const modelGroups = MODEL_GROUPS.filter((g) => readyProviderIds.has(g.providerId));
  const crewGroups = modelGroups.length ? modelGroups : STARTER_GROUPS;
  // The pack drives every agent's brain. It defaults to the provider-aware recommendation for the
  // configured providers (the platform pack when none are ready), but the human can pick another
  // activatable pack in the Workspace step.
  const enabledList = [...readyProviderIds] as Provider[];
  const recommendedPack = defaultPackForProviders(enabledList);
  const activePack = pickedPack && isPackActivatable(pickedPack, enabledList) ? pickedPack : recommendedPack;
  // picking a pack re-assigns every crew member's brain to that pack's per-role model (the human can
  // still retune any of them on the Team step).
  const choosePack = (id: string) => { setPickedPack(id); setCrew((cw) => cw.map((c) => { const m = packModelForRole(id, c.role); return m ? { ...c, model: m } : c; })); setPacksExpanded(false); };
  const orchestrator = crew.find((c) => c.role === 'orchestrator') ?? crew[0]!;
  const agent = orchestrator.name.trim().toLowerCase() || 'rex';

  // Continue. On the browser's WORKSPACE step this is where the workspace is actually born:
  // the id it returns is what the fleet provisions the cloud machine against, so the machine
  // step that follows has something real to show. Guarded by the ref — Back then Continue
  // must never mint a second workspace. Desktop advances plainly; nm.onboard still creates
  // its workspace at Launch.
  const advance = async (): Promise<void> => {
    if (IS_WEB && at === 'workspace' && !wsIdRef.current) {
      setCreatingWs(true);
      setErr('');
      try {
        const res = await nm?.workspaceCreate({ name: name.trim() || machineName, slug: finalSlug || 'workspace' });
        if (!res?.workspaceId) throw new Error('workspace creation returned no id');
        wsIdRef.current = res.workspaceId;
      } catch (e) {
        setErr(e instanceof Error ? e.message.slice(0, 140) : 'could not create the workspace');
        return;
      } finally {
        setCreatingWs(false);
      }
    }
    setStep((n) => n + 1);
  };

  // Launch: register the workspace + crew once on arrival, then reveal the assembled team. Guarded
  // so a Back/forward bounce never creates the workspace twice.
  const launchedRef = useRef(false);
  useEffect(() => {
    if (!isLast) return;
    let alive = true;
    (async () => {
      // no `anyReady` here any more: a zero-provider workspace is a real workspace now, and
      // `activePack` always resolves to something (the platform pack when nothing is connected).
      // a resumed workspace has its slug already: the guard is the id, not the (absent) step's input
      if (nm && (wsIdRef.current || finalSlug.length >= 2) && !launchedRef.current) {
        launchedRef.current = true;
        try {
          const readyProviders = providers
            .filter((p) => providerReady(p))
            .map((p) => ({ provider: p.provider, mode: p.mode === 'subscription' ? ('subscription' as const) : ('apikey' as const), key: p.key.trim() }));
          // the starter crew exactly as reviewed on the Team step — names, faces, and each agent's
          // pack-seeded (or human-retuned) brain. Orchestrator seeds all default rooms; the pod seeds
          // dev + general (research/marketing are opt-in). The curator is host-registered with the
          // pack's curator brain (see sync.ts).
          const fallbackModel = (activePack ? packModelForRole(activePack, 'orchestrator') : null) || 'claude-opus-4-8';
          await nm.onboard({
            // the resumed workspace (the browser's first step, or the server's first-sign-in one):
            // the handler adopts it and never creates a second (main/sync/onboard-target.ts)
            workspaceId: wsIdRef.current ?? undefined,
            name: name.trim() || machineName,
            slug: finalSlug || 'workspace',
            providers: readyProviders,
            activeModelPack: activePack ?? undefined,
            agents: crew.map((c) => {
              const model = c.model || (activePack ? packModelForRole(activePack, c.role) : null) || fallbackModel;
              // the starter crew ships DESCRIBED (0110). The wizard creates iris and bosun
              // directly, so the boot seeds skip them as "already has a designer/shipper" and
              // their seed text never applied — a brand-new workspace opened with every agent's
              // description blank, exactly like an upgraded one (founder report).
              return { name: c.name.trim().toLowerCase() || c.role, role: c.role, model, runtime: runtimeForModel(model), emoji: c.emoji, ...(defaultDescription(c.role) ? { description: defaultDescription(c.role)! } : {}), channels: c.role === 'orchestrator' ? [...DEFAULT_CHANNELS] : ['general', 'build'] };
            }),
          });
          if (alive) setReady(true);
        } catch (e) {
          launchedRef.current = false; // let them retry on re-entry
          if (alive) setErr(e instanceof Error ? e.message.replace(/^Error invoking remote method.*?: Error: /, '').slice(0, 120) : 'setup failed');
        }
      } else if (alive) {
        setReady(true); // already created on a prior visit — just reveal the team
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // Step 1: this Mac is home base and registers itself automatically — so on arrival we just
  // run the connect handshake (a short beat, plus a best-effort daemon status check) and unlock
  // Continue once it's online. The status dot pulses while it's connecting.
  useEffect(() => {
    // desktop only: the browser has no local daemon to hand-shake with
    if (at !== 'machine' || machineConnected || IS_WEB) return;
    let alive = true;
    const started = Date.now();
    void (async () => {
      try { await nm?.status(); } catch { /* daemon still coming up — connect anyway */ }
      const beat = Math.max(0, 1000 - (Date.now() - started));
      window.setTimeout(() => { if (alive) setMachineConnected(true); }, beat);
    })();
    return () => { alive = false; };
  }, [step, machineConnected]);

  // Step 2: probe the machine for installed provider CLIs + existing subscription logins,
  // then default each detected provider to subscription mode (prefer the user's subscription).
  useEffect(() => {
    if (at !== 'keys' || detection) return;
    let alive = true;
    void nm?.detectProviders().then((d) => {
      if (!alive || !d) return;
      setDetection(d);
      setProviders((ps) => ps.map((p) => (p.mode === 'none' && d[p.provider]?.authed ? { ...p, mode: 'subscription' } : p)));
      setSetupOpen((s) => (s && d[s]?.authed ? null : s)); // a freshly signed-in provider needs no how-to
    }).catch(() => {
      if (alive) setDetection({ anthropic: { installed: true, authed: false, method: null }, openai: { installed: false, authed: false, method: null }, gemini: { installed: false, authed: false, method: null } });
    });
    return () => { alive = false; };
  }, [step, detection]);

  // Entering Workspace: focus the name field and select the suggested name so it's one
  // keystroke to replace, or a click to tweak.
  useEffect(() => {
    if (at !== 'workspace') return;
    const el = nameRef.current;
    if (el) { el.focus(); el.select(); }
  }, [step]);

  // Entering Workspace or Team: seed each crew member's brain from the active pack's per-role model,
  // keeping any model the human already set that's backed by a configured provider. Seeding on the
  // Workspace step (3) means the crew already has its brains by the time the Team step (4) renders.
  useEffect(() => {
    if (at !== 'workspace' && at !== 'team') return;
    setCrew((cw) => cw.map((c) => {
      // the house brain is serviceable with nothing connected, so it must not be re-seeded
      if (c.model && modelServiceable(c.model, readyProviderIds)) return c;
      const m = (activePack ? packModelForRole(activePack, c.role) : null) ?? modelGroups[0]?.models[0] ?? '';
      return m ? { ...c, model: m } : c;
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // the browser's machine step never blocks: provisioning started at the workspace step and
  // the Launch step absorbs whatever is left (round 4). desktop still gates on the handshake.
  const canContinue = creatingWs ? false
    : at === 'machine' ? (IS_WEB || machineConnected)
    // KEYS IS NEVER A GATE. It was `IS_WEB || anyReady`, which blocked a desktop user with no CLI
    // installed from finishing onboarding at all — for a brain that needs nothing installed. The
    // starter lane lives in the DAEMON (orchturn's geminiDispatch → the metered proxy), so it
    // serves a Mac exactly as it serves a browser; only the un-gating was web-only.
    // …on a CLOUD connection. A local one has no starter brain, so a provider is required there (keys-step.ts).
    : at === 'keys' ? keysStepFor({ local, anyReady }).canContinue
    : at === 'workspace' ? finalSlug.length >= 2
    : at === 'team' ? crew.every((c) => c.name.trim().length >= 1 && !!c.model)
    : true;

  return (
    <div className="obwrap">
      <div className="obtopbar">
        <Wordmark size={17} />
        {/* the step ring: a solid oak arc marks progress, a faint dashed halo spins
            forever — the wizard's heartbeat. 103.7 = 2π·16.5, the arc's circumference. */}
        <div className="obprog" role="progressbar" aria-valuemin={1} aria-valuemax={ORDER.length} aria-valuenow={step} aria-label={`Step ${step} of ${ORDER.length}: ${LABEL[at]}`}>
          <span className="obring" style={{ '--p': step / ORDER.length } as React.CSSProperties}>
            <svg viewBox="0 0 40 40" width="40" height="40" aria-hidden>
              <circle className="obringtrack" cx="20" cy="20" r="16.5" />
              <circle className="obringspin" cx="20" cy="20" r="16.5" />
              <circle className="obringarc" cx="20" cy="20" r="16.5" />
            </svg>
            <b>{step}<i>/{ORDER.length}</i></b>
          </span>
          <span className="obprogname">{LABEL[at]}</span>
        </div>
      </div>
      <div className={`obbody${isLast ? ' obbodycenter' : ''}`}>
        <div className="obeyebrow">{at === 'team' ? 'Your starting team' : isLast ? (ready ? 'Team assembled' : 'The crew assembles') : `Step ${step} of ${ORDER.length}`}</div>

        {at === 'machine' && (
          <>
            <OnboardingMachine machineName={machineName} connected={machineConnected} workspaceName={name.trim()} provisioned={!!wsIdRef.current} />
          </>
        )}

        {at === 'keys' && (
          <OnboardingKeys providers={providers} setProviders={setProviders} detection={detection} setDetection={setDetection}
            setupOpen={setupOpen} setSetupOpen={setSetupOpen} providerReady={providerReady} anyReady={anyReady} local={local}
            onStarter={() => { choosePack(STARTER_PACK_ID); void advance(); }} />
        )}

        {at === 'workspace' && (
          <>
            <h1 className="obtitle">Create your workspace</h1>
            <p className="obsub">Name your workspace and pick its address.</p>
            <input ref={nameRef} placeholder="Workspace name, for example Acme Robotics" value={name} onChange={(e) => onName(e.target.value)} autoFocus />
            <label className="obslug">
              {!local && <span className="obslugpre">{workspaceHost()}</span>}
              <input className="obsluginput" value={slug} onChange={(e) => onSlug(e.target.value)} placeholder="workspace" spellCheck={false} />
            </label>
            <div className="obhint" style={{ paddingLeft: 0 }}>Edit the address freely · seeds #general #build #research #marketing</div>
        {anyReady && activePack && (
          <OnboardingPacks activePack={activePack} packsExpanded={packsExpanded} setPacksExpanded={setPacksExpanded}
            choosePack={choosePack} enabledList={enabledList} recommendedPack={recommendedPack} setStep={setStep} />
        )}
          </>
        )}

        {at === 'team' && (
          <OnboardingCrew crew={crew} setCrewAt={setCrewAt} activePack={activePack} modelGroups={crewGroups} />
        )}

        {isLast && <OnboardingLaunch name={name} crew={crew} ready={ready} err={err} />}

        <div className={`obnav${isLast ? ' obnavcenter' : ''}`}>
          {step > 1 && !isLast && <button className="btn" onClick={() => setStep((s) => s - 1)}>← Back</button>}
          {isLast && err && <button className="btn" onClick={() => { launchedRef.current = false; setErr(''); setReady(false); setStep(ORDER.length - 1); }}>← Back</button>}
          {!isLast && <span style={{ flex: 1 }} />}
          {!isLast && <button className={`btn ${at === 'keys' ? keysStepFor({ local, anyReady }).continueKind : 'primary'}`} disabled={!canContinue} onClick={() => void advance()}>{creatingWs ? 'Please wait…' : 'Continue →'}</button>}
          {isLast && <button className={`btn primary obcta${ready ? '' : ' assembling'}`} disabled={!ready} onClick={() => onDone(agent, '')}>{ready ? `Meet @${agent} and start your first fan-out →` : 'Please wait…'}</button>}
        </div>
      </div>
    </div>
  );
}
