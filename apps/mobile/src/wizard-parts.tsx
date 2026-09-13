// THE WIZARD'S PARTS (S6, D16): the top row (wordmark · the step ring · the step's name), the
// step's eyebrow/title/sub/hint voice (mono · serif · body · mono), the fields as warm wells, the
// machine tile with its pulsing state dot, the provider row with its mode pills, the Back/Continue
// nav. One recipe each, from docs/33 — the browser wizard's classes at phone width.
import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Pressable, Text, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { PorchMark } from './brand';
import { Icon } from './icon';
import { Btn, Tile, inputStyle } from './kit';
import { useTheme } from './theme';
import { F, R } from './type';

/** the step ring: a solid oak arc marks progress (r=14 in 34, the desktop's obring at phone scale) */
export function WizardTop({ step, total, label }: { step: number; total: number; label: string }) {
  const t = useTheme();
  const c = 2 * Math.PI * 14;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingTop: 6, paddingBottom: 8 }}>
      <PorchMark size={18} />
      <Text style={{ ...F.body(600), fontSize: 14.5, color: t.text, letterSpacing: -0.2, flex: 1 }}>neuramesh</Text>
      <View style={{ width: 34, height: 34, alignItems: 'center', justifyContent: 'center' }}>
        <Svg width={34} height={34} viewBox="0 0 34 34" style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
          <Circle cx={17} cy={17} r={14} stroke={t.panel3} strokeWidth={2.5} fill="none" />
          <Circle cx={17} cy={17} r={14} stroke={t.brand} strokeWidth={2.5} fill="none" strokeLinecap="round" strokeDasharray={`${(c * step) / total} ${c}`} />
        </Svg>
        <Text style={{ ...F.mono(500), fontSize: 9.5, color: t.text }}>{step}<Text style={{ color: t.dim }}>/{total}</Text></Text>
      </View>
      <Text style={{ ...F.mono(500), fontSize: 9.5, letterSpacing: F.track, textTransform: 'uppercase', color: t.dim }}>{label}</Text>
    </View>
  );
}

export function Eyebrow({ children, center }: { children: ReactNode; center?: boolean }) {
  const t = useTheme();
  return <Text style={{ ...F.mono(500), fontSize: 9.5, letterSpacing: F.track, textTransform: 'uppercase', color: t.dim, paddingHorizontal: 16, paddingTop: 10, textAlign: center ? 'center' : 'left' }}>{children}</Text>;
}
/** the serif title; `accent` is the one word drawn in the brand's warm link colour */
export function Title({ children, accent, center }: { children?: ReactNode; accent?: string; center?: boolean }) {
  const t = useTheme();
  return (
    <Text style={{ ...F.display(), fontSize: 24, letterSpacing: F.tight(24), lineHeight: 30, color: t.text, paddingHorizontal: 16, paddingTop: 6, textAlign: center ? 'center' : 'left' }}>
      {accent ? <Text style={{ color: t.link }}>{accent}</Text> : null}{accent ? ' ' : ''}{children}
    </Text>
  );
}
export function Sub({ children, center }: { children: ReactNode; center?: boolean }) {
  const t = useTheme();
  return <Text style={{ ...F.body(400), fontSize: 13.5, lineHeight: 20, color: t.muted, paddingHorizontal: 16, paddingTop: 8, textAlign: center ? 'center' : 'left' }}>{children}</Text>;
}
export function Hint({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return <View style={[{ paddingHorizontal: 16, paddingTop: 8 }, style]}><Text style={{ ...F.mono(500), fontSize: 10.5, lineHeight: 15, color: t.dim }}>{children}</Text></View>;
}

/** a text field as a warm well (--panel2 on a hairline); mono for addresses and keys */
export function Field({ value, onChange, placeholder, autoFocus, secure, mono, autoCapitalize = 'words' }: {
  value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean; secure?: boolean; mono?: boolean; autoCapitalize?: 'none' | 'words' | 'sentences';
}) {
  const t = useTheme();
  return (
    <TextInput value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={t.dim} autoFocus={autoFocus} secureTextEntry={secure}
      autoCapitalize={autoCapitalize} autoCorrect={false} selectTextOnFocus={autoFocus}
      style={{ ...inputStyle(t, false, mono), fontSize: mono ? 13 : 16, paddingVertical: 11, marginHorizontal: 16, marginTop: 14 }} />
  );
}

/** the address row: the host as a mono prefix, the slug editable after it */
export function SlugField({ prefix, slug, onChange }: { prefix: string; slug: string; onChange: (v: string) => void }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: t.card, borderWidth: 1, borderColor: t.border, borderRadius: R.md, paddingHorizontal: 12, marginHorizontal: 16, marginTop: 8 }}>
      <Text style={{ ...F.mono(500), fontSize: 12, color: t.dim }}>{prefix}</Text>
      <TextInput value={slug} onChangeText={onChange} autoCapitalize="none" autoCorrect={false} placeholder="workspace" placeholderTextColor={t.dim}
        style={{ ...F.mono(500), fontSize: 12.5, color: t.text, flex: 1, paddingVertical: 10 }} />
    </View>
  );
}

/** the state dot that breathes while something is coming online */
export function Pulse({ color, live }: { color: string; live: boolean }) {
  const a = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!live) { a.setValue(1); return; }
    const loop = Animated.loop(Animated.sequence([Animated.timing(a, { toValue: 0.25, duration: 700, useNativeDriver: true }), Animated.timing(a, { toValue: 1, duration: 700, useNativeDriver: true })]));
    loop.start();
    return () => loop.stop();
  }, [a, live]);
  return <Animated.View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: color, opacity: a }} />;
}

/** the machine tile (the browser's obmach): glyph in a soft well · name · the fleet's word · the dot */
export function MachineTile({ name, small, tone, style }: { name: string; small: string; tone: 'waking' | 'on' | 'sleep'; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  const color = tone === 'on' ? t.green : tone === 'waking' ? t.warn : t.dim;
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 16, marginTop: 16, padding: 12, backgroundColor: t.card, borderWidth: 1, borderColor: t.cardBorder, borderRadius: R.lg }, style]}>
      <View style={{ width: 36, height: 36, borderRadius: R.md, backgroundColor: t.panel3, alignItems: 'center', justifyContent: 'center' }}><Icon name="cloudMachine" size={18} color={t.body} /></View>
      <View style={{ flex: 1 }}>
        <Text style={{ ...F.body(600), fontSize: 13.5, color: t.text }} numberOfLines={1}>{name}</Text>
        <Text style={{ ...F.mono(500), fontSize: 10.5, color: t.dim, marginTop: 3 }} numberOfLines={1}>{small}</Text>
      </View>
      <Pulse color={color} live={tone === 'waking'} />
    </View>
  );
}

/** a provider row: the letter tile · name · the one-line how · its mode pills (icons would lie here — the mode IS a word) */
export function ProviderRow({ letter, name, small, modes, mode, onMode }: {
  letter: string; name: string; small: string; modes: Array<{ id: 'subscription' | 'apikey'; label: string }>; mode: string; onMode: (m: 'none' | 'subscription' | 'apikey') => void;
}) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 16, marginTop: 8, padding: 11, backgroundColor: t.card, borderWidth: 1, borderColor: t.cardBorder, borderRadius: R.lg }}>
      <Tile label={letter} size={30} round={false} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ ...F.body(600), fontSize: 13, color: t.text }}>{name}</Text>
        <Text style={{ ...F.body(400), fontSize: 11, color: t.dim, marginTop: 1 }} numberOfLines={2}>{small}</Text>
      </View>
      <View style={{ flexDirection: 'row', borderWidth: 1, borderColor: t.border2, borderRadius: R.pill, padding: 2, backgroundColor: t.panel3 }}>
        {modes.map((m) => {
          const on = mode === m.id;
          return (
            <Pressable key={m.id} onPress={() => onMode(on ? 'none' : m.id)} hitSlop={6} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: R.pill, backgroundColor: on ? t.card : 'transparent' }}>
              <Text style={{ ...F.mono(500), fontSize: 10.5, letterSpacing: F.track, color: on ? t.text : t.dim }}>{m.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function WizardNav({ onBack, onNext, nextLabel, disabled, busy }: { onBack?: () => void; onNext: () => void; nextLabel: string; disabled?: boolean; busy?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingTop: 10 }}>
      {onBack ? <Btn label="← Back" onPress={onBack} /> : null}
      <View style={{ flex: 1 }} />
      <Btn kind="primary" label={busy ? 'Please wait…' : nextLabel} onPress={onNext} disabled={disabled || busy} />
    </View>
  );
}
