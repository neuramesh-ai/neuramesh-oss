// NEW CHAT — the stage (the shell round's New chat, at phone scale; the mobile-cloud round D7): the
// serif greeting whose project name is the switcher, ghost suggestion pills (pre-drafted messages,
// never commands), and THE composer with its three knobs — the room chip · the brain pill (the
// room's seated crew, display-only in v1) · the machine chip (the shared forecast, origin 'web').
// A send births a session (src/send.ts) and lands in it; the note under the composer says who
// picks it up, where, and on which machine.
//
// THE CREW PILL IS A CONTROL (George, 2026-09-06: "the agent dropdown isn't selectable on mobile").
// It was three avatars in a bordered View with no handler — display-only by design, and shaped
// exactly like the two chips beside it that DO open. A pill that looks like a control and answers
// no tap is worse than no pill. It opens the room's crew now, and picking one addresses them with a
// mention, which is how this product has always directed a message at an agent (shared mentions.ts,
// the ONE matcher). No routing was invented: the orchestrator still decides who else joins.
import { AGENTS_IN_CHANNEL, CHANNELS_WITH_PROJECT_FOR_WORKSPACE, MACHINES_WITH_KIND_FOR_WORKSPACE, MEMBERS_FOR_WORKSPACE, PROJECTS_FOR_WORKSPACE } from '@neuramesh/client-core';
import { designationFor, STARTER_MODEL, type ComputePrefs } from '@neuramesh/shared';
import { useQuery } from '@powersync/react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { currentUserId } from '../src/auth';
import { useCompute } from '../src/compute';
import { Icon } from '../src/icon';
import { Kicker } from '../src/kit';
import { type ChipMachine, MachineChip, useMachineForecast } from '../src/machine-chip';
import { readBrainDraft, serializeBrain, writeBrainDraft } from '../src/brain-draft';
import { ModelChip } from '../src/model-chip';
import { sendSession } from '../src/send';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../src/theme';
import { ComposerCard, ComposerNote, GhostPill, SessionHead } from '../src/thread-parts';
import { F, R } from '../src/type';
import { Avatar, useActiveWorkspace } from '../src/ui';

interface ProjectRow { id: string; name: string; is_default: number }
interface ChannelRow { id: string; slug: string; topic: string | null; project_id: string | null; kind: string | null }
interface MachineRow { id: string; name: string; kind: string | null; owner_user_id: string | null; last_seen_at: string | null }
interface MemberRow { user_id: string; display_name: string | null; compute: string | null }
interface AgentRow { id: string; name: string; emoji: string | null; role: string; model: string | null }

const SUGGESTIONS = ['What moved while I was away?', 'Plan the next release', 'Give me ideas'];

const prefsOf = (m: MemberRow | undefined): ComputePrefs | null => { try { return m?.compute ? (JSON.parse(m.compute) as ComputePrefs) : null; } catch { return null; } };

export default function NewChat() {
  const t = useTheme();
  const router = useRouter();
  const ws = useActiveWorkspace();
  const me = currentUserId();
  const params = useLocalSearchParams<{ channel?: string; draft?: string; machine?: string }>();
  const { data: projects } = useQuery<ProjectRow>(PROJECTS_FOR_WORKSPACE, [ws ?? '']);
  const { data: channels } = useQuery<ChannelRow>(CHANNELS_WITH_PROJECT_FOR_WORKSPACE, [ws ?? '']);
  const { data: machines } = useQuery<MachineRow>(MACHINES_WITH_KIND_FOR_WORKSPACE, [ws ?? '']);
  const { data: members } = useQuery<MemberRow>(MEMBERS_FOR_WORKSPACE, [ws ?? '']);
  const compute = useCompute(ws);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [channelId, setChannelId] = useState<string | null>(params.channel ?? null);
  // the chip's pick for THIS send; null = Auto. The wizard hands over the runner (D20): the first send
  // is designated to the cloud machine, so the first reply cannot race a laptop that does not exist.
  const [chosen, setChosen] = useState<string | null>(params.machine ?? null);
  // the brain this send births the conversation on — sticky, so "always start on the house brain"
  // is set once. `null` leaves the project's own packs alone.
  const [brain, setBrain] = useState<string | null>(null);
  useEffect(() => { void readBrainDraft().then(setBrain); }, []);
  const pickBrain = (m: string | null) => { setBrain(m); void writeBrainDraft(m); };
  const [draft, setDraft] = useState(params.draft ?? '');
  const [pop, setPop] = useState<'project' | 'room' | 'crew' | null>(null);
  const [sending, setSending] = useState(false);

  const project = (projects ?? []).find((p) => p.id === projectId) ?? (projects ?? []).find((p) => p.is_default) ?? projects?.[0] ?? null;
  const rooms = (channels ?? []).filter((c) => !project || c.project_id === project.id);
  const room = rooms.find((c) => c.id === channelId) ?? rooms.find((c) => c.slug === 'general') ?? rooms[0] ?? null;
  const { data: crew } = useQuery<AgentRow>(AGENTS_IN_CHANNEL, [room?.id ?? '']);
  // what answers when nothing is picked: the seat that actually takes a chat in this room
  const inheritedBrain = useMemo(
    () => (crew ?? []).find((a) => a.role === 'orchestrator')?.model || (crew ?? [])[0]?.model || STARTER_MODEL,
    [crew],
  );
  const orch = (crew ?? []).find((a) => a.role === 'orchestrator') ?? crew?.[0];

  const self = (members ?? []).find((m) => m.user_id === me);
  const first = self?.display_name?.trim().split(/\s+/)[0] ?? null;
  const hour = new Date().getHours();
  const hello = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const nameOf = (uid: string | null) => (members ?? []).find((m) => m.user_id === uid)?.display_name?.trim() ?? null;
  const chipMachines: ChipMachine[] = useMemo(() => (machines ?? []).map((m) => ({
    id: m.id, name: m.name, kind: m.kind ?? 'local', ownerUserId: m.owner_user_id, lastSeenAt: m.last_seen_at,
    sharesWith: prefsOf((members ?? []).find((x) => x.user_id === m.owner_user_id))?.shares, ownerName: nameOf(m.owner_user_id),
  })), [machines, members]); // eslint-disable-line react-hooks/exhaustive-deps
  const prefs = prefsOf(self);
  const { resolved } = useMachineForecast({ machines: chipMachines, selfUserId: me, prefs, chosen });

  async function send() {
    const body = draft.trim();
    if (!body || !ws || !room || !me || sending) return;
    setSending(true);
    try {
      const threadId = await sendSession({ workspace: ws, channelId: room.id, body, authorId: me, machineId: designationFor({ origin: 'web', chosen, prefs, selfMachineId: null }), brain: serializeBrain(brain) });
      setDraft('');
      router.replace(`/thread/${threadId}`);
    } finally {
      setSending(false);
    }
  }

  const note = room ? (
    <ComposerNote>
      <Text style={{ ...F.mono(500), color: t.muted }}>{orch?.name ?? 'the orchestrator'}</Text> picks it up in #{room.slug}{resolved ? ` · runs on ${resolved.name}` : ' · runs where a machine is awake'}
    </ComposerNote>
  ) : null;

  const picker = (title: string, items: Array<{ id: string; label: string; sub?: string | null }>, on: string | null, pick: (id: string) => void) => (
    <Modal visible transparent animationType="fade" onRequestClose={() => setPop(null)}>
      <Pressable onPress={() => setPop(null)} style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: '#00000040' }}>
        <View style={{ marginHorizontal: 12, marginBottom: 150, backgroundColor: t.overlay, borderWidth: 1, borderColor: t.border2, borderRadius: R.lg, padding: 7 }}>
          <Text style={{ ...F.mono(500), fontSize: 10.5, letterSpacing: F.track, color: t.dim, paddingHorizontal: 9, paddingVertical: 6 }}>{title}</Text>
          {items.map((i) => (
            <Pressable key={i.id} onPress={() => { pick(i.id); setPop(null); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 9, paddingVertical: 8, minHeight: 40, borderRadius: R.md, backgroundColor: i.id === on ? t.panel2 : 'transparent' }}>
              <View style={{ flex: 1 }}>
                <Text style={{ ...F.body(500), fontSize: 13, color: t.text }} numberOfLines={1}>{i.label}</Text>
                {i.sub ? <Text style={{ ...F.body(400), fontSize: 10.5, color: t.dim }} numberOfLines={1}>{i.sub}</Text> : null}
              </View>
              {i.id === on ? <Icon name="check" size={13} color={t.text} /> : null}
            </Pressable>
          ))}
        </View>
      </Pressable>
    </Modal>
  );

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: t.bg }}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={{ paddingTop: 4 }}>
        <SessionHead crumb="home" onBack={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))} />
      </View>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={0}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 16 }} keyboardShouldPersistTaps="handled">
          <View style={{ paddingHorizontal: 16, marginTop: 34 }}>
            <Text style={{ ...F.display(), fontSize: 24, lineHeight: 30, letterSpacing: F.tight(24), color: t.text }}>
              {hello}{first ? `, ${first}` : ''}.{'\n'}What’s next in{' '}
              <Text onPress={() => (projects ?? []).length > 1 && setPop('project')} suppressHighlighting style={{ ...F.display(), color: t.link, textDecorationLine: 'underline', textDecorationStyle: 'dotted' }}>{project?.name ?? 'your workspace'}</Text>?
            </Text>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, marginTop: 16 }}>
            {SUGGESTIONS.map((s) => <GhostPill key={s} label={s} on={draft === s} onPress={() => setDraft(s)} />)}
          </View>
          {(crew ?? []).length ? (
            <>
              {/* the room moved off the composer, so the line that already NAMES it is the way to
                  change it — no new chrome, and the fact and the control are the same thing */}
              <Pressable onPress={() => rooms.length > 1 && setPop('room')} accessibilityLabel="Change the room">
                <Kicker right={rooms.length > 1 ? <Text style={{ ...F.body(600), fontSize: 12, color: t.link }}>Change</Text> : undefined}>
                  {`In #${room?.slug ?? 'general'}`}
                </Kicker>
              </Pressable>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16 }}>
                {(crew ?? []).slice(0, 6).map((a) => (
                  <View key={a.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Avatar emoji={a.emoji} label={a.name} size={22} />
                    <Text style={{ ...F.body(500), fontSize: 12, color: t.body }}>{a.name}</Text>
                    <Text style={{ ...F.mono(500), fontSize: 9.5, letterSpacing: F.track, textTransform: 'uppercase', color: t.dim }}>{a.role}</Text>
                  </View>
                ))}
              </View>
            </>
          ) : null}
        </ScrollView>
        <ComposerCard value={draft} onChange={setDraft} placeholder={room ? `Message #${room.slug}…` : 'Message…'} autoFocus note={note} onSend={send}
          chips={<>
            {/* the brain, always: the one pick that decides whether anything can answer at all.
                Untouched it names the model that WOULD answer — the room's orchestrator seat — so
                the chip never claims a brain the send is not going to ask for. */}
            <ModelChip workspace={ws} value={brain} inherited={inheritedBrain} onChange={pickBrain} />
            {/* the crew pill: the room's seated agents, and a way to address one */}
            {(crew ?? []).length ? (
              <Pressable onPress={() => setPop('crew')} accessibilityLabel="The room's crew"
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 6, paddingRight: 9, minHeight: 34, borderRadius: R.pill, borderWidth: 1, borderColor: pop === 'crew' ? t.text : t.border, backgroundColor: pop === 'crew' ? t.panel2 : 'transparent' }}>
                {(crew ?? []).slice(0, 3).map((a, n) => <View key={a.id} style={{ marginLeft: n ? -5 : 0, borderWidth: 1, borderColor: t.card, borderRadius: 6 }}><Avatar emoji={a.emoji} label={a.name} size={16} /></View>)}
                <Icon name="chevron" size={11} color={t.muted} />
              </Pressable>
            ) : null}
            <MachineChip machines={chipMachines} selfUserId={me} prefs={prefs} chosen={chosen} onChoose={setChosen} compute={compute} />
          </>} />
      </KeyboardAvoidingView>
      {pop === 'project' ? picker('Project', (projects ?? []).map((p) => ({ id: p.id, label: p.name })), project?.id ?? null, (id) => { setProjectId(id); setChannelId(null); }) : null}
      {pop === 'room' ? picker('Room', rooms.map((c) => ({ id: c.id, label: `#${c.slug}`, sub: c.topic })), room?.id ?? null, setChannelId) : null}
      {/* picking a name ADDRESSES it: the draft gains a mention, which is the product's own way of
          aiming a message at an agent. Nothing is routed here that the room would not route. */}
      {pop === 'crew' ? picker(
        'Who should answer',
        (crew ?? []).map((a) => ({ id: a.name, label: `@${a.name}`, sub: a.role })),
        null,
        (name) => setDraft((d) => (d.includes(`@${name}`) ? d : `@${name} ${d.trimStart()}`)),
      ) : null}
    </SafeAreaView>
  );
}
