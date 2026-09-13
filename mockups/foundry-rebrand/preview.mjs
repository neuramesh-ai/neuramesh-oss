// Static previews of the page artboards for a quick look in a browser: resolves the token
// holes for one lever set, keeps the full page, and drops the logic script. Output goes to
// the directory given as the first argument (default ./preview).
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = process.argv[2] || join(here, 'preview');
mkdirSync(outDir, { recursive: true });

function tokens({ theme, accent, paper, caps }) {
  const dark = theme === 'dark';
  const light = paper === 'cream'
    ? { paper: '#fbf8f4', raised: '#ffffff', sunken: '#f3ede3', line: '#e6dbca', line2: '#cdbfa6', ink: '#221a14', body: '#574838', muted: '#716351', grid: 'rgba(70,42,18,.09)', glow: 'rgba(255,255,255,.7)' }
    : { paper: '#f5f4f2', raised: '#ffffff', sunken: '#ebe9e6', line: '#dedbd6', line2: '#b9b4ae', ink: '#0c0b0a', body: '#57534e', muted: '#6b665f', grid: 'rgba(0,0,0,.07)', glow: 'rgba(255,255,255,.7)' };
  const graphite = { paper: '#0d0d0d', raised: '#161616', sunken: '#1a1a1a', line: '#262626', line2: '#3a3a3a', ink: '#e8e6e3', body: '#a6a6a6', muted: '#8a8a8a', grid: 'rgba(255,255,255,.06)', glow: 'rgba(255,255,255,.05)' };
  const t = { ...(dark ? graphite : light) };
  t.acc = accent === 'oak' ? (dark ? '#c58a63' : '#834a2b') : (dark ? '#f07a4a' : '#e0552a');
  t.glowc = accent === 'oak' ? (dark ? 'rgba(131,74,43,.32)' : 'rgba(197,138,99,.32)') : (dark ? 'rgba(224,85,42,.22)' : 'rgba(240,122,74,.32)');
  t.btn = dark ? '#e8e6e3' : '#0c0b0a';
  t.btnfg = dark ? '#0d0d0d' : '#f5f4f2';
  t.tt = caps === 'upper' ? 'uppercase' : 'none';
  t.ls = caps === 'upper' ? '-0.04em' : '-0.035em';
  t.shadow = dark ? 'rgba(0,0,0,.75)' : 'rgba(0,0,0,.45)';
  return t;
}

const variants = {
  'main-light.html': { theme: 'light', accent: 'ember', paper: 'neutral', caps: 'upper' },
  'main-dark.html': { theme: 'dark', accent: 'ember', paper: 'neutral', caps: 'upper' },
  'lever-oak.html': { theme: 'light', accent: 'oak', paper: 'neutral', caps: 'upper' },
  'lever-cream.html': { theme: 'light', accent: 'oak', paper: 'cream', caps: 'upper' },
  'lever-sentence.html': { theme: 'light', accent: 'ember', paper: 'neutral', caps: 'sentence' },
};

const src = readFileSync(join(here, 'Main.dc.html'), 'utf8');
for (const [file, levers] of Object.entries(variants)) {
  const t = tokens(levers);
  let html = src.replace(/\{\{\s*t\.(\w+)\s*\}\}/g, (_, k) => t[k]);
  html = html.replace(/<sc-if[^>]*>/g, '').replace(/<\/sc-if>/g, '');
  html = html.replace(/<script data-dc-script[\s\S]*?<\/script>/, '');
  html = html.replace(/<script src="\.\/support\.js"><\/script>/, '');
  html = html.replace('<body>', `<body style="background:${t.paper}">`);
  writeFileSync(join(outDir, file), html);
  console.log('preview', file);
}
for (const img of readdirSync(here).filter((f) => /\.(jpe?g|png)$/i.test(f))) copyFileSync(join(here, img), join(outDir, img));
for (const f of ['Mobile.dc.html', 'System.dc.html', 'Copy.dc.html']) {
  const html = readFileSync(join(here, f), 'utf8').replace(/<script src="\.\/support\.js"><\/script>/, '');
  writeFileSync(join(outDir, f.replace('.dc.html', '.html').toLowerCase()), html);
  console.log('preview', f);
}
