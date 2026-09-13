// The two review themes, lifted VERBATIM from apps/desktop/src/renderer/src/tokens.css (the
// [data-theme='dark'] and [data-theme='cream-oak'] blocks) and packages/client-core/src/tokens.ts.
// Only plain values live here; color-mix derivations stay in the stylesheet (ui.mjs), the way
// tokens.css does it. Anything added here is a design-system change and lands in docs/33.
export const THEMES = {
  dark: {
    cls: 't-dark', label: 'graphite dark',
    vars: {
      win: '#0d0d0d', bg: '#141414', panel: '#191919', panel2: '#212121', panel3: '#2b2b2b',
      border: '#272727', border2: '#383838',
      text: '#cbcbcb', body: '#a6a6a6', muted: '#848484', dim: '#6a6a6a',
      link: '#d19a72', accent: '#cbcbcb', 'accent-ink': '#101010', 'accent-soft': '#2b2b2b',
      brand: '#834a2b', 'brand-ink': '#fff7ee', btn: '#232323', 'btn-fg': '#efefef',
      green: '#77ac8d', warn: '#c9a15e', blocked: '#9ca0a8', violet: '#a89ccf',
      todo: '#949494', prog: '#8ba0c0', review: '#a89ccf', done: '#77ac8d', acc: '#6fb0ab',
      plan: '#7fa5ab', planrev: '#a89ccf', design: '#cc8fb9', designrev: '#b78bd8', backlog: '#8f9aa6', closed: '#727272',
      card: '#1e1e1e', 'card-border': '#2c2c2c', overlay: '#222222', ring: '#525252',
      'hover-bg': 'rgba(203,203,203,.07)', 'sel-bg': 'rgba(203,203,203,.10)',
      'shadow-card': '0 1px 2px rgba(0,0,0,.25)',
      'shadow-sheet': 'inset 0 1px 0 rgba(255,255,255,.05), 0 12px 30px -6px rgba(0,0,0,.5)',
      'shadow-pop': '0 20px 55px -14px rgba(0,0,0,.65)',
      'role-orch': '#9793d2', 'role-dev': '#77ac8d', 'role-arch': '#a89ccf', 'role-rev': '#7ba1c4',
      'role-design': '#cc8fb9', 'role-ship': '#7cb0bd', 'role-mkt': '#c98f8f', 'role-cur': '#6fb0ab', 'role-tone': '17%',
    },
  },
  cream: {
    cls: 't-cream', label: 'cream oak',
    vars: {
      win: '#f0e5d3', bg: '#fbf8f4', panel: '#fbf8f4', panel2: '#f6eee1', panel3: '#efe1cd',
      border: '#e6dbca', border2: '#d3c2a8',
      text: '#3a2c22', body: '#5b4c3d', muted: '#8b7861', dim: '#a99680',
      link: '#9c5730', accent: '#834a2b', 'accent-ink': '#fff7ee', 'accent-soft': '#f1e3d2',
      brand: '#834a2b', 'brand-ink': '#fff7ee', btn: '#f8f2e8', 'btn-fg': '#43301f',
      green: '#2f9e6b', warn: '#a06a1f', blocked: '#7d7f86', violet: '#7d6cc4',
      todo: '#7d8590', prog: '#4f80c4', review: '#6d5ce0', done: '#0f9d63', acc: '#2f8f8a',
      plan: '#2c7d88', planrev: '#7d56b8', design: '#b0498f', designrev: '#8a3fc0', backlog: '#5d6b7a', closed: '#897a60',
      card: '#ffffff', 'card-border': '#eadfce', overlay: '#ffffff', ring: '#b19073',
      'hover-bg': 'rgba(58,44,34,.05)', 'sel-bg': 'rgba(131,74,43,.08)',
      'shadow-card': '0 1px 2px rgba(70,42,18,.05)',
      'shadow-sheet': '0 8px 26px -8px rgba(70,42,18,.16), 0 1px 2px rgba(70,42,18,.05)',
      'shadow-pop': '0 20px 55px -14px rgba(70,42,18,.30)',
      'role-orch': '#6a63bc', 'role-dev': '#3f9268', 'role-arch': '#7d6cc4', 'role-rev': '#4f7bb0',
      'role-design': '#b0498f', 'role-ship': '#1f7f96', 'role-mkt': '#b04f55', 'role-cur': '#2f8f8a', 'role-tone': '14%',
    },
  },
};

export const themeCss = () => Object.values(THEMES)
  .map((t) => `.${t.cls}{${Object.entries(t.vars).map(([k, v]) => `--${k}:${v}`).join(';')}}`)
  .join('\n');
