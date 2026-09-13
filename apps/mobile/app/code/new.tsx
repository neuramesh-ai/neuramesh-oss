// NEW CODE SESSION — the Code landing as a phone (the mobile-cloud round D12): the mark, "What can I
// do for you?", the real composer with Plan|Act, the project chip (fixes the repo and the inherited
// model), the machine chip (cloud machines only: the one that hosts the worktree and the branch),
// then recents. A send mints the session, opens the lane to the machine and lands in the thread;
// if the machine sleeps, the boot card wakes it first (the shared ensure) — Code needs an awake
// cloud machine, and the screen says so rather than pretending.
import { CODE_SESSIONS_FOR_WORKSPACE, DEVELOPER_SEATS_FOR_WORKSPACE, MACHINES_WITH_KIND_FOR_WORKSPACE, MEMBERS_FOR_WORKSPACE, PROJECTS_FOR_WORKSPACE, REMOTE_REPOS_FOR_WORKSPACE, REPOS_FOR_PROJECT } from '@neuramesh/client-core';
import { projectDeveloperModel, type ComputePrefs, type DeveloperSeat, type EngineeringMode } from '@neuramesh/shared';
import { useQuery } from '@powersync/react-native';
import { Stack, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { currentUserId } from '../../src/auth';
import { PorchMark } from '../../src/brand';
import { startCodeSession } from '../../src/code-store';
import { useCompute } from '../../src/compute';
import { Icon } from '../../src/icon';
import { Kicker } from '../../src/kit';
import { type ChipMachine, MachineChip, useMachineForecast } from '../../src/machine-chip';
import { ModelChip } from '../../src/model-chip';
import { RepoAttach, type WorkspaceRepo } from '../../src/repo-attach';
import { ensureCodeMachine, relayConfigured } from '../../src/relay';
import { SessionRow } from '../../src/session-row';
import { useTheme } from '../../src/theme';
import { ComposerCard, ComposerChip, ComposerNote, SessionHead } from '../../src/thread-parts';
import { F, R } from '../../src/type';
import { timeAgo, useActiveWorkspace } from '../../src/ui';
import { type CodeRow, codeRowFace } from '../(tabs)/code';

interface ProjectRow { id: string; name: string; is_default: number; model_pack: string | null }
interface RepoRow { id: string; name: string; org_name: string | null; default_branch: string | null; clone_url: string | null; is_primary: number }
interface MachineRow { id: string; name: string; kind: string | null; owner_user_id: string | null; last_seen_at: string | null }
interface MemberRow { user_id: string; display_name: string | null; compute: string | null }
const prefsOf = (m: MemberRow | undefined): ComputePrefs | null => { try { return m?.compute ? (JSON.parse(m.compute) as ComputePrefs) : null; } catch { return null; } };

export function ModePill({ mode, onChange }: { mode: EngineeringMode; onChange: (m: EngineeringMode) => void }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', backgroundColor: t.panel3, borderRadius: R.pill, padding: 2, gap: 2 }}>
      {(['plan', 'act'] as const).map((m) => (
        <Pressable key={m} onPress={() => onChange(m)} style={{ paddingHorizontal: 10, minHeight: 24, justifyContent: 'center', borderRadius: R.pill, backgroundColor: mode === m ? t.card : 'transparent' }}>
          <Text style={{ ...F.body(600), fontSize: 11, color: mode === m ? t.text : t.muted }}>{m === 'plan' ? 'Plan' : 'Act'}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export default function NewCode() {
  const t = useTheme();
  const router = useRouter();
  const ws = useActiveWorkspace();
  const me = currentUserId();
  const compute = useCompute(ws);
  const { data: projects } = useQuery<ProjectRow>(PROJECTS_FOR_WORKSPACE, [ws ?? '']);
  const [projectId, setProjectId] = useState<string | null>(null);
  const project = (projects ?? []).find((p) => p.id === projectId) ?? (projects ?? []).find((p) => p.is_default) ?? projects?.[0] ?? null;
  const { data: repos } = useQuery<RepoRow>(REPOS_FOR_PROJECT, [project?.id ?? '']);
  const repo = repos?.[0] ?? null;
  // every remote repo the workspace knows, so attaching one is usually a tap rather than a URL
  const { data: allRepos } = useQuery<WorkspaceRepo>(REMOTE_REPOS_FOR_WORKSPACE, [ws ?? '']);
  const [attaching, setAttaching] = useState(false);
  // the brain a session inherits when nobody picks one: the project's developer seat, derived the
  // same way the desktop derives it (shared `projectDeveloperModel`) so both name one model
  const { data: seats } = useQuery<DeveloperSeat>(DEVELOPER_SEATS_FOR_WORKSPACE, [ws ?? '']);
  const inheritedModel = useMemo(() => projectDeveloperModel(null, project?.model_pack, seats ?? []), [project?.model_pack, seats]);
  const { data: machines } = useQuery<MachineRow>(MACHINES_WITH_KIND_FOR_WORKSPACE, [ws ?? '']);
  const { data: members } = useQuery<MemberRow>(MEMBERS_FOR_WORKSPACE, [ws ?? '']);
  const { data: recent } = useQuery<CodeRow>(CODE_SESSIONS_FOR_WORKSPACE, [ws ?? '']);
  const [mode, setMode] = useState<EngineeringMode>('plan');
  const [chosen, setChosen] = useState<string | null>(null);
  // which brain runs this session; null inherits the project's own (the fix round, 2026-09-06)
  const [modelId, setModelId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [pop, setPop] = useState(false);
  const [boot, setBoot] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Code hosts a worktree, so only a CLOUD machine can host it: the phone offers no laptop here
  const cloud = useMemo(() => (machines ?? []).filter((m) => m.kind === 'member' || m.kind === 'runner'), [machines]);
  const chipMachines: ChipMachine[] = useMemo(() => cloud.map((m) => ({
    id: m.id, name: m.name, kind: m.kind ?? 'runner', ownerUserId: m.owner_user_id, lastSeenAt: m.last_seen_at,
    sharesWith: prefsOf((members ?? []).find((x) => x.user_id === m.owner_user_id))?.shares, ownerName: (members ?? []).find((x) => x.user_id === m.owner_user_id)?.display_name ?? null,
  })), [cloud, members]);
  const prefs = prefsOf((members ?? []).find((m) => m.user_id === me));
  const { resolved } = useMachineForecast({ machines: chipMachines, selfUserId: me, prefs, chosen });
  const machine = chosen ? chipMachines.find((m) => m.id === chosen) ?? null : resolved ?? chipMachines.find((m) => m.kind === 'runner') ?? chipMachines[0] ?? null;

  async function send() {
    const prompt = draft.trim();
    if (!prompt || !ws || !repo || !project) return;
    if (!relayConfigured()) { setErr('This build has no relay. Code needs a lane to your cloud machine.'); return; }
    if (!machine) { setErr('No cloud machine yet. Your first message on Home starts one.'); return; }
    setErr(null);
    const state = compute.stateOf(machine.id)?.status ?? null;
    if (state !== 'online') {
      setBoot('waking');
      const out = await ensureCodeMachine(ws, machine.id, (p) => setBoot(p));
      setBoot(null);
      if (!out.ok) { setErr(out.detail ?? `The machine could not be woken (${out.reason}).`); return; }
    }
    const id = startCodeSession({
      workspace: ws, prompt, mode, machineId: machine.id, modelId,
      repo: { id: repo.id, name: repo.name, owner: repo.org_name ?? '', branch: repo.default_branch ?? 'main', root: null },
      project: { id: project.id, name: project.name, slug: project.name.toLowerCase().replace(/\s+/g, '-') },
    });
    setDraft('');
    router.replace(`/code/${id}`);
  }

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: t.bg }}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={{ paddingTop: 4 }}><SessionHead crumb="code" onBack={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/code'))} /></View>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={0}>
        <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 12 }}>
          <View style={{ alignItems: 'center', gap: 10, marginTop: 22 }}>
            <PorchMark size={40} />
            <Text style={{ ...F.display(), fontSize: 22, color: t.text, letterSpacing: F.tight(22) }}>What can I do for you?</Text>
          </View>
          {boot ? (
            <View style={{ marginHorizontal: 12, marginTop: 18, padding: 16, borderRadius: R.lg, backgroundColor: t.card, borderWidth: 1, borderColor: t.cardBorder, alignItems: 'center', gap: 6 }}>
              <Text style={{ ...F.display(), fontSize: 18, letterSpacing: F.tight(18), color: t.text }}>Waking {machine?.name ?? 'your machine'}</Text>
              <Text style={{ ...F.body(400), fontSize: 12.5, color: t.muted }}>{boot === 'waking' ? 'checks the fleet' : boot} · your session starts the moment it answers</Text>
            </View>
          ) : null}
          {err ? <Text style={{ ...F.body(400), fontSize: 12.5, color: t.warn, paddingHorizontal: 16, paddingTop: 14 }}>{err}</Text> : null}
          {(recent ?? []).length ? <Kicker>Recent</Kicker> : null}
          {(recent ?? []).slice(0, 6).map((r) => {
            const face = codeRowFace(r, t);
            return <SessionRow key={r.id} kind="code" title={r.title || `${r.repo_name ?? 'repo'} · new session`} snip={r.branch ? `⎇ ${r.branch}` : `${r.repo_name ?? 'repo'} · read-only`} snipMono={!!r.branch} when={timeAgo(r.updated_at)} live={face.live} ask={face.ask} chip={{ label: face.label, color: face.color }} onPress={() => router.push(`/code/${r.id}`)} />;
          })}
        </ScrollView>
        {attaching && project && ws ? (
          <View style={{ marginHorizontal: 2 }}>
            <RepoAttach workspace={ws} projectId={project.id} projectName={project.name} repos={allRepos ?? []} onClose={() => setAttaching(false)} onAttached={() => setErr('')} />
          </View>
        ) : null}
        <ComposerCard value={draft} onChange={setDraft} placeholder="Describe the change…" autoFocus onSend={send}
          note={<ComposerNote><Text style={{ ...F.mono(500), color: t.muted }}>{project?.name ?? 'project'}</Text> · {repo
            ? `${repo.name} · new branch from ${repo.default_branch ?? 'main'}`
            : (
              // the sentence that named the problem is the door out of it (the fix round, 2026-09-06)
              <Text onPress={() => project && setAttaching(true)} style={{ ...F.mono(500), color: t.link }}>Attach a repo →</Text>
            )} · <Text style={{ ...F.mono(500), color: t.muted }}>{machine?.name ?? 'no cloud machine'}</Text></ComposerNote>}
          chips={<>
            <ModePill mode={mode} onChange={setMode} />
            <ComposerChip iconOnly icon={<Icon name="project" size={13} color={t.muted} />} label={project?.name ?? 'project'} open={pop} onPress={() => (projects ?? []).length > 1 && setPop(true)} />
            <MachineChip iconOnly machines={chipMachines} selfUserId={me} prefs={prefs} chosen={chosen} onChoose={setChosen} compute={compute} />
            <ModelChip workspace={ws} value={modelId} inherited={inheritedModel} onChange={setModelId} />
          </>} />
      </KeyboardAvoidingView>
      {pop ? (
        <Modal visible transparent animationType="fade" onRequestClose={() => setPop(false)}>
          <Pressable onPress={() => setPop(false)} style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: '#00000040' }}>
            <View style={{ marginHorizontal: 12, marginBottom: 150, backgroundColor: t.overlay, borderWidth: 1, borderColor: t.border2, borderRadius: R.lg, padding: 7 }}>
              <Text style={{ ...F.mono(500), fontSize: 10.5, letterSpacing: F.track, color: t.dim, paddingHorizontal: 9, paddingVertical: 6 }}>Project</Text>
              {(projects ?? []).map((p) => (
                <Pressable key={p.id} onPress={() => { setProjectId(p.id); setPop(false); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 9, paddingVertical: 8, minHeight: 40, borderRadius: R.md, backgroundColor: p.id === project?.id ? t.panel2 : 'transparent' }}>
                  <Text style={{ ...F.body(600), fontSize: 13, color: t.text, flex: 1 }}>{p.name}</Text>
                  {p.id === project?.id ? <Icon name="check" size={13} color={t.text} /> : null}
                </Pressable>
              ))}
            </View>
          </Pressable>
        </Modal>
      ) : null}
    </SafeAreaView>
  );
}
