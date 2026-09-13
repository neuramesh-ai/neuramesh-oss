import { TaskGateActions, type FeedbackFor } from '../../../components/TaskGateActions';
import { TaskShipPlan, TaskSubtasks } from '../../../components/TaskSections';
import { journeyFor } from '@neuramesh/shared';
import type { HumanCommandInput } from '@neuramesh/shared';
import { usePowerSync, useQuery } from '@powersync/react-native';
import { randomUUID } from 'expo-crypto';
import { Stack, useLocalSearchParams } from 'expo-router';
import { type ReactNode, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, currentUserId } from '../../../src/auth';
import { OfflineBanner } from '../../../src/connection';
import { useTheme } from '../../../src/theme';
import { JumpToLatest, MessageList, type ThreadAgent, type ThreadMessage, useThreadScroll } from '../../../src/thread';
import { ComposerCard } from '../../../src/thread-parts';
import { ActivityStrip } from '../../../src/thread-activity';
import { StateChip } from '../../../src/ui';
import { SettlePill, StatusChip } from '../../../src/status-chip';
import { useThreadStatus } from '../../../src/thread-status';
import { TaskArtifacts } from '../../../src/task-artifacts';
import { F, R } from '../../../src/type';
import { inputStyle, labelText, Btn } from '../../../src/kit';

interface TaskRow {
  id: string;
  number: number;
  title: string;
  description: string;
  state: string;
  kind: string | null;
  definition_of_done: string;
  ship_plan: string | null;
  parent_task_id: string | null;
  repo_id: string | null;
  assignee_kind: string;
  assignee_id: string;
  branch: string;
  pr_url: string;
  pr_number: number;
  channel_id: string;
  workspace_id: string;
}

interface ArtifactRow {
  id: string;
  kind: string;
  name: string;
}



export default function TaskDetail() {
  const t = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = usePowerSync();
  const insets = useSafeAreaInsets();
  const { data } = useQuery<TaskRow>(
    'select id, number, title, description, state, kind, definition_of_done, ship_plan, parent_task_id, repo_id, assignee_kind, assignee_id, branch, pr_url, pr_number, channel_id, workspace_id from tasks where id = ? limit 1',
    [id],
  );
  // agents drive both the assignee name and the thread avatars/roles. Scoped to THIS task's
  // workspace (0113) — the row already carries it.
  const { data: agents } = useQuery<ThreadAgent>('select id, name, emoji, role from agents where workspace_id = ?', [data?.[0]?.workspace_id ?? '']);
  // subtasks (docs/24): this task's companion work, folded under it
  const { data: subtaskRows } = useQuery<{ id: string; number: number; title: string; state: string; assignee_id: string | null }>(
    'select id, number, title, state, assignee_id from tasks where parent_task_id = ? order by created_at', [id],
  );
  // the task's own thread (thread-per-task) — messages carrying this task_id.
  const { data: messages } = useQuery<ThreadMessage>('select id, author_kind, author_id, body, created_at from messages where task_id = ? order by created_at', [id]);
  // Artifacts synced for this task (plans, mockups, diffs, screenshots) — inline_content is
  // already on-device, so the viewer renders with zero network. Tap a row to open it.
  const { data: artifactRows } = useQuery<ArtifactRow>('select id, kind, name, created_at from artifacts where task_id = ? order by created_at', [id]);
  const [busy, setBusy] = useState(false);
  const [feedbackFor, setFeedbackFor] = useState<FeedbackFor>(null);
  const [draft, setDraft] = useState('');
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState<string | null>(null);
  // the thread's status and its one act (the thread-status round): found through the task's thread
  const ts = useThreadStatus({ taskId: id });
  const task = data?.[0];
  // Task threads open at the top (task summary first); the button jumps to the newest message.
  const { scrollRef, showJump, onScroll, onContentSizeChange, scrollToBottom } = useThreadScroll(false);

  async function run(cmd: HumanCommandInput) {
    setBusy(true);
    setError(null);
    try {
      await api.command(cmd);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'action failed');
    } finally {
      setBusy(false);
      setFeedbackFor(null);
      setFeedback('');
    }
  }

  // A reply to the task thread: a local PowerSync insert (offline-capable) that uploads
  // as a task-scoped message — the same path the channel composer uses.
  async function postToTask(body: string) {
    const uid = currentUserId();
    if (!uid || !task) return;
    await db.execute(
      'insert into messages (id, workspace_id, channel_id, task_id, author_kind, author_id, body, created_at, pinned) values (?, ?, ?, ?, ?, ?, ?, ?, 0)',
      [randomUUID(), task.workspace_id, task.channel_id, task.id, 'human', uid, body, new Date().toISOString()],
    );
  }


  if (!task) {
    return (
      <View style={{ flex: 1, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center' }}>
        <Stack.Screen options={{ headerShown: true, title: '', headerStyle: { backgroundColor: t.bg }, headerTintColor: t.text }} />
        <ActivityIndicator color={t.accent} />
      </View>
    );
  }

  const meta = (k: string, v: ReactNode) => (
    <View style={{ flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 6 }}>
      <Text style={{ color: t.dim, fontSize: 11.5, width: 82 }}>{k}</Text>
      <View style={{ flex: 1 }}>{typeof v === 'string' ? <Text style={{ color: t.body, fontSize: 12 }}>{v}</Text> : v}</View>
    </View>
  );
  const label = { ...labelText(t, 11), paddingHorizontal: 16, paddingTop: 16, paddingBottom: 6 };

  function submitFeedback() {
    const text = feedback.trim();
    if (!text || !feedbackFor) return;
    if (feedbackFor === 'task.block') void run({ type: 'task.block', taskId: id, reason: text });
    else if (feedbackFor === 'task.revise_plan') void run({ type: 'task.revise_plan', taskId: id, feedback: text });
    else if (feedbackFor === 'task.revise_ship_plan') {
      // the packet marker is load-bearing: the shipper's redraft reads its feedback
      // from this thread line (mirrors the desktop composer)
      void postToTask(`📦 Release-plan changes requested on #${task!.number}:\n${text}`).catch(() => {});
      void run({ type: 'task.revise_ship_plan', taskId: id, feedback: text });
    }
    else void run({ type: 'task.request_changes', taskId: id, feedback: text });
  }

  const actions = <TaskGateActions task={task!} id={id} t={t} busy={busy} run={run} setFeedbackFor={setFeedbackFor} />;


  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <Stack.Screen options={{ headerShown: true, title: `NM-${task.number}`, headerStyle: { backgroundColor: t.bg }, headerTintColor: t.text }} />
      <OfflineBanner />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
        <View style={{ flex: 1 }}>
        <ScrollView ref={scrollRef} onScroll={onScroll} scrollEventThrottle={16} onContentSizeChange={onContentSizeChange} contentContainerStyle={{ paddingBottom: 12 }} keyboardShouldPersistTaps="handled">
          <View style={{ paddingHorizontal: 16, paddingTop: 12, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <StateChip state={task.state} />
            <StatusChip status={ts.status} />
            {ts.status === 'needs_you' && ts.threadId ? <SettlePill onPress={() => void ts.settle(task.title)} /> : ts.undo ? <SettlePill label="Undo" onPress={() => void ts.unsettle()} /> : null}
          </View>
          <Text style={{ color: t.text, ...F.display(), fontSize: 17, letterSpacing: F.tight(17), paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8 }}>{task.title}</Text>
          {(() => {
            // the phase spectrum (docs/24): derived from state + routing evidence;
            // no hover on touch — the bar is the summary, the board names phases
            if (task.parent_task_id) return null;
            const legs = journeyFor(
              { state: task.state, kind: task.kind, blockedFrom: null, hasDesignRound: (artifactRows ?? []).some((a) => a.kind === 'design'), hasPlanDoc: (artifactRows ?? []).some((a) => a.name?.startsWith('implementation-plan')), repoBacked: !!task.repo_id || !!task.pr_number, shipGate: true, assigneeName: (agents ?? []).find((a) => a.id === task.assignee_id)?.name ?? null },
              { designer: (agents ?? []).find((a) => a.role === 'designer')?.name ?? null, architect: (agents ?? []).find((a) => a.role === 'architect')?.name ?? null, developer: (agents ?? []).find((a) => a.role === 'developer' || a.role === 'worker')?.name ?? null, reviewer: (agents ?? []).find((a) => a.role === 'reviewer')?.name ?? null, shipper: (agents ?? []).find((a) => a.role === 'shipper')?.name ?? null },
            );
            if (legs.length < 2) return null;
            const hue = (v: string): string => ({ '--design': t.design, '--plan': t.plan, '--prog': t.prog, '--review': t.review, '--ship': t.ship, '--acc': t.acc } as Record<string, string>)[v] ?? t.muted;
            return (
              <View style={{ flexDirection: 'row', gap: 3, paddingHorizontal: 16, paddingBottom: 10 }}>
                {legs.map((l) => (
                  <View key={l.key} style={{ flex: 1, height: 4, borderRadius: 3, overflow: 'hidden', backgroundColor: l.status === 'done' ? hue(l.colorVar) : `${hue(l.colorVar)}26`, borderWidth: l.status === 'gap' ? 1 : 0, borderColor: t.blocked, borderStyle: 'dashed' }}>
                    {l.status === 'live' && <View style={{ width: `${Math.round((l.fill ?? 0.5) * 100)}%`, height: '100%', backgroundColor: hue(l.colorVar), borderRadius: 3 }} />}
                  </View>
                ))}
              </View>
            );
          })()}
          {task.assignee_id
            ? meta('Assignee', (() => {
                const a = (agents ?? []).find((x) => x.id === task.assignee_id);
                return a ? `${a.emoji ? `${a.emoji} ` : ''}${a.name}` : task.assignee_kind === 'agent' ? 'agent' : 'you';
              })())
            : null}
          {task.branch ? meta('Branch', <Text style={{ color: t.body, fontSize: 11, ...F.mono(400) }}>{task.branch}</Text>) : null}
          {task.pr_number ? (
            meta(
              'Pull request',
              <Pressable onPress={() => task.pr_url && void Linking.openURL(task.pr_url)}>
                <Text style={{ color: t.blue, fontSize: 12 }}>#{task.pr_number} ↗</Text>
              </Pressable>,
            )
          ) : null}
          {task.description ? <Text style={{ color: t.body, fontSize: 13, paddingHorizontal: 16, paddingTop: 10, lineHeight: 19 }}>{task.description}</Text> : null}
          {task.definition_of_done ? (
            <>
              <Text style={label}>Definition of done</Text>
              <View style={{ marginHorizontal: 16, borderWidth: 1, borderColor: t.border, borderRadius: R.lg, backgroundColor: t.panel, padding: 12 }}>
                <Text style={{ color: t.body, fontSize: 12.5, lineHeight: 19 }}>{task.definition_of_done}</Text>
              </View>
            </>
          ) : null}

          <TaskSubtasks task={task} subtaskRows={subtaskRows} agents={agents} run={run} t={t} label={label} busy={busy} />

          <TaskShipPlan task={task} id={id} run={run} t={t} label={label} busy={busy} />

          {(artifactRows ?? []).length > 0 ? (
          <TaskArtifacts rows={artifactRows ?? []} label={label} />
          ) : null}

          <Text style={label}>Conversation</Text>
          <View style={{ borderTopColor: t.border, borderTopWidth: 1, paddingTop: 4 }}>
            {(messages ?? []).length > 0 ? (
              <MessageList messages={messages ?? []} agents={agents ?? []} onAnswer={postToTask} onSuggest={setDraft} taskId={id} />
            ) : (
              <Text style={{ color: t.dim, fontSize: 13, paddingHorizontal: 16, paddingVertical: 12 }}>No messages yet. Write one below.</Text>
            )}
          </View>
        </ScrollView>
        <JumpToLatest visible={showJump} onPress={() => scrollToBottom(true)} />
        </View>
        {/* Gate actions are pinned right on top of the input (the composer's header slot),
            not scrolled between sections. A feedback flow (request changes / block /
            revise) temporarily replaces the composer with a reason box. */}
        {error ? <Text style={{ color: t.blocked, fontSize: 12, paddingHorizontal: 16, paddingBottom: 6, backgroundColor: t.bg }}>{error}</Text> : null}
        {feedbackFor ? (
          <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: Math.max(insets.bottom, 14), borderTopColor: t.border, borderTopWidth: 1, backgroundColor: t.panel }}>
            <TextInput
              value={feedback}
              onChangeText={setFeedback}
              placeholder={feedbackFor === 'task.block' ? 'Why is it blocked?' : 'What should change?'}
              placeholderTextColor={t.dim}
              multiline
              style={{ ...inputStyle(t), minHeight: 56, marginBottom: 8 }}
            />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Btn label="Cancel" onPress={() => { setFeedbackFor(null); setFeedback(''); }} style={{ flex: 1 }} />
              <Btn kind="primary" label="Send" disabled={busy || !feedback.trim()} onPress={submitFeedback} style={{ flex: 1 }} />
            </View>
          </View>
        ) : (
          <>
            {actions ? (
              <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, backgroundColor: t.bg, borderTopColor: t.border, borderTopWidth: 1 }}>{actions}</View>
            ) : null}
            <ActivityStrip channelId={task.channel_id} />
            <ComposerCard value={draft} onChange={setDraft} placeholder={`Message #${task.number}…`} onSend={async () => { const b = draft.trim(); if (!b) return; setDraft(''); await postToTask(b); }} />
          </>
        )}
      </KeyboardAvoidingView>
    </View>
  );
}
