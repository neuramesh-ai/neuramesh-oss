// Line icons for the landing page: 24-grid, stroke 1.8, currentColor. Never emoji.
import type { ReactNode } from 'react';

const P = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

const wrap = (size: number, children: ReactNode, extra?: object) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...P} {...extra} aria-hidden>{children}</svg>
);

export const IconArrow = ({ size = 14 }: { size?: number }) => wrap(size, <path d="M5 12h13M13 6l6 6-6 6" />, { strokeWidth: 2.2 });
export const IconCaret = ({ size = 12 }: { size?: number }) => wrap(size, <path d="M6 9l6 6 6-6" />, { strokeWidth: 2.6 });
export const IconLock = ({ size = 11 }: { size?: number }) => wrap(size, <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>, { strokeWidth: 2.2 });
export const IconShield = ({ size = 15 }: { size?: number }) => wrap(size, <><path d="M12 2.5 20 6v6c0 5-3.4 8.3-8 9.5C7.4 20.3 4 17 4 12V6l8-3.5z" /><path d="M9 12l2.2 2.2L15.5 10" /></>, { strokeWidth: 2 });

// the expert and surface glyphs, picked by name so copy.ts stays data
export function Glyph({ name, size = 18 }: { name: string; size?: number }) {
  switch (name) {
    case 'search': return wrap(size, <><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></>);
    case 'chat': return wrap(size, <path d="M4 5h16v11H8l-4 4z" />);
    case 'star': return wrap(size, <path d="M12 3l3 6 6 .9-4.5 4.3 1 6.3L12 17.5 6.5 20.5l1-6.3L3 9.9 9 9z" />);
    case 'mail': return wrap(size, <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3.5 7.5 12 13l8.5-5.5" /></>);
    case 'bars': return wrap(size, <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />);
    case 'code': return wrap(size, <path d="M8 6L3 12l5 6M16 6l5 6-5 6" />);
    case 'laptop': return wrap(size, <><rect x="3" y="5" width="18" height="12" rx="2" /><path d="M2 19h20" /></>);
    case 'phone': return wrap(size, <><rect x="7" y="2.5" width="10" height="19" rx="2.5" /><path d="M11 18h2" /></>);
    case 'cloud': return wrap(size, <path d="M7 18a4 4 0 0 1-.5-7.97A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9H7z" />);
    default: return null;
  }
}
