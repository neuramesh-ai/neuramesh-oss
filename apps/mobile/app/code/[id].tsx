// A CODE THREAD (the mobile-cloud round D12 — the phone-width rule from the Engineering OS:
// conversation first, evidence a segment away; explicit controls, never gesture-only). The head
// (crumb · title · the branch and the machine as toks), the evidence segments (Transcript · Changes
// · Checkpoints · Plan), the transcript from the SHARED reducer — reasoning folded into one
// disclosure, tool receipts grouped into rows, the approval card as the one elevated object with
// the whole patch's paths before anything is applied — the live line, and the composer with Plan|Act.
import { CODE_SESSIONS_FOR_WORKSPACE, DEVELOPER_SEATS_FOR_WORKSPACE, MACHINES_WITH_KIND_FOR_WORKSPACE, PROJECTS_FOR_WORKSPACE, REPOS_FOR_PROJECT } from '@neuramesh/client-core';
import { engineeringActivePresentation, engineeringActivityPresentation, engineeringPlanItems, engineeringReasoningSeconds, groupEngineeringTranscript, modelLabel, projectDeveloperModel, streamingEngineeringText, type DeveloperSeat, type EngineeringMessage, type EngineeringMode } from '@neuramesh/shared';
import { useQuery } from '@powersync/react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { approveCode, openCodeSession, sendCodePrompt, setCodeMode, setCodeModel, useCodeSession } from '../../src/code-store';
import { Icon } from '../../src/icon';
import { ModelChip } from '../../src/model-chip';
import { askPushWhenItMatters } from '../../src/push';
import { Btn, Card, Chip, Facts, Tok } from '../../src/kit';
import { relayConfigured } from '../../src/relay';
import { Orb } from '../../src/session-row';
import { useTheme } from '../../src/theme';
import { ComposerCard, ComposerNote, HumanBubble, LiveLine, SessionHead } from '../../src/thread-parts';
import { F, R } from '../../src/type';
import { useActiveWorkspace } from '../../src/ui';
import { type CodeRow } from '../(tabs)/code';
import { ModePill } from './new';

type Seg = 'transcript' | 'changes' | 'checkpoints' | 'plan';

function Reasoning({ m, next }: { m: EngineeringMessage; next?: EngineeringMessage }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const secs = engineeringReasoningSeconds(m, next);
  return (
    <View style={{ paddingHorizontal: 16, paddingVertical: 4 }}>
      <Pressable onPress={() => setOpen((o) => !o)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <View style={{ transform: [{ rotate: open ? '90deg' : '0deg' }] }}><Icon name="arrowR" size={12} color={t.dim} /></View>
        <Text style={{ ...F.body(500), fontSize: 12, color: t.muted }}>{m.streaming ? 'Thinking…' : secs ? `Thought for ${secs}s` : 'Thought'}</Text>
      </Pressable>
      {open ? <Text style={{ ...F.body(400), fontSize: 12.5, lineHeight: 18, color: t.muted, marginTop: 4 }}>{m.body}</Text> : null}
    </View>
  );
}

function Receipts({ messages }: { messages: EngineeringMessage[] }) {
  const t = useTheme();
  return (
    <View style={{ paddingHorizontal: 16, paddingVertical: 2 }}>
      {messages.map((m) => {
        const p = engineeringActivityPresentation(m);
        const color = p.status === 'warning' ? t.warn : p.status === 'success' ? t.done : t.muted;
        return (
          <View key={m.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 }}>
            <View style={{ width: 16, alignItems: 'center' }}><Icon name={p.status === 'warning' ? 'alert' : 'check'} size={12} color={color} /></View>
            <Text style={{ ...F.body(600), fontSize: 12.5, color: t.text }} numberOfLines={1}>{p.title}</Text>
            <Text style={{ ...F.body(400), fontSize: 11.5, color: t.dim, flex: 1 }} numberOfLines={1}>{p.detail}</Text>
          </View>
        );
      })}
    </View>
  );
}

export default function CodeThread() {
  const t = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const ws = useActiveWorkspace();
  const live = useCodeSession(id);
  const { data: rows } = useQuery<CodeRow>(CODE_SESSIONS_FOR_WORKSPACE, [ws ?? '']);
  const row = rows?.find((r) => r.id === id) ?? null;
  const { data: projects } = useQuery<{ id: string; name: string; model_pack: string | null }>(PROJECTS_FOR_WORKSPACE, [ws ?? '']);
  const { data: seats } = useQuery<DeveloperSeat>(DEVELOPER_SEATS_FOR_WORKSPACE, [ws ?? '']);
  const { data: repos } = useQuery<{ id: string; name: string; org_name: string | null; default_branch: string | null }>(REPOS_FOR_PROJECT, [row?.project_id ?? '']);
  const { data: machines } = useQuery<{ id: string; name: string; kind: string | null }>(MACHINES_WITH_KIND_FOR_WORKSPACE, [ws ?? '']);
  const [seg, setSeg] = useState<Seg>('transcript');
  const [draft, setDraft] = useState('');
  const [opened, setOpened] = useState(false);
  // follow the stream: the newest event is what the person came to see (the desktop's followsStream)
  const scroll = useRef<ScrollView>(null);
  const follow = useRef(true);

  // a row from the list: rebuild the shell and re-open the lane (the machine keeps the history)
  useEffect(() => {
    if (live || opened || !row || !ws || !relayConfigured()) return;
    const repo = repos?.find((r) => r.id === row.repo_id) ?? repos?.[0];
    const project = projects?.find((p) => p.id === row.project_id) ?? null;
    if (repos === undefined) return; // wait for the repo row before minting the shell
    openCodeSession({
      workspace: ws, id: row.id, title: row.title || 'Code session', mode: (row.mode as EngineeringMode) || 'plan', machineId: row.machine_id,
      repo: { id: row.repo_id ?? repo?.id ?? '', name: row.repo_name ?? repo?.name ?? 'repo', owner: repo?.org_name ?? '', branch: row.branch ?? repo?.default_branch ?? 'main', root: null },
      project: project ? { id: project.id, name: project.name, slug: project.name.toLowerCase().replace(/\s+/g, '-') } : null,
    });
    setOpened(true);
  }, [live, opened, row, repos, projects, ws]);
  // the lane STAYS OPEN when the screen unmounts: a pending approval belongs to the channel that
  // asked it, and a re-dial is a new session on the host ("that approval is no longer pending",
  // 2026-09-05). One socket per app makes an idle channel cheap; the store keeps reducing events.

  const session = live;
  const blocks = useMemo(() => (session ? groupEngineeringTranscript(session.messages) : []), [session]);
  const machineName = (machines ?? []).find((m) => m.id === (session?.machineId ?? row?.machine_id))?.name ?? null;
  // what "the project's default" means here: the machine's own answer once it is ready, else the
  // project's developer seat — the desktop's derivation, shared (the fix round, 2026-09-06)
  const pack = (projects ?? []).find((p) => p.id === row?.project_id)?.model_pack ?? null;
  const inheritedModel = useMemo(() => projectDeveloperModel(session?.model, pack, seats ?? []), [session?.model, pack, seats]);
  const title = session?.title && session.title !== 'New Code task' ? session.title : row?.title || 'Code session';
  const branch = session?.repo.branch ?? row?.branch ?? null;
  const streaming = session?.state === 'streaming';
  const approval = session?.pendingApproval ?? null;
  // an approval waiting is the Code lane's "first reply" (S7): the moment to ask for push, so the
  // next one reaches you when this screen is closed
  useEffect(() => { if (approval) void askPushWhenItMatters(); }, [approval?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const active = session && streaming && !session.messages.some((m) => m.role === 'reasoning' && m.streaming) ? engineeringActivePresentation(session.activeActivity, session.mode) : null;
  const plan = session?.workPlan ?? null;

  const segs: Array<[Seg, string, number | null]> = [['transcript', 'Transcript', null], ['changes', 'Changes', session?.changes.length ?? row?.changes_count ?? 0], ['checkpoints', 'Checkpoints', session?.checkpoints.length ?? row?.checkpoints_count ?? 0], ['plan', 'Plan', null]];

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: t.bg }}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={{ paddingTop: 4 }}>
        <SessionHead crumb="code" title={title} onBack={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/code'))}
          toks={[
            ...(branch ? [<Tok key="b" icon={<Icon name="branch" size={12} color={t.muted} />}>{branch}</Tok>] : []),
            ...(machineName ? [<Tok key="m" icon={<Icon name="cloud" size={12} color={t.muted} />}>{machineName}</Tok>] : []),
            // a session you come back to says which brain ran it, picked or inherited
            ...(session ? [<Tok key="mo" icon={<Icon name="brain" size={12} color={t.muted} />}>{modelLabel(session.modelOverride ?? inheritedModel)}</Tok>] : []),
            ...(row?.state === 'awaiting_approval' || approval ? [<Chip key="a" label="approval" color={t.warn} />] : []),
          ]} />
      </View>
      <View style={{ flexDirection: 'row', gap: 14, paddingHorizontal: 16, paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: t.border }}>
        {segs.map(([k, l, n]) => (
          <Pressable key={k} onPress={() => setSeg(k)} style={{ paddingVertical: 4, borderBottomWidth: 2, borderBottomColor: seg === k ? t.text : 'transparent', flexDirection: 'row', gap: 4, alignItems: 'baseline' }}>
            <Text style={{ ...F.body(600), fontSize: 12.5, color: seg === k ? t.text : t.muted }}>{l}</Text>
            {n ? <Text style={{ ...F.mono(500), fontSize: 10, color: t.dim }}>{n}</Text> : null}
          </Pressable>
        ))}
      </View>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={0}>
        <ScrollView ref={scroll} style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 6 }} scrollEventThrottle={16}
          onScroll={(e) => { const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent; follow.current = contentSize.height - contentOffset.y - layoutMeasurement.height < 80; }}
          onContentSizeChange={() => { if (follow.current && seg === 'transcript') scroll.current?.scrollToEnd({ animated: true }); }}>
          {!relayConfigured() ? <Text style={{ ...F.body(400), fontSize: 12.5, color: t.muted, paddingHorizontal: 16, paddingTop: 10 }}>This build has no relay. The transcript stays on the machine.{row?.last_line ? ` Last line: “${row.last_line}”` : ''}</Text> : null}
          {seg === 'transcript' ? (
            <>
              {!session && relayConfigured() ? <Text style={{ ...F.body(400), fontSize: 12.5, color: t.muted, paddingHorizontal: 16, paddingTop: 10 }}>The lane to the machine opens.</Text> : null}
              {blocks.map((b, i) => {
                if (b.kind === 'activity') return <Receipts key={`a${i}`} messages={b.messages} />;
                const m = b.message;
                if (m.role === 'user') return <HumanBubble key={m.id}>{m.body}</HumanBubble>;
                if (m.role === 'reasoning') return <Reasoning key={m.id} m={m} next={session?.messages[session.messages.indexOf(m) + 1]} />;
                return (
                  <View key={m.id} style={{ paddingHorizontal: 16, paddingVertical: 6 }}>
                    <Text style={{ ...F.body(400), fontSize: 13.5, lineHeight: 21, color: m.tone === 'warning' ? t.warn : t.body }}>{m.streaming ? streamingEngineeringText(m.body) : m.body}</Text>
                  </View>
                );
              })}
              {active ? <LiveLine who={session?.model ? 'the model' : 'Engineering'} verb={active.title} /> : null}
              {approval ? (
                <Card>
                  <Text style={{ ...F.mono(500), fontSize: 9.5, letterSpacing: F.track, textTransform: 'uppercase', color: t.dim, marginBottom: 6 }}>{`approval · ${approval.category} ${approval.category === 'edit' ? 'files' : ''}`.trim()}</Text>
                  <Text style={{ ...F.body(600), fontSize: 13, color: t.text }}>{approval.title}{approval.changes?.length ? ` · ${approval.changes.length} file${approval.changes.length === 1 ? '' : 's'}` : ''}</Text>
                  {approval.changes?.length ? <Facts>{approval.changes.map((c) => `${c.path}  ${c.kind === 'deleted' ? '−' : '+'}${c.after.split('\n').length}`).join('\n')}</Facts> : null}
                  {approval.command ? <Text style={{ ...F.mono(500), fontSize: 11.5, color: t.body, backgroundColor: t.bg, borderRadius: R.md, padding: 9, marginTop: 8 }}>{approval.command}</Text> : null}
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                    <Btn label="Approve" kind="primary" sm onPress={() => approveCode(id, true)} />
                    <Btn label="Deny" sm onPress={() => approveCode(id, false)} />
                  </View>
                  <Text style={{ ...F.body(400), fontSize: 11, color: t.dim, marginTop: 8 }}>{approval.continuation === 'apply' ? 'then verify: asks first' : approval.continuation === 'verify' ? 'the command runs once, on the machine' : 'reads only, writes nothing'}</Text>
                </Card>
              ) : null}
              {session?.pendingModeHandoff && session.mode === 'plan' && !streaming ? (
                <Card>
                  <Text style={{ ...F.body(600), fontSize: 13, color: t.text }}>The plan is ready. Continue in Act?</Text>
                  <Text style={{ ...F.body(400), fontSize: 12, color: t.muted, marginTop: 2 }}>{session.pendingModeHandoff.prompt}</Text>
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                    <Btn label="Continue in Act" kind="primary" sm onPress={() => { setCodeMode(id, 'act'); sendCodePrompt(id, session.pendingModeHandoff!.prompt); }} />
                  </View>
                </Card>
              ) : null}
              <View style={{ height: 8 }} />
            </>
          ) : null}
          {seg === 'changes' ? (
            (session?.changes.length ? session.changes : []).length === 0
              ? <Text style={{ ...F.body(400), fontSize: 12.5, color: t.muted, paddingHorizontal: 16, paddingTop: 10 }}>{row?.changes_count ? `${row.changes_count} change${row.changes_count === 1 ? '' : 's'} on the machine. The diff arrives when the lane opens.` : 'No changes yet.'}</Text>
              : session!.changes.map((c) => (
                <View key={c.path} style={{ paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: t.border }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Chip label={c.kind} color={c.kind === 'deleted' ? t.blocked : c.kind === 'added' ? t.done : t.prog} /><Text style={{ ...F.mono(500), fontSize: 11.5, color: t.text, flex: 1 }} numberOfLines={1}>{c.path}</Text></View>
                  <ScrollView horizontal><Text style={{ ...F.mono(500), fontSize: 10.5, lineHeight: 15, color: t.body, marginTop: 6 }}>{c.diff.split('\n').slice(0, 40).join('\n')}</Text></ScrollView>
                </View>
              ))
          ) : null}
          {seg === 'checkpoints' ? (
            (session?.checkpoints ?? []).length === 0
              ? <Text style={{ ...F.body(400), fontSize: 12.5, color: t.muted, paddingHorizontal: 16, paddingTop: 10 }}>{row?.checkpoints_count ? `${row.checkpoints_count} checkpoint${row.checkpoints_count === 1 ? '' : 's'} on the machine.` : 'No checkpoints yet. One lands before each run.'}</Text>
              : session!.checkpoints.map((c) => (
                <View key={c.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 8 }}>
                  <Icon name="history" size={14} color={t.muted} />
                  <Text style={{ ...F.body(600), fontSize: 12.5, color: t.text, flex: 1 }}>{c.label}</Text>
                  <Text style={{ ...F.mono(500), fontSize: 10.5, color: t.dim }}>{new Date(c.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
                </View>
              ))
          ) : null}
          {seg === 'plan' ? (
            plan
              ? <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
                  {engineeringPlanItems(plan).length ? engineeringPlanItems(plan).map((it, i) => (
                    <View key={i} style={{ flexDirection: 'row', gap: 8, paddingVertical: 4 }}>
                      <Icon name={it.status === 'complete' ? 'checkCircle' : 'circleGlyph'} size={14} color={it.status === 'complete' ? t.done : it.status === 'active' ? t.prog : t.dim} />
                      <Text style={{ ...F.body(400), fontSize: 13, color: t.body, flex: 1 }}>{it.text}</Text>
                    </View>
                  )) : <Text style={{ ...F.body(400), fontSize: 13, lineHeight: 20, color: t.body }}>{plan}</Text>}
                </View>
              : <Text style={{ ...F.body(400), fontSize: 12.5, color: t.muted, paddingHorizontal: 16, paddingTop: 10 }}>No plan yet. A Plan turn writes one here.</Text>
          ) : null}
        </ScrollView>
        <ComposerCard value={draft} onChange={setDraft} placeholder="Reply or redirect…" onSend={() => { const b = draft.trim(); if (!b) return; setDraft(''); sendCodePrompt(id, b); }}
          note={<ComposerNote><Text style={{ ...F.mono(500), color: t.muted }}>{session?.mode === 'act' ? 'Act' : 'Plan'}</Text> · {session?.mode === 'act' ? 'edits ask first · commands ask first' : 'read-only · nothing is written'}</ComposerNote>}
          chips={<>
            <ModePill mode={session?.mode ?? 'plan'} onChange={(m) => setCodeMode(id, m)} />
            {/* the brain, changeable between turns; the shared reducer refuses a change mid-turn,
                so the chip is disabled while one streams (the fix round, 2026-09-06) */}
            <ModelChip workspace={ws} value={session?.modelOverride ?? null} inherited={inheritedModel}
              disabled={streaming || !session} onChange={(m) => setCodeModel(id, m)} />
            {streaming ? <View style={{ paddingHorizontal: 4 }}><Orb size={16} /></View> : null}
          </>} />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
