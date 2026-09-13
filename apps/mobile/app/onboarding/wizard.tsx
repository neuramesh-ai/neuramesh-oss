// THE WIZARD (S6, D16–D17, D20): the browser wizard, one screen per step, same order and same
// copy with "this phone" for "this tab". Workspace mints the id (the fleet provisions the machine
// against it) · Machine never blocks · Keys records intents and keys, or the starter door · Team
// names the crew on the pack's brains · Launch waits for the runner row and registers the crew on
// it, then hands you to New chat with the first send designated to that machine. The state and
// its rules live in @neuramesh/shared (onboarding-wizard.ts); this file renders and posts.
import {
  initialWizard, randomWorkspaceName, readyProviders, resolvePackName, seedCrew, setWizardCrewName, setWizardName, setWizardProvider, setWizardSlug, STARTER_PACK_ID,
  WIZARD_CHANNELS, WIZARD_LABEL, WIZARD_STEPS, wizardBack, wizardCanContinue, wizardNext, wizardPack, wizardStep, type WizardState, workspaceSlug,
} from '@neuramesh/shared';
import { useQuery } from '@powersync/react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../../src/auth';
import { Btn } from '../../src/kit';
import { clearResume, createWorkspace, errMsg, launchCrew, type LaunchProgress, readRunner, type RunnerRow, writeResume } from '../../src/onboard';
import { useTheme } from '../../src/theme';
import { F, R } from '../../src/type';
import { CrewCard, Reveal, Stats } from '../../src/wizard-crew';
import { Eyebrow, Field, Hint, MachineTile, ProviderRow, SlugField, Sub, Title, WizardNav, WizardTop } from '../../src/wizard-parts';
import { useWorkspace } from '../../src/workspace';

const HOST = 'hq.neuramesh.app/';
const FIRST_PROMPT = 'What can this workspace do?';

export default function Wizard() {
  const t = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ resume?: string; name?: string; slug?: string }>();
  const { setActive } = useWorkspace();
  const [s, setS] = useState<WizardState>(() => {
    // a resumed wizard carries the name and address the human already chose; a mark without them
    // (an older one) is filled from the API below rather than re-suggesting a name for a workspace that exists
    const base = initialWizard({ name: params.name?.trim() || randomWorkspaceName(), resumeWorkspaceId: params.resume ?? null });
    return seedCrew(params.resume && params.slug ? { ...base, slug: params.slug, slugEdited: true } : base);
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [runner, setRunner] = useState<RunnerRow | null>(null);
  const [progress, setProgress] = useState<LaunchProgress | null>(null);
  const [machineId, setMachineId] = useState<string | null>(null);
  const launchedRef = useRef(false);
  const step = wizardStep(s);
  const isLast = step === 'launch';
  const pack = wizardPack(s);
  const brain = resolvePackName(pack, []) ?? pack;
  // the replica has the workspace once its rooms are here — the moment New chat can address #general
  const { data: roomRows } = useQuery<{ n: number }>('select count(*) as n from channels where workspace_id = ?', [s.workspaceId ?? '']);
  const roomCount = roomRows?.[0]?.n ?? 0;
  const { data: general } = useQuery<{ id: string }>('select id from channels where workspace_id = ? and slug = ? limit 1', [s.workspaceId ?? '', 'general']);

  // a resumed wizard whose mark carried no name reads it back: the workspace exists, and its name is the server's
  useEffect(() => {
    if (!params.resume || params.name?.trim()) return;
    let alive = true;
    void api.workspaces().then((r) => {
      const w = r.workspaces.find((x) => x.id === params.resume);
      if (alive && w) setS((x) => ({ ...x, name: w.name, slug: w.slug || x.slug, slugEdited: true }));
    }).catch(() => { /* offline: the suggested name stands until the next launch */ });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Continue. On the Workspace step this is where the workspace is actually born; the resume mark
  // is written before the state moves so a relaunch mid-wizard carries on instead of minting twice.
  const advance = async () => {
    if (step === 'workspace' && !s.workspaceId) {
      setBusy(true);
      setErr('');
      try {
        const slug = workspaceSlug(s.slug) || 'workspace';
        const id = await createWorkspace(s.name.trim(), slug);
        await writeResume({ id, name: s.name.trim(), slug });
        setS((x) => wizardNext({ ...x, workspaceId: id }));
      } catch (e) {
        setErr(errMsg(e));
      } finally {
        setBusy(false);
      }
      return;
    }
    setS((x) => seedCrew(wizardNext(x)));
  };

  // the Machine step watches the fleet's word on the runner every 2s — a read, never a gate
  useEffect(() => {
    if (step !== 'machine' || !s.workspaceId) return;
    let alive = true;
    const tick = () => void readRunner(s.workspaceId!).then((r) => { if (alive) setRunner(r); });
    tick();
    const id = setInterval(tick, 2000);
    return () => { alive = false; clearInterval(id); };
  }, [step, s.workspaceId]);

  // Launch: register the crew once on arrival (guarded — a Back/forward bounce never registers twice)
  useEffect(() => {
    if (!isLast || launchedRef.current || !s.workspaceId) return;
    launchedRef.current = true;
    let alive = true;
    const wsId = s.workspaceId;
    void launchCrew(s, wsId, (p) => { if (alive) setProgress(p); })
      .then(async ({ machineId: m }) => {
        await clearResume();
        if (!alive) return;
        setMachineId(m);
        setActive(wsId);
        setS((x) => ({ ...x, launched: true }));
      })
      .catch((e) => { launchedRef.current = false; if (alive) setErr(errMsg(e)); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLast]);

  const meet = () => {
    // Home first, then New chat on top of it — so its close lands on the tabs, not on this wizard
    router.replace('/(tabs)');
    router.push({ pathname: '/new', params: { draft: FIRST_PROMPT, ...(general?.[0]?.id ? { channel: general[0].id } : {}), ...(machineId ? { machine: machineId } : {}) } });
  };
  const orchestrator = s.crew.find((c) => c.role === 'orchestrator')?.name.trim() || 'rex';
  const synced = s.launched && roomCount > 0;
  const stepNo = WIZARD_STEPS.indexOf(step) + 1;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: t.bg, paddingTop: insets.top }}>
      <WizardTop step={stepNo} total={WIZARD_STEPS.length} label={WIZARD_LABEL[step]} />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
        {step === 'workspace' ? (
          <>
            <Eyebrow>Step 1 of {WIZARD_STEPS.length}</Eyebrow>
            <Title>Create your workspace</Title>
            <Sub>Give it a name and an address. Your free cloud machine starts when you continue.</Sub>
            <Field value={s.name} onChange={(v) => setS((x) => setWizardName(x, v))} placeholder="Workspace name" autoFocus />
            <SlugField prefix={HOST} slug={s.slug} onChange={(v) => setS((x) => setWizardSlug(x, v))} />
            <Hint>Individual plan: one person, one cloud machine, 500 credits</Hint>
          </>
        ) : null}
        {step === 'machine' ? (
          <>
            <Eyebrow>Step 2 of {WIZARD_STEPS.length}</Eyebrow>
            <Title>Your machine starts now</Title>
            <Sub><Text style={{ ...F.body(600), color: t.text }}>{s.name.trim()}</Text> has its own cloud machine, free to start. Your agents run on it, also when this phone is in your pocket.</Sub>
            <MachineTile name={`${workspaceSlug(s.slug) || 'workspace'} · cloud`} tone={runner?.lastSeenAt ? 'on' : 'waking'}
              small={runner ? `${runner.lifecycle ?? 'starts'} · private namespace · ${runner.name}` : 'starts · private namespace'} />
            <Hint>outbound only · gVisor sandbox · your code and keys stay on it</Hint>
          </>
        ) : null}
        {step === 'keys' ? (
          <>
            <Eyebrow>Step 3 of {WIZARD_STEPS.length}</Eyebrow>
            <Title>Bring your own brain</Title>
            <Sub>Use the subscriptions you pay for already. You sign in on your cloud machine after launch, in its own terminal. You can also add an API key now.</Sub>
            <View style={{ height: 6 }} />
            {s.providers.map((p) => {
              const meta = p.provider === 'anthropic' ? { letter: 'A', name: 'Claude', small: 'sign in on your machine after launch', modes: [{ id: 'subscription' as const, label: 'subscription' }, { id: 'apikey' as const, label: 'API key' }] }
                : p.provider === 'openai' ? { letter: 'O', name: 'ChatGPT / Codex', small: 'device sign-in on your machine after launch', modes: [{ id: 'subscription' as const, label: 'subscription' }, { id: 'apikey' as const, label: 'API key' }] }
                : { letter: 'G', name: 'Gemini', small: 'API key only. Google permits no login on a cloud machine.', modes: [{ id: 'apikey' as const, label: 'API key' }] };
              return (
                <View key={p.provider}>
                  <ProviderRow letter={meta.letter} name={meta.name} small={meta.small} modes={meta.modes} mode={p.mode} onMode={(m) => setS((x) => setWizardProvider(x, p.provider, { mode: m }))} />
                  {p.mode === 'apikey' ? <Field value={p.key} onChange={(v) => setS((x) => setWizardProvider(x, p.provider, { key: v }))} placeholder={`${meta.name} API key`} secure mono autoCapitalize="none" /> : null}
                </View>
              );
            })}
            <View style={{ marginHorizontal: 16, marginTop: 16, padding: 14, borderRadius: R.lg, backgroundColor: t.panel2, borderWidth: 1, borderColor: t.border }}>
              <Text style={{ ...F.body(600), fontSize: 14, color: t.text }}>Start now. Your agents are ready.</Text>
              <Text style={{ ...F.body(400), fontSize: 12.5, lineHeight: 18, color: t.muted, marginTop: 4 }}>Each workspace has 500 credits. You can connect your own brain later.</Text>
              <Btn kind="primary" label="Start with 500 credits →" onPress={() => setS((x) => seedCrew(wizardNext({ ...x, pack: STARTER_PACK_ID })))} style={{ marginTop: 12 }} />
            </View>
            {readyProviders(s).length ? <Hint>The crew runs on <Text style={{ color: t.text }}>{brain}</Text>.</Hint> : null}
          </>
        ) : null}
        {step === 'team' ? (
          <>
            <Eyebrow>Your starting team</Eyebrow>
            <Title>Meet your <Text style={{ color: t.link }}>crew</Text>.</Title>
            <Sub>Each agent runs a brain from your <Text style={{ ...F.body(600), color: t.text }}>{brain}</Text> pack. You can change a name now, or later in Settings.</Sub>
            <View style={{ height: 6 }} />
            {s.crew.map((c, i) => <CrewCard key={c.role} member={c} brain={brain} onName={(v) => setS((x) => setWizardCrewName(x, i, v))} />)}
          </>
        ) : null}
        {isLast ? (
          <>
            <Eyebrow center>{s.launched ? 'Team ready' : 'The crew starts'}</Eyebrow>
            <Title center accent={s.name.trim() || 'Your workspace'}>{s.launched ? 'is live.' : 'comes online.'}</Title>
            <Reveal crew={s.crew} ready={s.launched} />
            <Stats agents={s.crew.length} machines={1} channels={roomCount || WIZARD_CHANNELS.length} />
            {!s.launched && !err ? <Sub center>{progress?.line ?? 'Your workspace starts on your cloud machine.'}{progress && progress.total > 1 ? ` (${progress.done}/${progress.total})` : ''}</Sub> : null}
            {s.launched && !synced ? <Sub center>The workspace syncs to this phone.</Sub> : null}
          </>
        ) : null}
        {err ? <Text style={{ ...F.body(400), fontSize: 12.5, lineHeight: 18, color: t.warn, paddingHorizontal: 16, paddingTop: 12 }}>{err}</Text> : null}
        {isLast ? (
          <View style={{ paddingHorizontal: 16, paddingTop: 16, gap: 8 }}>
            {err ? <Btn label="← Back" onPress={() => { setErr(''); setS((x) => wizardBack(x)); }} /> : null}
            <Btn kind="primary" label={synced ? `Meet @${orchestrator}` : 'Please wait…'} disabled={!synced} onPress={meet} />
          </View>
        ) : (
          <WizardNav onBack={s.step > (s.workspaceId ? 2 : 1) ? () => setS((x) => wizardBack(x)) : undefined} onNext={() => void advance()} nextLabel="Continue →" disabled={!wizardCanContinue(s)} busy={busy} />
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
