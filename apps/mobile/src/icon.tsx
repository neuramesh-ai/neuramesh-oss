// The icon sheet on the phone (the mobile-cloud round, D13 — "icons, not words"): every glyph is
// the desktop's, verbatim, from client-core's generated ICON_PATHS; this only draws them. The
// sheet uses three primitives (path · circle · rect — asserted by client-core's icons.test.ts),
// parsed once per name and cached. Stroke on `color`, 2 wide, round caps — the desktop's <Svg>.
import { ICON_PATHS, ICON_SVG, type IconName } from '@neuramesh/client-core';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

interface Shape { tag: 'path' | 'circle' | 'rect'; attrs: Record<string, string> }
const cache = new Map<IconName, Shape[]>();

function shapesOf(name: IconName): Shape[] {
  const hit = cache.get(name);
  if (hit) return hit;
  const out: Shape[] = [];
  for (const m of ICON_PATHS[name].matchAll(/<(path|circle|rect)([^>]*?)\/>/g)) {
    const attrs: Record<string, string> = {};
    for (const a of m[2]!.matchAll(/([\w-]+)="([^"]*)"/g)) attrs[a[1]!] = a[2]!;
    out.push({ tag: m[1] as Shape['tag'], attrs });
  }
  cache.set(name, out);
  return out;
}

export type { IconName };

export function Icon({ name, size = 16, color, strokeWidth }: { name: IconName; size?: number; color: string; strokeWidth?: number }) {
  return (
    <Svg width={size} height={size} viewBox={ICON_SVG.viewBox} fill="none" stroke={color} strokeWidth={strokeWidth ?? ICON_SVG.strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      {shapesOf(name).map((s, i) => {
        // a filled primitive says so on the sheet (fill="currentColor" stroke="none"); the rest inherit the stroke
        const fill = s.attrs['fill'] === 'currentColor' ? color : s.attrs['fill'] === 'none' ? 'none' : undefined;
        const stroke = s.attrs['stroke'] === 'none' ? 'none' : undefined;
        if (s.tag === 'path') return <Path key={i} d={s.attrs['d']} fill={fill} stroke={stroke} />;
        if (s.tag === 'circle') return <Circle key={i} cx={s.attrs['cx']} cy={s.attrs['cy']} r={s.attrs['r']} fill={fill} stroke={stroke} />;
        return <Rect key={i} x={s.attrs['x']} y={s.attrs['y']} width={s.attrs['width']} height={s.attrs['height']} rx={s.attrs['rx']} ry={s.attrs['ry']} fill={fill} stroke={stroke} />;
      })}
    </Svg>
  );
}
