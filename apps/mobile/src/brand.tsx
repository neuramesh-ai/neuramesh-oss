// Porch on the phone — geometry verbatim from apps/desktop/src/renderer/src/brand.tsx (the ONE
// implementation of the arch; the small cut at ≤24px, the standard above). Solid rides
// --brand/--brand-ink in every theme, never --accent (docs/33 §4).
import Svg, { Circle, Path } from 'react-native-svg';
import { useTheme } from './theme';

const CUTS = {
  std: { arch: 'M6.5 22 C6.5 11 14 4.5 24 4.5 C34 4.5 41.5 11 41.5 22 L41.5 38.5 C41.5 41.8 39.3 43.5 36.5 43.5 L11.5 43.5 C8.7 43.5 6.5 41.8 6.5 38.5 Z', eyes: [[18.4, 21.5, 2.75], [29.6, 21.5, 2.75]] as const, smile: 'M17.6 28.4 C20.3 32.8 27.7 32.8 30.4 28.4', smileW: 2.9 },
  sm: { arch: 'M5.5 22 C5.5 10.5 13.5 3.5 24 3.5 C34.5 3.5 42.5 10.5 42.5 22 L42.5 39 C42.5 42.5 40 44.5 37 44.5 L11 44.5 C8 44.5 5.5 42.5 5.5 39 Z', eyes: [[17.8, 21, 3.5], [30.2, 21, 3.5]] as const, smile: 'M17 28.6 C20.2 33.6 27.8 33.6 31 28.6', smileW: 4 },
};

export function PorchMark({ size = 20, reversed = false }: { size?: number; reversed?: boolean }) {
  const t = useTheme();
  const g = size <= 24 ? CUTS.sm : CUTS.std;
  const tile = reversed ? t.brandInk : t.brand;
  const face = reversed ? t.brand : t.brandInk;
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Path d={g.arch} fill={tile} />
      {g.eyes.map(([x, y, r]) => <Circle key={x} cx={x} cy={y} r={r} fill={face} />)}
      <Path d={g.smile} fill="none" stroke={face} strokeWidth={g.smileW} strokeLinecap="round" />
    </Svg>
  );
}
