// THE CONVERSATION'S OWN COMPOSER CONTROLS (George, 2026-09-07: "the mobile conversation composer
// should support attaching a photo etc and mentioning an agent and brain selector").
//
// New chat had all of this and a reply had none, which is the wrong way round: the first message is
// the one you have not committed to anything yet, and a reply is where you find out the brain was
// wrong or that you need to hand the question to somebody else.
//
// Nothing here invents a lane. The brain rides `thread.set_brain`, a HUMAN_ONLY command that has
// existed on the server since the brain round and was simply never declared in the union a typed
// client can name. A mention is the product's own way of aiming a message (shared mentions.ts). A
// picture is an `artifacts` row carrying `message_id`, which is exactly what the desktop's
// insertAttachments writes.
import { AGENTS_IN_CHANNEL } from '@neuramesh/client-core';
import { STARTER_MODEL } from '@neuramesh/shared';
import { useQuery } from '@powersync/react-native';
import { useMemo, useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { api } from './auth';
import { brainOverrideFor, modelOfDraft } from './brain-draft';
import { Icon } from './icon';
import { ModelChip } from './model-chip';
import { useTheme } from './theme';
import { F, R } from './type';
import { Avatar } from './ui';

interface Crew { id: string; name: string; role: string; emoji: string | null; model: string | null }

export function ThreadChips({ workspace, threadId, channelId, brainRaw, onMention, onPhoto, photoBusy }: {
  workspace: string;
  threadId: string;
  channelId: string;
  /** threads.brain_override as the replica holds it: TEXT locally, jsonb on the server */
  brainRaw: string | null;
  onMention: (name: string) => void;
  onPhoto: (from: 'photos' | 'files') => void;
  photoBusy?: boolean;
}) {
  const t = useTheme();
  const [crewOpen, setCrewOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const { data: crew } = useQuery<Crew>(AGENTS_IN_CHANNEL, [channelId]);
  // what answers when this conversation names no brain: the seat that actually takes a chat here
  const inherited = useMemo(
    () => (crew ?? []).find((a) => a.role === 'orchestrator')?.model || (crew ?? [])[0]?.model || STARTER_MODEL,
    [crew],
  );
  const picked = modelOfDraft(brainRaw);
  // OPTIMISM WITH A LEASH: the chip shows the pick immediately, because the round trip and the
  // sync back are two waits and a control that ignores a tap for both is a broken control. The
  // replica is still the truth — `picked` wins the moment it moves.
  const [justSet, setJustSet] = useState<string | null | undefined>(undefined);
  const shown = justSet === undefined ? picked : justSet;

  async function reseat(model: string | null) {
    setJustSet(model);
    try {
      await api.command({ type: 'thread.set_brain', workspace, threadId, override: brainOverrideFor(model) });
    } catch {
      setJustSet(undefined); // refused: fall back to what the row says, never to a lie
    }
  }

  return (
    <>
      <ModelChip workspace={workspace} value={shown} inherited={inherited} onChange={(m) => void reseat(m)} />
      {(crew ?? []).length ? (
        <Pressable onPress={() => setCrewOpen(true)} accessibilityLabel="Ask one of the crew"
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 6, paddingRight: 9, minHeight: 34, borderRadius: R.pill, borderWidth: 1, borderColor: crewOpen ? t.text : t.border, backgroundColor: crewOpen ? t.panel2 : 'transparent' }}>
          {(crew ?? []).slice(0, 3).map((a, n) => <View key={a.id} style={{ marginLeft: n ? -5 : 0, borderWidth: 1, borderColor: t.card, borderRadius: 6 }}><Avatar emoji={a.emoji} label={a.name} size={16} /></View>)}
          <Icon name="chevron" size={11} color={t.muted} />
        </Pressable>
      ) : null}
      {/* THE CLIP CARRIES ITS OWN MEANING (George, 2026-09-07: "attachments shouldn't just be photo,
          could be files, pdf etc so lets remove the photo label"). A word that names only one of the
          things a control does is worse than no word, and the label was the widest thing in the row.
          CLAUDE.md #11: a control that names its own action needs no caption. */}
      <Pressable onPress={() => setAttachOpen(true)} disabled={photoBusy} accessibilityLabel="Attach a file"
        style={{ alignItems: 'center', justifyContent: 'center', width: 34, minHeight: 34, borderRadius: R.pill, borderWidth: 1, borderColor: attachOpen ? t.text : t.border, backgroundColor: attachOpen ? t.panel2 : 'transparent', opacity: photoBusy ? 0.5 : 1 }}>
        <Icon name="paperclip" size={15} color={photoBusy ? t.dim : t.muted} />
      </Pressable>

      {/* two doors, because iOS has two: the photo library knows about pictures and the document
          browser knows about everything else. One row each, glyph then name (the picker idiom). */}
      <Modal visible={attachOpen} transparent animationType="fade" onRequestClose={() => setAttachOpen(false)}>
        <Pressable onPress={() => setAttachOpen(false)} style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: '#00000040' }}>
          <View style={{ marginHorizontal: 12, marginBottom: 150, backgroundColor: t.overlay, borderWidth: 1, borderColor: t.border2, borderRadius: R.lg, padding: 7 }}>
            <Text style={{ ...F.mono(500), fontSize: 10.5, letterSpacing: F.track, color: t.dim, paddingHorizontal: 9, paddingVertical: 6 }}>Attach</Text>
            {([['photos', 'image', 'A picture'], ['files', 'file', 'A file']] as const).map(([from, glyph, label]) => (
              <Pressable key={from} onPress={() => { setAttachOpen(false); onPhoto(from); }}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 9, paddingVertical: 9, minHeight: 44, borderRadius: R.md }}>
                <Icon name={glyph} size={16} color={t.body} />
                <Text style={{ ...F.body(600), fontSize: 13, color: t.text }}>{label}</Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>

      {/* picking a name ADDRESSES it: the draft gains a mention, which is the product's own way of
          aiming a message at an agent. Nothing is routed here that the room would not route. */}
      <Modal visible={crewOpen} transparent animationType="fade" onRequestClose={() => setCrewOpen(false)}>
        <Pressable onPress={() => setCrewOpen(false)} style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: '#00000040' }}>
          <View style={{ marginHorizontal: 12, marginBottom: 150, backgroundColor: t.overlay, borderWidth: 1, borderColor: t.border2, borderRadius: R.lg, padding: 7 }}>
            <Text style={{ ...F.mono(500), fontSize: 10.5, letterSpacing: F.track, color: t.dim, paddingHorizontal: 9, paddingVertical: 6 }}>Who should answer</Text>
            {(crew ?? []).map((a) => (
              <Pressable key={a.id} onPress={() => { onMention(a.name); setCrewOpen(false); }}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 9, paddingVertical: 8, minHeight: 40, borderRadius: R.md }}>
                <Avatar emoji={a.emoji} label={a.name} size={20} />
                <View style={{ flex: 1 }}>
                  <Text style={{ ...F.body(600), fontSize: 13, color: t.text }} numberOfLines={1}>{`@${a.name}`}</Text>
                  <Text style={{ ...F.body(400), fontSize: 10.5, color: t.dim }} numberOfLines={1}>{a.role}</Text>
                </View>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </>
  );
}
