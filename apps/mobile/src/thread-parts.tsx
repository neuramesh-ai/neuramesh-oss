// THE THREAD'S PARTS (docs/35 §3.4, docs/33 §3 — the mobile-cloud round D5): one session head
// (crumb · title · toks), the human's hairline bubble, agent prose on the ground, the live line,
// the unit-card LINE (a ‹task:id› is a line, not a card), an attachment, the reply-to card, and the
// composer — an elevated card with its chips row and the round brand send. Every thread screen
// (a conversation, a task, a room, later a Code session) composes these and nothing else.
import { type ReactNode } from 'react';
import { Pressable, ScrollView, Text, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from './icon';
import type { IconName } from '@neuramesh/client-core';
import { Chip } from './kit';
import { Dial, Orb, rowStateLabel } from './session-row';
import { useTheme } from './theme';
import { F, R } from './type';
import { stateColor } from './ui';

export function SessionHead({ crumb, title, toks, onBack }: { crumb: string; title?: string | null; toks?: ReactNode[]; onBack: () => void }) {
  const t = useTheme();
  return (
    <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
      <Pressable onPress={onBack} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 }}>
        <Icon name="arrowL" size={13} color={t.dim} />
        <Text style={{ ...F.mono(500), fontSize: 10.5, letterSpacing: F.track, color: t.dim }} numberOfLines={1}>{crumb}</Text>
      </Pressable>
      {title ? <Text style={{ ...F.body(600), fontSize: 16, lineHeight: 21, letterSpacing: -0.16, color: t.text, marginTop: 4 }} numberOfLines={3}>{title}</Text> : null}
      {toks && toks.length ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 7, alignItems: 'center' }}>{toks}</View> : null}
    </View>
  );
}

/** the human keeps the hairline bubble (D5 = B): a light shape, right-leaning, never a filled block */
export function HumanBubble({ children }: { children: ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ marginTop: 8, marginBottom: 8, marginRight: 16, marginLeft: 64, paddingVertical: 9, paddingHorizontal: 12, borderWidth: 1, borderColor: t.border, borderTopLeftRadius: R.lg, borderTopRightRadius: R.lg, borderBottomRightRadius: R.pill, borderBottomLeftRadius: R.lg, backgroundColor: t.panel }}>
      <Text style={{ ...F.body(400), fontSize: 13.5, lineHeight: 20, color: t.text }}>{children}</Text>
    </View>
  );
}

/** an agent's turn: avatar · name · role · time, then prose on the ground — no box */
export function AgentTurn({ avatar, who, role, time, children }: { avatar: ReactNode; who: string; role?: string | null; time: string; children: ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 9, paddingHorizontal: 16, paddingVertical: 7 }}>
      {avatar}
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
          <Text style={{ ...F.body(600), fontSize: 12, color: t.text }}>{who}</Text>
          {role ? <Text style={{ ...F.mono(500), fontSize: 10, letterSpacing: F.track, textTransform: 'uppercase', color: t.dim }}>{role}</Text> : null}
          <Text style={{ ...F.mono(500), fontSize: 10, color: t.dim, marginLeft: 'auto' }}>{time}</Text>
        </View>
        {children}
      </View>
    </View>
  );
}

/** the one live anatomy: the orb, then who and what. `who` is optional, because a machine that
 *  starts is motion with nobody's name on it; `still` drops the orb for a state that is not going
 *  anywhere, which is the difference between a wait and a dead end. `action` is the way out of a
 *  dead end — the line states the fact and the control beside it names the one move. */
export function LiveLine({ who, verb, still, tone, action }: {
  who?: string; verb: string; still?: boolean; tone?: string;
  action?: { label: string; onPress: () => void; busy?: boolean };
}) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, marginTop: 4, minHeight: 22 }}>
      {still ? <View style={{ width: 16 }} /> : <Orb size={16} />}
      {/* flex:1 so the TEXT gives way, never the control: a line that pushes its own button off
          the right edge is the composer-chip failure again (2026-09-08) in a narrower row */}
      <Text style={{ ...F.body(400), fontSize: 12.5, color: tone ?? t.muted, flex: 1 }} numberOfLines={1}>
        {who ? <Text style={{ ...F.body(600), color: t.body }}>{who}</Text> : null}
        {who ? ' · ' : ''}{verb}
      </Text>
      {action ? (
        <Pressable onPress={action.onPress} disabled={action.busy} hitSlop={10} style={{ flexShrink: 0, paddingVertical: 4, paddingHorizontal: 2 }}>
          <Text style={{ ...F.body(600), fontSize: 12.5, color: action.busy ? t.dim : t.link }} numberOfLines={1}>
            {action.busy ? 'Sending…' : action.label}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** the unit card as a LINE: dial · #n · title · chip · the one verb */
export function UnitLine({ number, title, state, go, onPress }: { number: number; title: string; state: string; go?: string | null; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 8, marginBottom: 2 }}>
      <Dial state={state} size={16} />
      <Text style={{ ...F.body(400), fontSize: 12.5, color: t.body, flexShrink: 1 }} numberOfLines={2}>
        <Text style={{ ...F.body(600), color: t.text }}>#{number}</Text> · {title}
      </Text>
      <Chip label={rowStateLabel(state)} color={stateColor(t, state)} />
      {go ? <Text style={{ ...F.body(600), fontSize: 12, color: t.link, marginLeft: 'auto' }}>{go} ›</Text> : null}
    </Pressable>
  );
}

/** the glyph for a file the phone cannot draw. One generic page for a PDF, a spreadsheet and a zip
 *  told a person nothing they did not already know from the extension. */
const FILE_GLYPH: Record<string, IconName> = {
  image: 'image', pdf: 'file', doc: 'file', sheet: 'grid', code: 'code', archive: 'archive', file: 'file',
};

export function Attachment({ name, meta, thumb, glyph, onPress }: {
  name: string; meta: string; thumb?: ReactNode; glyph?: string; onPress?: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6, borderWidth: 1, borderColor: t.cardBorder, backgroundColor: t.card, borderRadius: R.lg, paddingVertical: 6, paddingRight: 10, paddingLeft: 8, maxWidth: '100%' }}>
      {thumb ?? <Icon name={FILE_GLYPH[glyph ?? 'file'] ?? 'file'} size={18} color={t.muted} />}
      <View style={{ flexShrink: 1 }}>
        <Text style={{ ...F.body(400), fontSize: 12, color: t.body }} numberOfLines={1}>{name}</Text>
        <Text style={{ ...F.mono(500), fontSize: 10, color: t.dim }}>{meta}</Text>
      </View>
    </Pressable>
  );
}

export function ReplyTo({ who, text, onClear }: { who: string; text: string; onClear?: () => void }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 4, marginBottom: 6, paddingVertical: 7, paddingHorizontal: 10, borderLeftWidth: 2, borderLeftColor: t.link, backgroundColor: t.panel2, borderRadius: R.md }}>
      <Icon name="threads" size={13} color={t.muted} />
      <Text style={{ ...F.body(400), fontSize: 12, color: t.muted, flex: 1 }} numberOfLines={1}>Replying to <Text style={{ ...F.body(600), color: t.body }}>{who}</Text> · {text}</Text>
      {onClear ? <Pressable onPress={onClear} hitSlop={8}><Icon name="close" size={13} color={t.dim} /></Pressable> : null}
    </View>
  );
}

/** the composer (docs/33 §8): an elevated card — the textarea, then the chips row and the round brand
 *  send. CONTROLLED: the screen owns the draft, because a suggestion pill is a pre-drafted message the
 *  human still sends (the rex-pills ruling) — it fills the draft, it never sends. */
export function ComposerCard({ value, onChange, placeholder, onSend, chips, note, reply, autoFocus, style, alsoSendable }: {
  value: string; onChange: (text: string) => void; placeholder: string; onSend: () => void | Promise<void>;
  chips?: ReactNode; note?: ReactNode; reply?: ReactNode; autoFocus?: boolean; style?: StyleProp<ViewStyle>;
  /** something OTHER than text makes this sendable — a held picture, today. Text was the only
   *  thing that could arm Send, so a photo-only message could be attached and never sent: the
   *  button sat greyed out over a composer that was holding something (2026-09-07). */
  alsoSendable?: boolean;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const can = value.trim().length > 0 || !!alsoSendable;
  return (
    <View style={[{ paddingHorizontal: 12, paddingTop: 8, paddingBottom: Math.max(insets.bottom, 6) }, style]}>
      {reply}
      {note ? <View style={{ paddingHorizontal: 14, paddingBottom: 5 }}>{note}</View> : null}
      <View style={{ backgroundColor: t.card, borderWidth: 1, borderColor: t.border, borderRadius: R.md, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 9, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 2, shadowOffset: { width: 0, height: 1 } }}>
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={t.dim}
          multiline
          autoFocus={autoFocus}
          style={{ ...F.body(400), color: t.text, fontSize: 14, lineHeight: 20, minHeight: 22, maxHeight: 132, paddingTop: 0, paddingBottom: 0 }}
        />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 }}>
          {/* THE SEND BUTTON IS NOT NEGOTIABLE. The chips were a plain row, so a third chip pushed
              Send off the right edge of a 402pt phone and the composer could not send at all. The
              chips scroll, Send sits outside the scroller, and any number of chips is safe. */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled"
            style={{ flex: 1 }} contentContainerStyle={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingRight: 4 }}>
            {chips}
          </ScrollView>
          <Pressable disabled={!can} onPress={() => void onSend()} accessibilityLabel="Send" style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: can ? t.brand : t.panel3, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="arrowUp" size={17} color={can ? t.brandInk : t.dim} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

/** the mono note under the composer's box: `rex picks it up in #general · runs on george-cloud` */
export function ComposerNote({ children }: { children: ReactNode }) {
  const t = useTheme();
  return <Text style={{ ...F.mono(500), fontSize: 10.5, color: t.dim }} numberOfLines={1}>{children}</Text>;
}

/** a suggestion pill — the ghost recipe; a pre-drafted message, never a command */
/** the pill's own height — a scope strip that has to reserve room for one must not guess it */
export const PILL_H = 38;

export function GhostPill({ label, on, onPress }: { label: string; on?: boolean; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} style={{ borderWidth: 1, borderColor: on ? t.text : t.border2, backgroundColor: on ? t.panel2 : 'transparent', borderRadius: R.pill, paddingHorizontal: 16, minHeight: PILL_H, justifyContent: 'center' }}>
      <Text style={{ ...F.body(500), fontSize: 13, color: on ? t.text : t.body }}>{label}</Text>
    </Pressable>
  );
}

/** a composer chip: icon · label ▾ — the room chip, the brain pill's neighbours */
export function ComposerChip({ icon, label, glyph, onPress, open, caret = true, iconOnly }: { icon?: ReactNode; glyph?: string; label: string; onPress?: () => void; open?: boolean; caret?: boolean; iconOnly?: boolean }) {
  const t = useTheme();
  // icons only at phone width when three chips share the row (the mockup's Code composer) — the
  // note line under the box already says the words
  return (
    <Pressable onPress={onPress} disabled={!onPress} accessibilityLabel={label} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: 150, paddingHorizontal: iconOnly ? 10 : 13, minHeight: 34, borderRadius: R.pill, borderWidth: 1, borderColor: open ? t.text : t.border, backgroundColor: open ? t.panel2 : 'transparent' }}>
      {icon}
      {glyph ? <Text style={{ ...F.mono(500), fontSize: 11.5, color: open ? t.text : t.muted }}>{glyph}</Text> : null}
      {iconOnly ? null : <Text style={{ ...F.body(500), fontSize: 12, color: open ? t.text : t.muted }} numberOfLines={1}>{label}</Text>}
      {caret && onPress && !iconOnly ? <Text style={{ fontSize: 8, color: t.dim }}>▾</Text> : null}
    </Pressable>
  );
}
