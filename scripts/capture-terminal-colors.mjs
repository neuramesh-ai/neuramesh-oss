// Evidence capture for the terminal-colors round (2026-08-26).
//
// Playwright against the LIVE preview harness (`.claude/launch.json` → desktop-preview, :5199),
// the shell-simplification recipe: headless Chromium reports `visibility: visible`, so the
// terminal's rAF-deferred start actually runs — in the hidden Browser pane it never does
// (the preview-pane rAF trap).
//
// Every shot ASSERTS before it shoots (the selector-audit rule: a capture that cannot fail
// proves the fixture, not the feature):
//   terminal   — the mock banner's palette proof rendered, and the 24-bit grey line (the exact
//                Claude-Code-style output that vanished on cream) measures ≥4.2:1 against the
//                terminal ground — proving xterm's minimumContrastRatio floor is live in the
//                DOM renderer, not just configured.
//   unitcard   — the ‹task:…› unit reference wears the PhaseRing (no Spectrum ribbon), reads as
//                a TEXT row (no card background/shadow), and the Workbench did NOT auto-open
//                for a chat thread.
//   taskpanel  — opening a TASK still auto-opens the Workbench.
//
//   node scripts/capture-terminal-colors.mjs [baseUrl] [outDir]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.argv[2] || 'http://localhost:5199';
const OUT = process.argv[3] || '.nm-evidence/terminal-colors';
const FREEZE = `(() => { const s = document.createElement('style'); s.textContent = '*,*::before,*::after{animation-duration:.001s!important;transition-duration:.001s!important}'; document.head.appendChild(s); })()`;
const CLOSE_BELL = `(() => { const b = document.querySelector('.bellbtn.on'); if (b) b.click(); })()`;

// WCAG relative-luminance contrast between two computed rgb() strings.
const lum = (rgb) => {
  const [r, g, b] = rgb.match(/\d+/g).map(Number).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

const SHOTS = [
  {
    name: 'terminal', themes: ['cream-oak', 'dark'], query: { click: 'Terminal' }, settle: 2600,
    check: async (page, theme) => {
      const probe = await page.evaluate(() => {
        const rows = document.querySelector('.termhost .xterm-rows');
        if (!rows) return { err: 'no xterm rows' };
        const text = rows.textContent || '';
        // xterm's DOM renderer splits a run across spans — match any fragment of the phrase
        const grey = [...rows.querySelectorAll('span')].find((s) => /grey|24-b/.test(s.textContent || ''));
        const bg = getComputedStyle(document.querySelector('.termhost .xterm')?.closest('.termhost') || document.body).backgroundColor;
        const screenBg = getComputedStyle(document.querySelector('.xterm-screen') || document.body).backgroundColor;
        const termBg = getComputedStyle(document.documentElement).getPropertyValue('--panel').trim();
        return { text: text.slice(0, 400), greyColor: grey ? getComputedStyle(grey).color : null, bg, screenBg, termBg };
      });
      if (probe.err) return probe.err;
      if (!probe.text.includes('24-bit grey')) return `palette proof not rendered — buffer: "${probe.text.slice(0, 120)}"`;
      if (!probe.greyColor) return 'no span for the 24-bit grey run';
      // the floor: raw #999999 on cream is ~2.7:1 — if the rendered color still measures under
      // 4.2 the minimumContrastRatio option is configured but not applied (renderer gap).
      const hex = (h) => { const m = h.match(/^#(..)(..)(..)$/); return m ? `rgb(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)})` : h; };
      const ground = probe.termBg.startsWith('#') ? hex(probe.termBg) : probe.termBg;
      const c = contrast(probe.greyColor, ground);
      if (c < 4.2) return `24-bit grey renders ${probe.greyColor} on ${ground} = ${c.toFixed(2)}:1 — the contrast floor is NOT live`;
      console.log(`    ✓ [${theme}] palette proof rendered; 24-bit grey ${probe.greyColor} on ${ground} = ${c.toFixed(2)}:1`);
      return null;
    },
  },
  {
    // the session rows are .navhistrow divs, not buttons — the harness's ?clicktext only matches
    // button/[role=button]/.tcard, so this shot drives the row itself
    name: 'unitcard', themes: ['cream-oak', 'dark'], query: {}, settle: 1400,
    drive: async (page) => {
      const row = page.locator('.navhistrow', { hasText: 'Quick question' }).first();
      await row.waitFor({ timeout: 8000 });
      await row.click();
      await page.waitForTimeout(900);
    },
    check: async (page, theme) => {
      const probe = await page.evaluate(() => {
        const card = document.querySelector('.unitcard');
        if (!card) return { err: 'no .unitcard in the thread' };
        const cs = getComputedStyle(card);
        return {
          ring: !!card.querySelector('.pring'), spectrum: !!card.querySelector('.specwrap'),
          bg: cs.backgroundColor, shadow: cs.boxShadow, border: cs.borderTopWidth,
          wbOpen: !!document.querySelector('.wbhead'),
        };
      });
      if (probe.err) return probe.err;
      if (!probe.ring) return 'unit reference has no PhaseRing';
      if (probe.spectrum) return 'the Spectrum ribbon is still on the card';
      if (!(probe.bg === 'rgba(0, 0, 0, 0)' || probe.bg === 'transparent') || probe.shadow !== 'none' || probe.border !== '0px')
        return `still embossed — bg ${probe.bg}, shadow ${probe.shadow}, border ${probe.border}`;
      if (probe.wbOpen) return 'the Workbench auto-opened for a CHAT thread';
      console.log(`    ✓ [${theme}] ring on a text row; chat left the Workbench closed`);
      return null;
    },
  },
  {
    name: 'taskpanel', themes: ['cream-oak'], query: { openTask: '1063' }, settle: 2600,
    check: async (page, theme) => {
      const probe = await page.evaluate(() => ({
        task: !!document.querySelector('.threadpanel:not(.convo)'), wbOpen: !!document.querySelector('.wbhead'),
      }));
      if (!probe.task) return 'task thread did not open';
      if (!probe.wbOpen) return 'the Workbench did NOT auto-open for a task';
      console.log(`    ✓ [${theme}] task open → Workbench out`);
      return null;
    },
  },
];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
let failed = 0;
for (const shot of SHOTS) {
  for (const theme of shot.themes) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 880 }, deviceScaleFactor: 2 });
    const qs = new URLSearchParams({ theme, ...shot.query });
    await page.goto(`${BASE}/?${qs}`);
    await page.waitForTimeout(shot.settle);
    if (shot.drive) await shot.drive(page);
    await page.evaluate(FREEZE);
    await page.evaluate(CLOSE_BELL);
    await page.waitForTimeout(250);
    const err = await shot.check(page, theme);
    const file = join(OUT, `${shot.name}-${theme}.png`);
    await page.screenshot({ path: file });
    if (err) { failed++; console.error(`  ✗ ${shot.name} [${theme}]: ${err} — shot kept at ${file}`); }
    else console.log(`  • ${file}`);
    await page.close();
  }
}
await browser.close();
if (failed) { console.error(`${failed} check(s) failed`); process.exit(1); }
console.log('all checks passed');
