// Theme model — extracted from App.tsx (track A1). Pure module: the before-first-paint
// `applyTheme(resolveTheme(loadThemePref()))` side effect stays in App.tsx, so this file
// stays importable (and testable) under plain node.

// ── Appearance: 4 themes (2 standard + 2 new), user-pickable + persisted ──────
export type ThemeId = 'dark' | 'light' | 'soft-dark' | 'cream-oak';
export type ThemePref = ThemeId | 'system';
export interface ThemeDef { id: ThemeId; label: string; group: 'dark' | 'light'; desc: string; sw: { bg: string; panel: string; accent: string; text: string; border: string } }
export const THEMES: ThemeDef[] = [
  { id: 'dark', label: 'Dark', group: 'dark', desc: 'Near-black graphite, crisp text — the neuramesh standard dark.', sw: { bg: '#101010', panel: '#161616', accent: '#eaeaea', text: '#eaeaea', border: '#333333' } },
  { id: 'soft-dark', label: 'Soft Dark', group: 'dark', desc: 'A softer, lifted calm dark — gentler contrast, easy on the eyes.', sw: { bg: '#232323', panel: '#272727', accent: '#ececec', text: '#ececec', border: '#414141' } },
  { id: 'light', label: 'Light', group: 'light', desc: 'Near-white paper, crisp edges and ink — bright and clean.', sw: { bg: '#f4f2ec', panel: '#fffefc', accent: '#2f2a24', text: '#2f2a24', border: '#cec5b7' } },
  { id: 'cream-oak', label: 'Cream Oak', group: 'light', desc: 'Warm cream surfaces, oak-brown ink — the signature light.', sw: { bg: '#f7efe2', panel: '#fffaf2', accent: '#352a20', text: '#352a20', border: '#dbc6ad' } },
];
export const isThemePref = (s: string): s is ThemePref => s === 'system' || THEMES.some((t) => t.id === s);
export function systemTheme(): ThemeId { return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'; }
export function resolveTheme(pref: ThemePref): ThemeId { return pref === 'system' ? systemTheme() : pref; }
export function applyTheme(id: ThemeId) { document.documentElement.dataset['theme'] = id; }
export function loadThemePref(): ThemePref { const s = (typeof localStorage !== 'undefined' && localStorage.getItem('nm:theme')) || 'system'; return isThemePref(s) ? s : 'system'; }
