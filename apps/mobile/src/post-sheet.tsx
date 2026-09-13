// A CALENDAR ITEM, OPENED (the mobile fix round, 2026-09-06; George: "draft items as draft, which
// users can click, edit and reschedule, e.g. generate image for an X draft, reschedule it").
//
// This is the desktop's SocialPostCard at phone width, and its buttons are commands that already
// exist: `content.approve` takes a future time, `content.unschedule` returns a post to the draft
// band, and a picture is a message carrying the `‹gen-image:›` marker the daemon reads, which is
// exactly what the desktop's Generate button sends. Nothing new on the server.
//
// THE COPY IS EDITABLE HERE (George, 2026-09-06: "it doesn't look like I can edit the text on a
// draft, or calendar item; I should be able to just like I'm able to on web"). `content.update` is
// HUMAN_ONLY on the server and always could take this edit. The phone simply never offered it, so a
// typo you could see on the phone had to wait for a desk. Published copy stays read-only, because a
// published post is history.
//
// A picture is DRAWN ON A MACHINE, never here. The phone holds no image credential and runs no
// model, so the button asks the room's crew and the row comes back through sync. That is why it
// says "Please wait…" and then leaves: pretending to draw would be the lie.
import { useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Image, Modal, PanResponder, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { api } from './auth';
import { Icon } from './icon';
import { Btn, inputStyle } from './kit';
import { errMsg } from './onboard';
import { canDrawPicture, drawRequest, hasPicture, platformName, postMedia, slotFields, slotToIso, type PostItem } from './post-item';
import { useTheme } from './theme';
import { F, R } from './type';

export function PostSheet({ workspace, item, roomSlug, onClose, onOpenThread, onStep, place }: {
  workspace: string;
  item: PostItem;
  roomSlug: string;
  onClose: () => void;
  /** move to the neighbouring draft: -1 back, 1 on. Absent when there is nowhere to go */
  onStep?: (delta: -1 | 1) => void;
  /** which one of how many, so the swipe is discoverable rather than a secret */
  place?: { at: number; of: number };
  /** a change is a conversation, so the sheet hands off to the room rather than inventing a field */
  onOpenThread: (threadId: string) => void;
}) {
  const t = useTheme();
  const media = useMemo(() => postMedia(item), [item]);
  const initial = useMemo(() => slotFields(item), [item]);
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [text, setText] = useState(item.body);
  // the row is live, so a rewrite from the room lands under your thumb — adopt it unless you are
  // mid-edit, which `dirty` is exactly the question of
  const dirty = text.trim() !== item.body.trim();
  useEffect(() => { if (!dirty) setText(item.body); }, [item.body]); // eslint-disable-line react-hooks/exhaustive-deps
  // A DIFFERENT DRAFT IS A DIFFERENT EDITOR. The sheet can now walk the band, and the effect above
  // only adopts a rewrite of the SAME row: against a new row its `dirty` reads true, so the swipe
  // carried the previous draft's text, its time and its unsaved-changes buttons onto the next one.
  // Identity is the reset, and it is the only thing that may reset an edit in progress.
  useEffect(() => {
    setText(item.body);
    setDate(initial.date);
    setTime(initial.time);
    setErr('');
  }, [item.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  // a draft hangs off its conversation OR its task (0115), and the ask has to land on whichever one
  // it is, or the button works on half the drafts and quietly does nothing on the rest
  const threadId = item.thread_id;
  const anchor = threadId ? { threadId } : item.task_id ? { taskId: item.task_id } : null;
  const scheduled = item.status === 'scheduled';
  const published = item.status === 'published';

  async function run(key: string, work: () => Promise<unknown>, close = true) {
    if (busy) return;
    setBusy(key);
    setErr('');
    try { await work(); if (close) onClose(); } catch (e) { setErr(errMsg(e)); } finally { setBusy(null); }
  }

  function schedule() {
    const iso = slotToIso(date, time);
    if (!iso) { setErr('Use the date format YYYY-MM-DD and the 24-hour time HH:MM.'); return; }
    if (new Date(iso).getTime() <= Date.now()) { setErr('Pick a time in the future.'); return; }
    void run('slot', () => api.command({ type: 'content.approve', item: item.id, scheduledAt: iso }));
  }

  // SWIPE TO THE NEXT DRAFT (George, 2026-09-06: "i will like to be able to just swipe left or right
  // to move to. the next draft"). It claims a gesture only once it is plainly horizontal, so the
  // sheet still scrolls under a thumb and the text field still takes a caret. `onStep` lives in a
  // ref because PanResponder captures its handlers once, on the first render.
  const step = useRef(onStep);
  step.current = onStep;
  const swipe = useMemo(
    () =>
      PanResponder.create({
        // CAPTURE, not bubble. The sheet's body is a ScrollView holding a multiline TextInput, and
        // both claim a touch before a parent ever sees it, so the bubbling handler never fired. The
        // capture phase asks the parent FIRST, and the predicate keeps it honest: a drag is only
        // taken once it is plainly sideways, so the sheet still scrolls and the field still takes a
        // caret. A tap is never a move, so nothing here costs a tap.
        onStartShouldSetPanResponderCapture: () => false,
        onMoveShouldSetPanResponderCapture: (_e, g) => Math.abs(g.dx) > 24 && Math.abs(g.dx) > Math.abs(g.dy) * 2,
        onPanResponderTerminationRequest: () => false,
        onPanResponderRelease: (_e, g) => {
          if (Math.abs(g.dx) < 56) return;
          step.current?.(g.dx < 0 ? 1 : -1);
        },
      }),
    [],
  );

  const label = (s: string) => <Text style={{ ...F.mono(500), fontSize: 9.5, letterSpacing: F.track, textTransform: 'uppercase', color: t.dim, marginBottom: 6 }}>{s}</Text>;
  const field = (value: string, onChange: (v: string) => void, placeholder: string) => (
    <TextInput value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={t.dim} autoCapitalize="none" autoCorrect={false}
      style={{ ...inputStyle(t, false, true), minHeight: 42 }} />
  );

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: '#00000066' }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={{ backgroundColor: t.bg, borderTopLeftRadius: R.lg, borderTopRightRadius: R.lg, maxHeight: '88%', paddingBottom: 24 }}>
          {/* THE HEAD IS THE GRIP. A UIScrollView claims its own touches natively, so a swipe over
              the body can never reach a parent responder — the gesture lives here, above the
              scroller, where the sheet is already dragged. The arrows are not a fallback: they are
              the control that names itself, and they work under any thumb. */}
          <View {...swipe.panHandlers} style={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 4 }}>
            <View style={{ alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: t.border2 }} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, minHeight: 26 }}>
              <View style={{ flex: 1 }}>{label(`${item.status} · ${platformName(item.platform)} · #${roomSlug}`)}</View>
              {place && onStep ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                  <Pressable onPress={() => onStep(-1)} hitSlop={10} accessibilityLabel="The draft before this one" style={{ paddingHorizontal: 6, paddingVertical: 2 }}>
                    <Icon name="arrowL" size={14} color={t.muted} />
                  </Pressable>
                  <Text style={{ ...F.mono(500), fontSize: 10.5, color: t.dim }}>{`${place.at} of ${place.of}`}</Text>
                  <Pressable onPress={() => onStep(1)} hitSlop={10} accessibilityLabel="The next draft" style={{ paddingHorizontal: 6, paddingVertical: 2 }}>
                    <Icon name="arrowR" size={14} color={t.muted} />
                  </Pressable>
                </View>
              ) : null}
            </View>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 2 }}>
            {published ? (
              <Text style={{ ...F.body(400), fontSize: 14, lineHeight: 21, color: t.text }}>{item.body}</Text>
            ) : (
              <TextInput value={text} onChangeText={setText} multiline scrollEnabled={false} textAlignVertical="top"
                accessibilityLabel="The post's text"
                style={{ ...inputStyle(t), fontSize: 14, lineHeight: 21, borderColor: dirty ? t.link : t.border, padding: 12, minHeight: 128 }} />
            )}
            {dirty ? (
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 8, alignItems: 'center' }}>
                <Btn sm kind="primary" label={busy === 'copy' ? 'Please wait…' : 'Save the text'} disabled={!!busy}
                  onPress={() => void run('copy', () => api.command({ type: 'content.update', item: item.id, body: text.trim() }), false)} />
                <Btn sm label="Undo" disabled={!!busy} onPress={() => setText(item.body)} />
              </View>
            ) : null}

            {hasPicture(media) ? (
              <Image source={{ uri: media?.thumb || media?.image_url }} resizeMode="cover"
                style={{ width: '100%', height: 190, borderRadius: R.lg, marginTop: 12, backgroundColor: t.panel2 }} />
            ) : null}
            {media?.brief ? (
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, alignItems: 'flex-start' }}>
                <Icon name="image" size={13} color={t.dim} />
                <Text style={{ ...F.body(400), fontSize: 12, lineHeight: 17, color: t.muted, flex: 1 }}>{media.brief}</Text>
              </View>
            ) : null}
            {media?.image_error ? <Text style={{ ...F.body(400), fontSize: 12, lineHeight: 17, color: t.warn, marginTop: 8 }}>{media.image_error}</Text> : null}
            {/* THE SHEET STAYS OPEN on a draw. Every other action here ends the card's business,
                but a draw starts a wait: the picture lands on this very row a moment later, and
                closing on success read as the card giving up (George, 2026-09-06: "sometimes the
                component just closes on its own when i click generate"). */}
            {canDrawPicture(item) && anchor ? (
              <View style={{ flexDirection: 'row', marginTop: 10 }}>
                <Btn sm label={busy === 'draw' ? 'Please wait…' : hasPicture(media) ? 'Draw it again' : 'Generate a picture'} disabled={!!busy}
                  icon={<Icon name="image" size={14} color={t.text} />}
                  onPress={() => void run('draw', () => api.postMessage({ workspace, channel: item.channel_id, ...anchor, body: drawRequest(item.id, hasPicture(media)) }), false)} />
              </View>
            ) : null}

            {published ? (
              <View style={{ marginTop: 16 }}>
                <Text style={{ ...F.body(400), fontSize: 12.5, color: t.muted }}>
                  This went live{item.published_at ? ` on ${new Date(item.published_at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })}` : ''}.
                </Text>
              </View>
            ) : (
              <View style={{ marginTop: 16 }}>
                {label('When it publishes')}
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                  <View style={{ flex: 1 }}>{field(date, setDate, 'YYYY-MM-DD')}</View>
                  <View style={{ width: 92 }}>{field(time, setTime, '09:00')}</View>
                </View>
                <Text style={{ ...F.mono(500), fontSize: 10.5, color: t.dim, marginTop: 6 }}>{tz}</Text>
              </View>
            )}

            {err ? <Text style={{ ...F.body(400), fontSize: 12.5, lineHeight: 18, color: t.warn, marginTop: 10 }}>{err}</Text> : null}

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16 }}>
              {published ? null : (
                <Btn sm kind="primary" label={busy === 'slot' ? 'Please wait…' : scheduled ? 'Move it' : 'Schedule it'} disabled={!!busy} onPress={schedule} />
              )}
              {scheduled ? (
                <Btn sm label={busy === 'off' ? 'Please wait…' : 'Back to draft'} disabled={!!busy}
                  onPress={() => void run('off', () => api.command({ type: 'content.unschedule', item: item.id }))} />
              ) : null}
              {threadId ? <Btn sm label="Open the room" onPress={() => { onClose(); onOpenThread(threadId); }} /> : null}
              <Btn sm label="Close" onPress={onClose} />
            </View>
            <Text style={{ ...F.body(400), fontSize: 12, lineHeight: 17, color: t.dim, marginTop: 12 }}>
              {published ? 'A published post is history. Ask the room for a new one.'
                : scheduled ? 'It publishes at the time above. Back to draft holds it.'
                  : 'Scheduling it publishes at the time you set. Ask the room for a rewrite.'}
            </Text>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
