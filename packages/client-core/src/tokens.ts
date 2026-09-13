// The NeuraMesh palette as typed data for React Native (the desktop keeps it in
// apps/desktop/src/renderer/src/tokens.css). A parity test (test/tokens.test.ts)
// reads that stylesheet and fails if any hex here drifts from it, so the two
// platforms can never disagree on a brand color. Only the plain-hex tokens live
// here; color-mix/rgba derivations (rings, hovers, shadows) are computed in the
// app from these where needed.

export interface Theme {
  // the frame model (docs/33 §2–3): --win is the window's own ground, --card/--card-border the
  // elevated stratum every control sits on, --overlay the lifted plane menus float on
  win: string; card: string; cardBorder: string; overlay: string;
  bg: string; panel: string; panel2: string; panel3: string;
  border: string; border2: string;
  text: string; body: string; muted: string; dim: string;
  link: string; // hyperlinked resources (task refs, PRs, artifacts, URLs) — the one non-status accent
  accent: string; accentInk: string; accentSoft: string;
  // the Porch mark's identity constants — oak/cream in EVERY theme (never --accent,
  // which is achromatic in the darks); theme-independent like the status hues
  brand: string; brandInk: string;
  btn: string; btnFg: string; btnHover: string;
  green: string; warm: string; blue: string; violet: string;
  // FSM state colors (board columns + status chips)
  todo: string; prog: string; review: string; done: string; acc: string;
  ship: string; shiprev: string; rel: string; verif: string;
  closed: string; blocked: string; warn: string; plan: string; planrev: string;
  design: string; designrev: string; backlog: string;
  // chart-series identity (worktree-berths round) — categorical, fixed order, validated
  // six-checks per theme against the card surface; never status, never role hues
  vizBerths: string; vizDonors: string; vizClones: string;
  // the report score's one hue (marketing-os round) — dials, dimension bars, trend marks.
  // Same calibrated blue as the berths series (pre-validated on the card surface); its own
  // token so score surfaces can diverge without re-skinning a chart series.
  vizScore: string;
}

export type ThemeName = 'dark' | 'light' | 'soft-dark' | 'cream-oak';

// camelCase token → the CSS custom-property suffix in tokens.css (drives the parity test).
export const CSS_VAR: Record<keyof Theme, string> = {
  win: 'win', card: 'card', cardBorder: 'card-border', overlay: 'overlay',
  bg: 'bg', panel: 'panel', panel2: 'panel2', panel3: 'panel3', border: 'border', border2: 'border2',
  text: 'text', body: 'body', muted: 'muted', dim: 'dim', link: 'link',
  accent: 'accent', accentInk: 'accent-ink', accentSoft: 'accent-soft',
  brand: 'brand', brandInk: 'brand-ink',
  btn: 'btn', btnFg: 'btn-fg', btnHover: 'btn-hover',
  green: 'green', warm: 'warm', blue: 'blue', violet: 'violet',
  todo: 'todo', prog: 'prog', review: 'review', done: 'done', acc: 'acc',
  ship: 'ship', shiprev: 'shiprev', rel: 'rel', verif: 'verif',
  closed: 'closed', blocked: 'blocked', warn: 'warn', plan: 'plan', planrev: 'planrev',
  design: 'design', designrev: 'designrev', backlog: 'backlog',
  vizBerths: 'viz-berths', vizDonors: 'viz-donors', vizClones: 'viz-clones',
  vizScore: 'viz-score',
};

const DARK: Theme = {
  win: '#0d0d0d', card: '#1e1e1e', cardBorder: '#2c2c2c', overlay: '#222222',
  bg: '#141414', panel: '#161616', panel2: '#1a1a1a', panel3: '#262626', border: '#262626', border2: '#3a3a3a',
  text: '#cbcbcb', body: '#a6a6a6', muted: '#848484', dim: '#6a6a6a',
  link: '#d19a72',
  accent: '#cbcbcb', accentInk: '#101010', accentSoft: '#262626',
  brand: '#834a2b', brandInk: '#fff7ee',
  btn: '#232323', btnFg: '#efefef', btnHover: '#2f2f2f',
  green: '#77ac8d', warm: '#a6a6a6', blue: '#a6a6a6', violet: '#a89ccf',
  todo: '#949494', prog: '#8ba0c0', review: '#a89ccf', done: '#77ac8d', acc: '#6fb0ab',
  ship: '#7cb0bd', shiprev: '#a89ccf', rel: '#74b19c', verif: '#6fb3a4',
  closed: '#727272', blocked: '#9ca0a8', warn: '#c9a15e', plan: '#7fa5ab', planrev: '#a89ccf', design: '#cc8fb9', designrev: '#b78bd8', backlog: '#8f9aa6',
  vizBerths: '#5b93d8', vizDonors: '#3aa183', vizClones: '#8a7bd9',
  vizScore: '#5b93d8',
};
const LIGHT: Theme = {
  win: '#ebe9e6', card: '#ffffff', cardBorder: '#dedbd6', overlay: '#ffffff',
  bg: '#f5f4f2', panel: '#f5f4f2', panel2: '#efedea', panel3: '#e6e3df', border: '#dedbd6', border2: '#b9b4ae',
  text: '#0c0b0a', body: '#57534e', muted: '#6b665f', dim: '#8a857e',
  link: '#8f4f2a',
  accent: '#0c0b0a', accentInk: '#ffffff', accentSoft: '#e6e3df',
  brand: '#834a2b', brandInk: '#fff7ee',
  btn: '#ffffff', btnFg: '#0c0b0a', btnHover: '#f0eeeb',
  green: '#2f9e6b', warm: '#57534e', blue: '#57534e', violet: '#7d6cc4',
  todo: '#7d8590', prog: '#4f80c4', review: '#6d5ce0', done: '#2f9e6b', acc: '#2f8f8a',
  ship: '#1f7f96', shiprev: '#6d5ce0', rel: '#22997d', verif: '#279183',
  closed: '#8a847a', blocked: '#7c7f88', warn: '#a9762a', plan: '#2c7d88', planrev: '#7d56b8', design: '#b0498f', designrev: '#8a3fc0', backlog: '#5d6b7a',
  vizBerths: '#2f6fc2', vizDonors: '#1b8f68', vizClones: '#5c4ab8',
  vizScore: '#2f6fc2',
};
const SOFT_DARK: Theme = {
  win: '#1d1d1d', card: '#2f2f2f', cardBorder: '#3d3d3d', overlay: '#333333',
  bg: '#262626', panel: '#2a2a2a', panel2: '#313131', panel3: '#3b3b3b', border: '#363636', border2: '#454545',
  text: '#d2d2d2', body: '#b0b0b0', muted: '#8f8f8f', dim: '#747474',
  link: '#d3a07a',
  accent: '#d2d2d2', accentInk: '#141414', accentSoft: '#3b3b3b',
  brand: '#834a2b', brandInk: '#fff7ee',
  btn: '#383838', btnFg: '#f0f0f0', btnHover: '#444444',
  green: '#7fb495', warm: '#b0b0b0', blue: '#b0b0b0', violet: '#aaa0d2',
  todo: '#9c9c9c', prog: '#94aacb', review: '#aaa0d2', done: '#7fb495', acc: '#74b6b1',
  ship: '#86b8c4', shiprev: '#aaa0d2', rel: '#7fb8a3', verif: '#79baab',
  closed: '#707070', blocked: '#a4a8b0', warn: '#cda765', plan: '#86adb3', planrev: '#aaa0d2', design: '#cf99c1', designrev: '#bd96da', backlog: '#97a1ac',
  vizBerths: '#5b93d8', vizDonors: '#3aa183', vizClones: '#8a7bd9',
  vizScore: '#5b93d8',
};
const CREAM_OAK: Theme = {
  win: '#f0e5d3', card: '#ffffff', cardBorder: '#eadfce', overlay: '#ffffff',
  bg: '#fbf8f4', panel: '#fbf8f4', panel2: '#f6eee1', panel3: '#efe1cd', border: '#e6dbca', border2: '#d3c2a8',
  text: '#3a2c22', body: '#5b4c3d', muted: '#8b7861', dim: '#a99680',
  link: '#9c5730',
  accent: '#834a2b', accentInk: '#fff7ee', accentSoft: '#f1e3d2',
  brand: '#834a2b', brandInk: '#fff7ee',
  btn: '#f8f2e8', btnFg: '#43301f', btnHover: '#efe4d2',
  green: '#2f9e6b', warm: '#5b4c3d', blue: '#5b4c3d', violet: '#7d6cc4',
  todo: '#7d8590', prog: '#4f80c4', review: '#6d5ce0', done: '#0f9d63', acc: '#2f8f8a',
  ship: '#1f7f96', shiprev: '#6d5ce0', rel: '#22997d', verif: '#279183',
  closed: '#897a60', blocked: '#7d7f86', warn: '#a06a1f', plan: '#2c7d88', planrev: '#7d56b8', design: '#b0498f', designrev: '#8a3fc0', backlog: '#5d6b7a',
  vizBerths: '#2f6fc2', vizDonors: '#1b8f68', vizClones: '#5c4ab8',
  vizScore: '#2f6fc2',
};

export const THEMES: Record<ThemeName, Theme> = { dark: DARK, light: LIGHT, 'soft-dark': SOFT_DARK, 'cream-oak': CREAM_OAK };

// Shared across every theme (see tokens.css :root). The hex parity test does not cover fonts.
// The names a THEME PICKER shows (the mobile-cloud round, S1.4): the retired palette's names
// ("Ember dark", "Bright light") stopped being true when the darks went graphite and the light
// went paper; these are docs/33's own words for the four.
export const THEME_LABELS: Record<ThemeName, string> = { dark: 'Graphite', light: 'Paper', 'soft-dark': 'Soft dark', 'cream-oak': 'Cream oak' };
// NeuraMesh Sans for UI and display (the house face, packages/fonts), Geist Mono for kickers, chips,
// facts, code and the terminal (the Foundry system, docs/33 §5). Family names as the fonts register
// under expo-font (apps/mobile/src/fonts.ts).
export const TYPOGRAPHY = { display: 'NeuraMeshSans', body: 'NeuraMeshSans', mono: 'GeistMono' } as const;
export const MOTION = { fastMs: 120, baseMs: 150 } as const;
