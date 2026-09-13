// Generates the landing artboards from one template. Each artboard is the same page with
// different lever defaults: theme, accent, paper, case, and whether the page runs past the hero.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const tpl = readFileSync(join(here, 'main.template.html'), 'utf8');

const variants = [
  { file: 'Main.dc.html',        theme: 'light', accent: 'ember', paper: 'neutral', caps: 'upper',    full: true,  h: 9200 },
  { file: 'Graphite.dc.html',    theme: 'dark',  accent: 'ember', paper: 'neutral', caps: 'upper',    full: true,  h: 9200 },
  { file: 'OakAccent.dc.html',   theme: 'light', accent: 'oak',   paper: 'neutral', caps: 'upper',    full: false, h: 1500 },
  { file: 'CreamPaper.dc.html',  theme: 'light', accent: 'oak',   paper: 'cream',   caps: 'upper',    full: false, h: 1500 },
  { file: 'SentenceCase.dc.html', theme: 'light', accent: 'ember', paper: 'neutral', caps: 'sentence', full: false, h: 1500 },
  { file: 'DownloadMenu.dc.html', theme: 'light', accent: 'ember', paper: 'neutral', caps: 'upper',    full: false, h: 1500, menu: true },
];

for (const v of variants) {
  const out = tpl
    .replace('__THEME__', v.theme)
    .replace('__ACCENT__', v.accent)
    .replace('__PAPER__', v.paper)
    .replace('__CAPS__', v.caps)
    .replace('__FULL__', String(v.full))
    .replace('__MENU__', String(!!v.menu))
    .replace('__H__', String(v.h));
  if (/__[A-Z]+__/.test(out)) throw new Error(`placeholder left in ${v.file}`);
  writeFileSync(join(here, v.file), out);
  console.log('wrote', v.file);
}
