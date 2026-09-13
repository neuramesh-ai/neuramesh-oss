// A CONVERSATION (docs/35 §3.4 — one session anatomy; the mobile-cloud round D5): the session head
// (crumb · title · toks: the chat chip, the machine the session was born on — settled at birth,
// never a chip in this composer — the crew), the transcript in the shared rows, the live line from
// open runs, the reply-to card when the thread was born as a reply (docs/31), and the composer.
// A task-linked thread opens the task screen instead (the row already routes there).
import { AGENTS_FOR_WORKSPACE, MACHINES_WITH_KIND_FOR_WORKSPACE, OPEN_RUNS_FOR_WORKSPACE, THREAD_ARTIFACTS, THREAD_HEAD, THREAD_MESSAGES } from '@neuramesh/client-core';
import { useQuery } from '@powersync/react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { currentUserId } from '../../src/auth';
import { askPushWhenItMatters } from '../../src/push';
import { OfflineBanner } from '../../src/connection';
import { Icon } from '../../src/icon';
import { Chip, Tok } from '../../src/kit';
import { sendReply } from '../../src/send';
import { type OpenRun } from '../../src/sessions';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../../src/theme';
import { JumpToLatest, MessageList, type ThreadAgent, type ThreadAttachment, type ThreadMessage, useThreadScroll } from '../../src/thread';
import { ComposerCard, LiveLine, ReplyTo, SessionHead } from '../../src/thread-parts';
import { attachPhoto, pickFile, pickPhoto, type PickedPhoto } from '../../src/attach';
import { ActivityStrip } from '../../src/thread-activity';
import { ThreadChips } from '../../src/thread-chips';
import { SettlePill, StatusChip } from '../../src/status-chip';
import { useThreadStatus } from '../../src/thread-status';
import { F } from '../../src/type';
import { useActiveWorkspace } from '../../src/ui';

interface HeadRow { id: string; title: string | null; mode: string | null; brain_override: string | null; machine_id: string | null; origin: string | null; task_id: string | null; schedule_id: string | null; root_message_id: string | null; channel_id: string; channel_slug: string; workspace_id: string; created_at: string }
interface AgentRow extends ThreadAgent { model: string | null; status: string; machine_id: string | null }

export default function Thread() {
  const t = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const activeWs = useActiveWorkspace();
  const { data: heads } = useQuery<HeadRow>(THREAD_HEAD, [id]);
  const head = heads?.[0];
  // the head wears the thread's status, and its one act (the thread-status round)
  const ts = useThreadStatus({ threadId: id });
  const ws = head?.workspace_id ?? activeWs ?? '';
  const { data: messages } = useQuery<ThreadMessage>(THREAD_MESSAGES, [id]);
  const { data: agents } = useQuery<AgentRow>(AGENTS_FOR_WORKSPACE, [ws]);
  const { data: machines } = useQuery<{ id: string; name: string; kind: string | null; owner_user_id: string | null }>(MACHINES_WITH_KIND_FOR_WORKSPACE, [ws]);
  const { data: attachments } = useQuery<ThreadAttachment>(THREAD_ARTIFACTS, [id]);
  const { data: runs } = useQuery<OpenRun>(OPEN_RUNS_FOR_WORKSPACE, [ws]);
  // the runs that settled here (docs/29): the attribution line under a reply — which machine served it, how long it took (D20)
  const { data: ended } = useQuery<{ agent_id: string | null; machine_id: string | null; started_at: string | null; ended_at: string | null }>(
    'select agent_id, machine_id, started_at, ended_at from runs where thread_id = ? and ended_at is not null order by started_at', [id]);
  // the root a reply-born thread hangs off (docs/31): a loose room message, shown as context
  const { data: roots } = useQuery<{ id: string; author_kind: string; author_id: string; body: string; thread_id: string | null }>('select id, author_kind, author_id, body, thread_id from messages where id = ? limit 1', [head?.root_message_id ?? '']);
  const root = roots?.[0];
  const { scrollRef, showJump, onScroll, onContentSizeChange, scrollToBottom } = useThreadScroll(true);
  const [draft, setDraft] = useState('');
  // one picture, held until the message it rides with is sent
  const [photo, setPhoto] = useState<PickedPhoto | null>(null);
  const [picking, setPicking] = useState(false);
  const [trouble, setTrouble] = useState('');

  // THE MESSAGE NOBODY HAS ANSWERED, with the two things the strip's deadline needs: when it was
  // sent, and how to send it again. `post` is the composer's own path, so a retry is indistinguish-
  // able from typing it a second time — which is exactly what it should be.
  const awaiting = useMemo(() => {
    const last = (messages ?? [])[(messages ?? []).length - 1];
    if (last?.author_kind !== 'human') return null;
    return { atMs: Date.parse(last.created_at), retry: () => post(last.body) };
    // `post` is stable enough for this: it closes over head/photo, and both are re-read at call time
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  const agentById = useMemo(() => new Map((agents ?? []).map((a) => [a.id, a])), [agents]);
  const crew = useMemo(() => {
    const seen = new Set<string>();
    for (const m of messages ?? []) if (m.author_kind === 'agent' && agentById.has(m.author_id)) seen.add(m.author_id);
    return [...seen].map((aid) => agentById.get(aid)!.name);
  }, [messages, agentById]);
  const live = (runs ?? []).find((r) => r.thread_id === id || (head?.task_id && r.task_id === head.task_id)) ?? null;
  const liveAgent = live?.agent_id ? agentById.get(live.agent_id) : undefined;
  const machine = head?.machine_id ? (machines ?? []).find((m) => m.id === head.machine_id) : undefined;
  const me = currentUserId();
  // the first reply is the moment to ask for push (S7): an agent has answered, so "tell me when
  // they need me" is the next obvious question — never a cold-start sheet
  const replied = (messages ?? []).some((m) => m.author_kind === 'agent');
  useEffect(() => { if (replied) void askPushWhenItMatters(); }, [replied]);
  const notes = useMemo(() => {
    const out = new Map<string, string>();
    for (const m of messages ?? []) {
      if (m.author_kind !== 'agent') continue;
      const at = Date.parse(m.created_at);
      const run = (ended ?? []).find((r) => r.agent_id === m.author_id && r.machine_id && r.started_at && r.ended_at && Date.parse(r.started_at) - 5_000 <= at && at <= Date.parse(r.ended_at) + 15_000);
      if (!run) continue;
      const mach = (machines ?? []).find((x) => x.id === run.machine_id);
      const where = !mach ? 'a machine' : mach.kind === 'runner' || (mach.kind === 'member' && mach.owner_user_id === me) ? 'your cloud machine' : mach.name;
      const secs = Math.max(1, Math.round((Date.parse(run.ended_at!) - Date.parse(run.started_at!)) / 1000));
      out.set(m.id, `on ${where} · replied in ${secs < 90 ? `${secs}s` : `${Math.round(secs / 60)}m`}`);
    }
    return out;
  }, [messages, ended, machines, me]);
  const rootAuthor = root ? (root.author_kind === 'human' ? 'you' : agentById.get(root.author_id)?.name ?? 'agent') : null;

  // A REPLY CAN CARRY A PICTURE. The message row goes down first and the artifact names it, because
  // the ps_crud artifacts branch is gated on message_id: an attachment written without one is
  // dropped and the picture never arrives.
  async function post(body: string) {
    const uid = currentUserId();
    if (!uid || !head) return;
    const messageId = await sendReply({ workspace: head.workspace_id, channelId: head.channel_id, threadId: head.id, taskId: head.task_id, body, authorId: uid });
    if (photo) {
      await attachPhoto({ workspace: head.workspace_id, channelId: head.channel_id, taskId: head.task_id, messageId, photo });
      setPhoto(null);
    }
  }

  async function choosePhoto(from: 'photos' | 'files') {
    setPicking(true);
    setTrouble('');
    try {
      const p = from === 'photos' ? await pickPhoto() : await pickFile();
      if (p) setPhoto(p);
    } catch (e) {
      // the picker's own sentence: a refused permission and a photo too big are different problems
      setTrouble(e instanceof Error ? e.message : 'That file could not be attached.');
    } finally {
      setPicking(false);
    }
  }

  const toks = head ? [
    <StatusChip key="status" status={ts.status} />,
    <Chip key="mode" label={head.mode === 'chat' ? 'chat' : head.task_id ? 'task' : 'chat'} color={t.muted} quiet />,
    machine ? <Tok key="m" icon={<Icon name={machine.kind === 'local' ? 'machine' : 'cloud'} size={12} color={t.muted} />}>{machine.name}</Tok> : head.origin ? <Tok key="o">{head.origin === 'web' ? 'auto' : head.origin}</Tok> : null,
    crew.length ? <Tok key="crew" icon={<Icon name="agents" size={12} color={t.muted} />}>{crew.slice(0, 3).join(' · ')}</Tok> : null,
    ts.status === 'needs_you' && ts.threadId ? <SettlePill key="settle" onPress={() => void ts.settle(head.title ?? 'This thread')} /> : ts.undo ? <SettlePill key="undo" label="Undo" onPress={() => void ts.unsettle()} /> : null,
  ].filter(Boolean) : [];

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: t.bg }}>
      <Stack.Screen options={{ headerShown: false }} />
      <OfflineBanner />
      <View style={{ paddingTop: 4 }}>
        <SessionHead crumb={head ? `#${head.channel_slug} · conversations` : ''} title={head?.title ?? ''} toks={toks as never[]} onBack={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))} />
      </View>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={0}>
        <View style={{ flex: 1 }}>
          <ScrollView ref={scrollRef} onScroll={onScroll} scrollEventThrottle={16} onContentSizeChange={onContentSizeChange} contentContainerStyle={{ paddingVertical: 4 }}>
            <MessageList messages={messages ?? []} agents={agents ?? []} attachments={attachments ?? []} onAnswer={post} onSuggest={setDraft} taskId={head?.task_id ?? undefined} notes={notes} />
            {live ? <LiveLine who={liveAgent?.name ?? 'an agent'} verb={`${live.step?.trim() || 'working'}${live.total ? ` · ${live.done ?? 0}/${live.total}` : ''}`} /> : null}
          </ScrollView>
          <JumpToLatest visible={showJump} onPress={() => scrollToBottom(true)} />
        </View>
        {/* WHO IS WORKING, AND WHETHER ANYTHING CAN (George, 2026-09-06: "no orb thinking state or
            thinker when my message was sent or streaming"). A room and a task both carried this
            strip; the conversation you land in after New chat never did, so a send sat in silence
            with no way to tell a thinking agent from a dead one. Same component, same truth. */}
        {head?.channel_id ? (
          <ActivityStrip channelId={head.channel_id} threadId={id} machineId={head.machine_id} awaiting={awaiting} />
        ) : null}
        <ComposerCard value={draft} onChange={setDraft} placeholder="Reply…" alsoSendable={!!photo}
          note={trouble ? <Text style={{ ...F.body(400), fontSize: 11.5, color: t.warn }} numberOfLines={2}>{trouble}</Text>
            : photo ? <Text style={{ ...F.mono(500), fontSize: 10.5, color: t.dim }} numberOfLines={1}>{`${photo.name} · rides with your next message`}</Text> : undefined}
          chips={head && ws ? (
            <ThreadChips workspace={ws} threadId={head.id} channelId={head.channel_id} brainRaw={head.brain_override ?? null}
              onMention={(name) => setDraft((d) => (d.includes(`@${name}`) ? d : `@${name} ${d.trimStart()}`))}
              onPhoto={(from) => void choosePhoto(from)} photoBusy={picking} />
          ) : undefined}
          reply={root && root.thread_id !== id && rootAuthor ? <ReplyTo who={rootAuthor} text={root.body.split('\n')[0] ?? ''} /> : undefined}
          onSend={async () => { const b = draft.trim(); if (!b && !photo) return; setDraft(''); await post(b); }} />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
