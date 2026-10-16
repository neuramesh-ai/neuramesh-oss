// Theme model — extracted from App.tsx (track A1). Pure module: the before-first-paint
// `applyTheme(resolveTheme(loadThemePref()))` side effect stays in App.tsx, so this file
// stays importable (and testable) under plain node.

// One local preference selects both the look and its palette.
export type ThemeId = 'dark' | 'light' | 'soft-dark' | 'cream-oak' | 'paper-light' | 'paper-dark' | 'paper-cream-oak';
export type Look = 'elevated' | 'paper';
export type ThemePref = ThemeId | 'system' | 'paper-system';
// Keep public/theme-boot.js in step. The boot parity test checks this default.
export const DEFAULT_THEME_PREF: ThemePref = 'system';
export interface ThemeDef { id: ThemeId; label: string; look: Look; group: 'dark' | 'light'; desc: string; sw: { bg: string; panel: string; accent: string; text: string; border: string } }
export const THEMES: ThemeDef[] = [
  { id: 'paper-light', look: 'paper', label: 'Paper light', group: 'light', desc: 'One flat ground with clean lines.', sw: { bg: '#f7f6f3', panel: '#efede9', accent: '#141310', text: '#141310', border: '#c9c4bd' } },
  { id: 'paper-dark', look: 'paper', label: 'Paper dark', group: 'dark', desc: 'Dark grey paper with clean lines.', sw: { bg: '#212121', panel: '#282828', accent: '#d9d9d9', text: '#d9d9d9', border: '#4a4a4a' } },
  { id: 'paper-cream-oak', look: 'paper', label: 'Paper Cream Oak', group: 'light', desc: 'Warm cream paper with oak-brown ink.', sw: { bg: '#f7efe2', panel: '#f1e6d5', accent: '#3a2c22', text: '#3a2c22', border: '#c2ad91' } },
  { id: 'dark', look: 'elevated', label: 'Dark', group: 'dark', desc: 'Near-black graphite with crisp text.', sw: { bg: '#101010', panel: '#161616', accent: '#eaeaea', text: '#eaeaea', border: '#333333' } },
  { id: 'soft-dark', look: 'elevated', label: 'Soft Dark', group: 'dark', desc: 'A softer dark with less contrast.', sw: { bg: '#232323', panel: '#272727', accent: '#ececec', text: '#ececec', border: '#414141' } },
  { id: 'light', look: 'elevated', label: 'Light', group: 'light', desc: 'A near-white sheet with crisp edges.', sw: { bg: '#f4f2ec', panel: '#fffefc', accent: '#2f2a24', text: '#2f2a24', border: '#cec5b7' } },
  { id: 'cream-oak', look: 'elevated', label: 'Cream Oak', group: 'light', desc: 'Warm cream with oak-brown ink.', sw: { bg: '#f7efe2', panel: '#fffaf2', accent: '#352a20', text: '#352a20', border: '#dbc6ad' } },
];
export const lookOf = (id: ThemeId): Look => THEMES.find((t) => t.id === id)?.look ?? 'elevated';
export const isThemePref = (s: string): s is ThemePref => s === 'system' || s === 'paper-system' || THEMES.some((t) => t.id === s);
export function systemTheme(look: Look = 'elevated'): ThemeId {
  const light = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-color-scheme: light)').matches;
  return look === 'paper' ? (light ? 'paper-light' : 'paper-dark') : (light ? 'light' : 'soft-dark');
}
export function resolveTheme(pref: ThemePref): ThemeId {
  return pref === 'system' ? systemTheme() : pref === 'paper-system' ? systemTheme('paper') : pref;
}
let themeFrame: number | undefined;
export function applyTheme(id: ThemeId) {
  const root = document.documentElement;
  const look = lookOf(id);
  if (root.dataset['theme'] === id && root.dataset['look'] === look) return;
  if (themeFrame !== undefined) cancelAnimationFrame(themeFrame);
  // Text and surface tokens must change in the same paint. Background-only transitions
  // otherwise briefly put light-theme ink on the previous dark surface (and vice versa).
  root.dataset['themeSwitch'] = '';
  root.dataset['theme'] = id;
  root.dataset['look'] = look;
  themeFrame = requestAnimationFrame(() => {
    themeFrame = requestAnimationFrame(() => {
      delete root.dataset['themeSwitch'];
      themeFrame = undefined;
    });
  });
}
export function loadThemePref(): ThemePref {
  try {
    const pref = typeof localStorage !== 'undefined' ? localStorage.getItem('nm:theme') : null;
    return pref && isThemePref(pref) ? pref : DEFAULT_THEME_PREF;
  } catch { return DEFAULT_THEME_PREF; }
}
