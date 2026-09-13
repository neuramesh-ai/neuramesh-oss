// The phone's primitives, one recipe each, from docs/33 (the Foundry system): the mono kicker
// (§5), the elevated card (§3 — a card hosts controls; a well never does), the 3px button (§6 —
// mono uppercase; primary rides --brand/--brand-ink under the site's static hatch, ghost wears a
// hairline), the field, the tok, the state chip, the credit ring (§8). Every new screen composes
// these; none re-derives a colour, a face or a corner.
import { type ReactNode, useState } from 'react';
import { Pressable, Text, TextInput, View, type StyleProp, type TextInputProps, type TextStyle, type ViewStyle } from 'react-native';
import Svg, { Circle, Line } from 'react-native-svg';
import type { Theme } from '@neuramesh/client-core';
import { useTheme } from './theme';
import { F, R } from './type';

/** the darks read the shadow ramp differently from the papers — one derivation, from the ground */
export function isDarkTheme(bg: string): boolean {
  const n = parseInt(bg.replace('#', ''), 16);
  return ((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114 < 128;
}

/** the label voice: mono 500, uppercase, tracked tight (-0.02em), never letterspaced */
export function labelText(t: Theme, size = 10): TextStyle {
  return { ...F.mono(500), fontSize: size, letterSpacing: F.tight(size), textTransform: 'uppercase', color: t.dim };
}

export function Kicker({ children, right, style }: { children: ReactNode; right?: ReactNode; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6 }, style]}>
      <Text style={labelText(t)}>{children}</Text>
      {right ? <View style={{ marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 4 }}>{right}</View> : null}
    </View>
  );
}

/** the elevated stratum: --card + --card-border at 8px; a hairline on the darks, a 1px shadow on paper */
export function cardStyle(t: Theme): ViewStyle {
  const dark = isDarkTheme(t.bg);
  return {
    backgroundColor: t.card, borderWidth: 1, borderColor: t.cardBorder, borderRadius: R.lg,
    shadowColor: '#000', shadowOpacity: dark ? 0 : 0.05, shadowRadius: 2, shadowOffset: { width: 0, height: 1 },
  };
}

export function Card({ children, style, onPress }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void }) {
  const t = useTheme();
  const base: ViewStyle = { ...cardStyle(t), paddingHorizontal: 13, paddingTop: 11, paddingBottom: 12, marginHorizontal: 12, marginBottom: 8 };
  if (onPress) return <Pressable onPress={onPress} style={[base, style]}>{children}</Pressable>;
  return <View style={[base, style]}>{children}</View>;
}

/** the site's static 135° hatch: one hairline every 6px, 14% of the ink over the primary fill.
 *  Drawn as lines from the measured box (an SVG pattern does not paint inside a Pressable). */
export function Hatch({ color, opacity = 0.14 }: { color: string; opacity?: number }) {
  const [box, setBox] = useState({ w: 0, h: 0 });
  const step = 6 * Math.SQRT2;
  const lines: number[] = [];
  for (let x = step / 2; x < box.w + box.h; x += step) lines.push(x);
  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} onLayout={(e) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      {box.w > 0 ? (
        <Svg width={box.w} height={box.h}>
          {lines.map((x) => <Line key={x} x1={x} y1={0} x2={x - box.h} y2={box.h} stroke={color} strokeWidth={1} strokeOpacity={opacity} />)}
        </Svg>
      ) : null}
    </View>
  );
}

type BtnKind = 'primary' | 'ghost';
type BtnOpts = { sm?: boolean; disabled?: boolean };

/** A button is a 3px block in mono uppercase (docs/33 §6): primary fills with --brand over
 *  --brand-ink under the hatch, ghost wears a hairline. A decisive action never wears --accent.
 *  THE TAP TARGET IS THE POINT (George, 2026-09-05): 50px tall and generously padded at full
 *  size, 38px for the sm variant inside a card's control row. The hand-rolled buttons on the
 *  task screens compose `btnBox` + `btnText` so they wear the same recipe. */
export function btnBox(t: Theme, kind: BtnKind = 'ghost', o: BtnOpts = {}): ViewStyle {
  const primary = kind === 'primary';
  return {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: R.pill, overflow: 'hidden',
    paddingHorizontal: o.sm ? 16 : 22, paddingVertical: o.sm ? 8 : 13, minHeight: o.sm ? 38 : 50,
    backgroundColor: primary ? (o.disabled ? t.panel3 : t.brand) : 'transparent',
    borderWidth: 1, borderColor: primary ? 'transparent' : t.border2, opacity: o.disabled && !primary ? 0.5 : 1,
  };
}

export function btnText(t: Theme, kind: BtnKind = 'ghost', o: BtnOpts = {}): TextStyle {
  const primary = kind === 'primary';
  const size = o.sm ? 12 : 13;
  return { ...F.mono(500), fontSize: size, letterSpacing: F.tight(size), textTransform: 'uppercase', color: primary ? (o.disabled ? t.dim : t.brandInk) : t.text };
}

export function Btn({ label, kind = 'ghost', sm, onPress, disabled, icon, color, style }: {
  label: string; kind?: BtnKind; sm?: boolean; onPress?: () => void; disabled?: boolean; icon?: ReactNode; color?: string; style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} disabled={disabled} style={({ pressed }) => [btnBox(t, kind, { sm, disabled }), pressed ? { opacity: 0.85 } : null, style]}>
      {kind === 'primary' && !disabled ? <Hatch color={t.brandInk} /> : null}
      {icon}
      <Text style={[btnText(t, kind, { sm, disabled }), color ? { color } : null]}>{label}</Text>
    </Pressable>
  );
}

/** a field: the card ground under a hairline that turns to ink on focus, 6px (the desktop's .fld input) */
export function inputStyle(t: Theme, focus = false, mono = false): TextStyle {
  return {
    ...(mono ? F.mono(400) : F.body(400)), fontSize: mono ? 13 : 15, color: t.text,
    backgroundColor: t.card, borderWidth: 1, borderColor: focus ? t.text : t.border, borderRadius: R.md, paddingHorizontal: 11, paddingVertical: 10,
  };
}

export function Input({ style, mono, onFocus, onBlur, ...rest }: TextInputProps & { mono?: boolean }) {
  const t = useTheme();
  const [focus, setFocus] = useState(false);
  return (
    <TextInput
      placeholderTextColor={t.dim}
      {...rest}
      onFocus={(e) => { setFocus(true); onFocus?.(e); }}
      onBlur={(e) => { setFocus(false); onBlur?.(e); }}
      style={[inputStyle(t, focus, mono), style]}
    />
  );
}

/** a tok: one mono fact in a hairline block — a row's meta, a thread head's facts */
export function Tok({ children, warm, icon }: { children: ReactNode; warm?: boolean; icon?: ReactNode }) {
  const t = useTheme();
  const color = warm ? t.link : t.muted;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: warm ? `${t.link}66` : t.border, borderRadius: R.pill, paddingHorizontal: 7, paddingVertical: 2 }}>
      {icon}
      <Text style={{ ...F.mono(500), fontSize: 10.5, letterSpacing: F.tight(10.5), color }}>{children}</Text>
    </View>
  );
}

/** the state chip: mono 10, uppercase, tight, on a 16% wash of its hue (the desktop's .chip.c-*) */
export function Chip({ label, color, quiet }: { label: string; color: string; quiet?: boolean }) {
  const t = useTheme();
  return (
    <View style={{ alignSelf: 'flex-start', borderRadius: R.pill, paddingHorizontal: 7, paddingVertical: 3, backgroundColor: quiet ? t.panel3 : `${color}29`, borderWidth: quiet ? 1 : 0, borderColor: t.border2 }}>
      <Text style={{ ...labelText(t), color: quiet ? t.muted : color }}>{label}</Text>
    </View>
  );
}

/** the credit ring (CreditRing.tsx): r=9 in 22, --green on --panel3, warm below a fifth, NO digits at rest */
export function Ring({ frac, size = 22 }: { frac: number; size?: number }) {
  const t = useTheme();
  const r = 9;
  const c = 2 * Math.PI * r;
  const f = Math.max(0, Math.min(1, frac));
  return (
    <Svg width={size} height={size} viewBox="0 0 22 22" style={{ transform: [{ rotate: '-90deg' }] }}>
      <Circle cx={11} cy={11} r={r} stroke={t.panel3} strokeWidth={3} fill="none" />
      <Circle cx={11} cy={11} r={r} stroke={f < 0.2 ? t.warn : t.green} strokeWidth={3} fill="none" strokeLinecap="round" strokeDasharray={`${c * f} ${c}`} />
    </Svg>
  );
}

/** the mono facts line under a card's reason: `up 2h 14m · seen 3m ago` */
export function Facts({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  const t = useTheme();
  return <Text style={[{ ...F.mono(400), fontSize: 11, letterSpacing: F.tight(11), color: t.dim, lineHeight: 16, marginTop: 4 }, style]}>{children}</Text>;
}

/** the one-line reason with its state mark: ● awake · ● waking · ☾ asleep · ○ offline */
export function Reason({ tone, children }: { tone: 'on' | 'waking' | 'sleep' | 'off' | 'warn'; children: ReactNode }) {
  const t = useTheme();
  const mark = tone === 'sleep' ? '☾' : tone === 'off' ? '○' : '●';
  const color = tone === 'on' ? t.green : tone === 'waking' || tone === 'warn' ? t.warn : tone === 'sleep' ? t.muted : t.dim;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 }}>
      <Text style={{ color, fontSize: 11, width: 12, textAlign: 'center' }}>{mark}</Text>
      <Text style={{ ...F.body(400), fontSize: 12.5, color: t.body, flex: 1 }}>{children}</Text>
    </View>
  );
}

/** the kind tag beside a machine's name: `your cloud machine` · `cloud` · `member machine` · `desktop` */
export function Kind({ children }: { children: ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ borderWidth: 1, borderColor: t.border2, borderRadius: R.pill, paddingHorizontal: 5, paddingVertical: 1 }}>
      <Text style={{ ...F.mono(500), fontSize: 9.5, letterSpacing: F.tight(9.5), color: t.dim }}>{children}</Text>
    </View>
  );
}

/** the letter tile: a human's initial in the accent-soft well (the identity-well idiom) */
export function Tile({ label, size = 26, round = true }: { label: string; size?: number; round?: boolean }) {
  const t = useTheme();
  return (
    <View style={{ width: size, height: size, borderRadius: round ? size / 2 : R.md, backgroundColor: t.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ ...F.mono(600), fontSize: size * 0.42, color: t.accent }}>{label.slice(0, round ? 1 : 2).toUpperCase()}</Text>
    </View>
  );
}
