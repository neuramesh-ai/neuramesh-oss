// The message rows for EVERY thread on the phone — a conversation, a task's thread, a room (the
// mobile-cloud round D5, docs/35 §3.4: one anatomy). The human keeps the hairline bubble; an agent's
// prose runs on the ground under its name · role · time; a question card is the one elevated object
// in a message; a ‹task:id› is a LINE (the unit card as a line, not a card); attachments render
// inline; a ```nms suggestion block becomes ghost pills that fill the composer and never send.
// The scroll helpers stay: open at the newest message, a chevron to jump back to it.
import { ARTIFACT_REFS_FOR_WORKSPACE, SESSION_TASKS_FOR_WORKSPACE, TASK_REFS_FOR_WORKSPACE } from '@neuramesh/client-core';
import { parseAuthCard, parseQuestions, parseSuggestions, parseTaskUnitRef, readAnswers, stripSuggestions } from '@neuramesh/shared';
import { useQuery } from '@powersync/react-native';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useMemo, useRef, useState } from 'react';
import { Image, type NativeScrollEvent, type NativeSyntheticEvent, Pressable, ScrollView, Text, View } from 'react-native';
import { Icon } from './icon';
import { useTheme } from './theme';
import { fileKindOf } from './attach';
import { AgentTurn, Attachment, GhostPill, HumanBubble, UnitLine } from './thread-parts';
import { renderProse, stripCards } from './thread-prose';
import { AuthCard } from './thread-auth';
import { QuestionCard } from './thread-question';
import { F, R } from './type';
import { Avatar, timeAgo, useActiveWorkspace } from './ui';

export interface ThreadMessage {
  id: string;
  author_kind: string;
  author_id: string;
  body: string;
  created_at: string;
}
export interface ThreadAgent {
  id: string;
  name: string;
  emoji: string;
  role: string;
}
/** a chat attachment (artifacts by message_id) — the thread renders it under its message */
export interface ThreadAttachment {
  id: string;
  message_id: string | null;
  kind: string;
  name: string;
  mime: string | null;
  inline_content: string | null;
  size_bytes: number | null;
  // the picture's own shape, so an inline image is drawn at its ratio rather than a guessed one
  width: number | null;
  height: number | null;
}

export function useThreadScroll(openAtBottom: boolean) {
  const scrollRef = useRef<ScrollView>(null);
  const [showJump, setShowJump] = useState(false);
  const atBottom = useRef(openAtBottom);
  const primed = useRef(false);

  const scrollToBottom = (animated = true) => scrollRef.current?.scrollToEnd({ animated });
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const fromBottom = contentSize.height - contentOffset.y - layoutMeasurement.height;
    atBottom.current = fromBottom < 80;
    setShowJump(fromBottom > 220);
  };
  const onContentSizeChange = () => {
    if (!primed.current) {
      primed.current = true;
      if (openAtBottom) scrollToBottom(false); // open at the newest message
      return;
    }
    if (atBottom.current) scrollToBottom(true); // a new message arrived and we're at the edge
  };
  return { scrollRef, showJump, onScroll, onContentSizeChange, scrollToBottom };
}

export function JumpToLatest({ visible, onPress, bottom = 12 }: { visible: boolean; onPress: () => void; bottom?: number }) {
  const t = useTheme();
  if (!visible) return null;
  return (
    <Pressable onPress={onPress} hitSlop={8} accessibilityLabel="Jump to latest"
      style={{ position: 'absolute', alignSelf: 'center', bottom, width: 40, height: 40, borderRadius: R.pill, backgroundColor: t.panel3, borderWidth: 1, borderColor: t.border2, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 4 }}>
      <Icon name="chevron" size={20} color={t.body} />
    </Pressable>
  );
}

const fmtBytes = (n: number | null): string => (!n ? 'file' : n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

export function MessageList({ messages, agents, attachments, onAnswer, onSuggest, taskId, notes }: {
  messages: ThreadMessage[]; agents: ThreadAgent[]; attachments?: ThreadAttachment[];
  onAnswer: (text: string) => void; onSuggest?: (text: string) => void; taskId?: string;
  /** per-message mono footnotes — the run's attribution line ("on your cloud machine · replied in 4s") */
  notes?: Map<string, string>;
}) {
  const t = useTheme();
  const router = useRouter();
  const agentMap = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);
  const answers = useMemo(() => readAnswers(messages.filter((m) => m.author_kind === 'human').map((m) => m.body)), [messages]);
  const ws = useActiveWorkspace();
  const { data: taskRows } = useQuery<{ id: string; number: number }>(TASK_REFS_FOR_WORKSPACE, [ws ?? '']);
  const taskByNumber = useMemo(() => new Map((taskRows ?? []).map((r) => [r.number, r.id])), [taskRows]);
  // the unit line reads the synced task row — the card is a lens, never a copy (cards.ts)
  const { data: unitRows } = useQuery<{ id: string; number: number; title: string; state: string }>(SESSION_TASKS_FOR_WORKSPACE, [ws ?? '']);
  const unitById = useMemo(() => new Map((unitRows ?? []).map((r) => [r.id, r])), [unitRows]);
  const { data: artRows } = useQuery<{ id: string; name: string; task_id: string }>(ARTIFACT_REFS_FOR_WORKSPACE, [ws ?? '']);
  const artifactByName = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of artRows ?? []) if (!m.has(a.name) || a.task_id === taskId) m.set(a.name, a.id);
    return m;
  }, [artRows, taskId]);
  const attsByMessage = useMemo(() => {
    const m = new Map<string, ThreadAttachment[]>();
    for (const a of attachments ?? []) if (a.message_id) m.set(a.message_id, [...(m.get(a.message_id) ?? []), a]);
    return m;
  }, [attachments]);
  const openTask = (id: string) => router.push(`/task/${id}`);
  const openArtifact = (aid: string) => router.push(`/artifact/${aid}`);
  const openUrl = (url: string) => void WebBrowser.openBrowserAsync(url).catch(() => {});
  const unitGo = (state: string) => (state === 'plan_review' ? 'Approve plan' : state === 'design_review' ? 'Review design' : state === 'done' ? 'Accept' : 'Open');
  const last = messages[messages.length - 1];

  return (
    <>
      {messages.map((m) => {
        const atts = attsByMessage.get(m.id) ?? [];
        // A PICTURE IS CONTENT, NOT AN ATTACHMENT (George, 2026-09-07). A filename row with a 40x30
        // thumbnail asks a person to tap before they can see the one thing the message is about, and
        // the desktop has rendered deliverables inline since #202. So an image with bytes draws
        // itself, at its own shape, and everything else keeps the row — now with a glyph that says
        // what it is rather than one generic page for a PDF, a spreadsheet and a zip alike.
        const attachmentRows = atts.map((a) => {
          const drawable = (a.mime ?? '').startsWith('image/') && !!a.inline_content?.startsWith('data:');
          if (drawable) {
            const ratio = a.width && a.height ? a.width / a.height : 4 / 3;
            return (
              <Pressable key={a.id} onPress={() => openArtifact(a.id)} accessibilityLabel={a.name}
                style={{ marginTop: 6, borderRadius: R.lg, overflow: 'hidden', borderWidth: 1, borderColor: t.cardBorder, maxWidth: '100%' }}>
                {/* capped, so a tall photo cannot push the reply it belongs to off the screen */}
                <Image source={{ uri: a.inline_content ?? '' }} style={{ width: '100%', aspectRatio: ratio, maxHeight: 280, backgroundColor: t.panel3 }} resizeMode="cover" />
              </Pressable>
            );
          }
          return (
            <Attachment key={a.id} name={a.name} meta={`${fmtBytes(a.size_bytes)} · ${a.kind}`} onPress={() => openArtifact(a.id)}
              glyph={fileKindOf(a.name, a.mime)} />
          );
        });
        if (m.author_kind === 'human') {
          // A PICTURE ON ITS OWN IS A WHOLE MESSAGE. The composer can send one with no words, and
          // the bubble was drawn unconditionally, so an attachment-only send left an empty rounded
          // box above its own thumbnail (2026-09-07).
          const said = stripCards(m.body).trim();
          return (
            <View key={m.id}>
              {said ? <HumanBubble>{said}</HumanBubble> : null}
              {attachmentRows.length ? <View style={{ alignItems: 'flex-end', paddingHorizontal: 16 }}>{attachmentRows}</View> : null}
            </View>
          );
        }
        const agent = agentMap.get(m.author_id);
        const questions = parseQuestions(m.body);
        // the credential card: prose alone left the reader at "choose how to proceed:" with nothing to choose
        const authCard = parseAuthCard(m.body);
        const unit = parseTaskUnitRef(m.body);
        const suggestions = m.id === last?.id && onSuggest ? parseSuggestions(m.body) : [];
        // the prose IS the card's fallback: authBlockedCard degrades to a readable note for a
        // renderer that has no card. Once the card draws, printing both says it twice.
        const prose = authCard ? '' : stripSuggestions(stripCards(unit ? unit.prose : m.body)).trim();
        const unitRow = unit ? unitById.get(unit.id) : undefined;
        return (
          <AgentTurn key={m.id} who={agent?.name ?? 'agent'} role={agent?.role} time={timeAgo(m.created_at)} avatar={<Avatar emoji={agent?.emoji} label={agent?.name} size={28} />}>
            {prose ? <Text style={{ ...F.body(400), fontSize: 13.5, lineHeight: 21, color: t.body, marginTop: 2 }}>{renderProse(prose, taskByNumber, artifactByName, openTask, openArtifact, openUrl, t)}</Text> : null}
            {attachmentRows}
            {notes?.get(m.id) ? <Text style={{ ...F.mono(500), fontSize: 10.5, color: t.dim, marginTop: 6 }}>{notes.get(m.id)}</Text> : null}
            {questions.length > 0 ? <QuestionCard questions={questions} answers={answers} onAnswer={onAnswer} /> : null}
            {authCard ? <AuthCard auth={authCard} agentId={m.author_id} /> : null}
            {unit ? (unitRow
              ? <UnitLine number={unitRow.number} title={unitRow.title} state={unitRow.state} go={unitGo(unitRow.state)} onPress={() => openTask(unit.id)} />
              : <Pressable onPress={() => openTask(unit.id)}><Text style={{ ...F.body(600), fontSize: 12.5, color: t.link, marginTop: 6 }}>▸ filed a task ›</Text></Pressable>) : null}
            {suggestions.length ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                {suggestions.map((s) => <GhostPill key={s} label={s} onPress={() => onSuggest?.(s)} />)}
              </View>
            ) : null}
          </AgentTurn>
        );
      })}
    </>
  );
}
