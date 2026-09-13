// ONE ROW ANATOMY (docs/35 §3.2, the mobile-cloud round D3): glyph · title + snippet · meta
// (chip · when/room). A task wears its DIAL (the phase ring, filled to where the journey stands),
// a chat the speech glyph, a Code session the prompt glyph, a routine's run the clock; an open run
// swaps the glyph for the thinking orb; a question waiting on you pulses at the trailing edge.
// Home, History and (later) the Code tab draw this and nothing else — a second row recipe is how
// the desktop's chat and task rows diverged by accident (one-thread unification).
import { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, Text, View } from 'react-native';
import { dialFraction } from '@neuramesh/shared';
import Svg, { Circle } from 'react-native-svg';
import { Icon } from './icon';
import { Chip } from './kit';
import { useTheme } from './theme';
import { F, R } from './type';
import { stateColor } from './ui';

export type RowKind = 'chat' | 'task' | 'code' | 'routine';

/** the row's word for a state — the LEG it stands in, not the FSM's noun (a row says what is happening) */
const ROW_LABEL: Record<string, string> = { plan_review: 'plan review', design_review: 'design review', in_progress: 'build', in_review: 'review', done: 'accept?', backlog: 'idea', ship_review: 'ship review' };
export const rowStateLabel = (state: string): string => ROW_LABEL[state] ?? state.replace(/_/g, ' ');

/** the phase dial: a ring filled to the journey's fraction, in the state's hue, on a dim track */
export function Dial({ state, size = 18 }: { state: string; size?: number }) {
  const t = useTheme();
  const r = 6.4;
  const c = 2 * Math.PI * r;
  // the journey's fraction — the same table the desktop overlay draws from (shared/dial.ts)
  const frac = dialFraction(state);
  return (
    <Svg width={size} height={size} viewBox="0 0 18 18" style={{ transform: [{ rotate: '-90deg' }] }}>
      <Circle cx={9} cy={9} r={r} stroke={`${t.dim}4d`} strokeWidth={2.6} fill="none" />
      <Circle cx={9} cy={9} r={r} stroke={stateColor(t, state)} strokeWidth={2.6} fill="none" strokeDasharray={`${c * frac} ${c}`} />
    </Svg>
  );
}

/** the thinking orb (thinking-orbs on the desktop): eight dots, the lit one walking round */
export function Orb({ size = 18, color }: { size?: number; color?: string }) {
  const t = useTheme();
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 1400, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [spin]);
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const ink = color ?? t.text;
  return (
    <Animated.View style={{ width: size, height: size, transform: [{ rotate }] }}>
      <Svg width={size} height={size} viewBox="0 0 16 16">
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
          const a = (i / 8) * Math.PI * 2;
          return <Circle key={i} cx={8 + 5.6 * Math.cos(a)} cy={8 + 5.6 * Math.sin(a)} r={i === 0 ? 1.6 : 1.15} fill={ink} opacity={0.25 + 0.75 * ((8 - i) / 8)} />;
        })}
      </Svg>
    </Animated.View>
  );
}

/** the kind glyph: a hairline box (chat), a circle (routine), a tighter box (code) */
function Glyph({ kind }: { kind: RowKind }) {
  const t = useTheme();
  return (
    <View style={{ width: 18, height: 18, borderRadius: kind === 'routine' ? 9 : kind === 'code' ? 5 : 6, borderWidth: 1.5, borderColor: t.dim, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={kind === 'routine' ? 'routineClock' : kind === 'code' ? 'code' : 'threads'} size={11} color={t.dim} />
    </View>
  );
}

/** the ask pulse: a 7px accent dot in a 22% halo, at the row's trailing edge */
export function AskPulse() {
  const t = useTheme();
  return (
    <View style={{ width: 13, height: 13, borderRadius: 7, backgroundColor: `${t.accent}38`, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: t.accent }} />
    </View>
  );
}

export interface SessionRowProps {
  kind: RowKind;
  /** a task row's FSM state; a chat has none */
  state?: string | null;
  title: string;
  snip?: string;
  /** a branch or a step reads in mono */
  snipMono?: boolean;
  /** the trailing line: the room (`#build`), or `#build · 2d` */
  when: string;
  /** an open run on this session — the orb replaces the glyph */
  live?: boolean;
  /** a question waiting on you in this session */
  ask?: boolean;
  /** the chip's word when it is not the state (a Code session's mode) */
  chip?: { label: string; color?: string };
  onPress?: () => void;
  /** the settle sheet's door (settle-row.tsx) */
  onLongPress?: () => void;
  /** no side margin: the row sits inside a swipe container that carries it */
  flush?: boolean;
}

/** A ROW IS ONE HEIGHT, ALWAYS (George on the TestFlight build, 2026-09-06: rows drew on top of one
 *  another and the text came out garbled). A recycling list reuses a row's view for a later row and
 *  trusts the size it was told; the estimate was 56 while a two-line row measured taller, so the
 *  views overlapped as the list grew. One title line, one snippet line, one height, and the list has
 *  nothing left to guess. 64 also gives the row a thumb-sized target. */
export const SESSION_ROW_HEIGHT = 64;

export function SessionRow({ kind, state, title, snip, snipMono, when, live, ask, chip, onPress, onLongPress, flush }: SessionRowProps) {
  const t = useTheme();
  const chipEl = chip
    ? <Chip label={chip.label} color={chip.color ?? t.muted} quiet={!chip.color} />
    : kind === 'task' && state
      ? <Chip label={rowStateLabel(state)} color={stateColor(t, state)} />
      : <Chip label={kind} color={t.muted} quiet />;
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} style={({ pressed }) => ({ height: SESSION_ROW_HEIGHT, flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 12, marginHorizontal: flush ? 0 : 6, borderRadius: R.md, backgroundColor: pressed ? t.panel2 : flush ? t.bg : 'transparent' })}>
      {live ? <Orb /> : kind === 'task' && state ? <Dial state={state} /> : <Glyph kind={kind} />}
      <View style={{ flex: 1, minWidth: 0, gap: 1.5 }}>
        <Text style={{ ...F.body(500), fontSize: 13, color: t.text, letterSpacing: -0.07 }} numberOfLines={1}>{title}</Text>
        {snip ? <Text style={snipMono ? { ...F.mono(500), fontSize: 11, color: t.muted } : { ...F.body(400), fontSize: 11.5, color: t.muted }} numberOfLines={1}>{snip}</Text> : null}
      </View>
      <View style={{ alignItems: 'flex-end', gap: 3 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {ask ? <AskPulse /> : null}
          {chipEl}
        </View>
        <Text style={{ ...F.mono(500), fontSize: 10.5, color: t.dim }} numberOfLines={1}>{when}</Text>
      </View>
    </Pressable>
  );
}
