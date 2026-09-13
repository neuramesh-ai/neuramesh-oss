// Evidence for the popover round (2026-08-17) — the overlays that are really bigger MENUS stop
// dimming the room and grow out of the control that opened them.
//
//   pnpm -C apps/desktop exec vite build --config vite.preview.config.mjs
//   pnpm -C apps/desktop exec electron ../../scripts/capture-popover-round.mjs
//
// The harness's ?click= drives by aria-label, which fires a real `click` but no `pointerdown` —
// and `pointerdown` is what records the anchor (ui/anchor.ts). So each shot dispatches the press
// itself before the click, which is also the honest test: a surface whose anchor never landed
// falls back to centred, and the audit below would catch it as `anchored: false`.
import { app, BrowserWindow } from 'electron';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs/evidence/popover-round');
mkdirSync(OUT, { recursive: true });
const F = 'file://' + join(ROOT, 'apps/desktop/out/preview/index.html');

/** press-then-click a control by CSS selector, in the page */
const DRIVE = (steps) => `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const press = (el) => { const r = el.getBoundingClientRect();
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
    el.click(); };
  const find = (sel) => sel.startsWith('~text:')
    ? [...document.querySelectorAll('button, [role="button"]')].find((b) => (b.textContent || '').includes(sel.slice(6)))
    : document.querySelector(sel);
  for (const sel of ${JSON.stringify(steps)}) {
    let el = null;
    for (let i = 0; i < 60 && !el; i++) { el = find(sel); if (!el) await sleep(120); }
    if (!el) return 'missing: ' + sel;
    press(el); await sleep(500);
  }
  return 'ok';
})()`;

const SHOTS = [
  // ① search every thread (⌘Y's surface), from the rail's magnifier
  ['01-history-popover', 'plan=cloud', [".navhistfind"]],
  // ② New task — the caret menu's other row. A compose surface, so it stays CENTRED; what it
  //    drops is the veil, and it pivots out of the row you picked.
  ['02-launcher-anchored', 'plan=cloud', ['.navnewcaret', '.navftmenu button']],
  // ③ the room's agents roster, from the crew cluster at the room header's right
  ['03-roster-popover', 'plan=cloud&click=Spikes', ['[aria-label^="Agents in this channel"]']],
  // ④ Create agent — a FORM, so it keeps the measure and only pivots + drops the veil
  ['04-create-agent', 'plan=cloud&click=Spikes', ['[aria-label^="Agents in this channel"]', '~text:Create a new agent']],
  // ⑤ Add external agent, from the same roster foot
  ['05-add-external-agent', 'plan=cloud&click=Spikes', ['[aria-label^="Agents in this channel"]', '~text:Connect a remote agent']],
  // ⑥ Invite people, from the people cluster
  ['06-invite-people', 'plan=cloud&click=Spikes', ['[aria-label^="People in this channel"]', '~text:Invite']],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1500, height: 940, show: false, webPreferences: { backgroundThrottling: false } });
  const shots = [];
  for (const [name, query, steps] of SHOTS) {
    for (const theme of ['dark', 'cream-oak']) {
      await win.loadURL(`${F}?theme=${theme}&${query}`);
      await sleep(4200);
      const drove = await win.webContents.executeJavaScript(DRIVE(steps));
      await sleep(700);
      const img = await win.webContents.capturePage();
      const file = join(OUT, `${name}-${theme === 'dark' ? 'graphite' : 'cream'}.png`);
      writeFileSync(file, img.toPNG());
      // positive controls: the surface is UP, nothing is dimming or blurring behind it, and the
      // pivot actually landed on the trigger rather than silently falling back to centred
      const probe = await win.webContents.executeJavaScript(`(() => {
        const surf = document.querySelector('.popsurf') || document.querySelector('.modal');
        const veil = document.querySelector('.popscrim') || document.querySelector('.overlay');
        if (!surf || !veil) return { open: false };
        const vs = getComputedStyle(veil), ss = getComputedStyle(surf), r = surf.getBoundingClientRect();
        const transparent = vs.backgroundColor === 'rgba(0, 0, 0, 0)' || vs.backgroundColor === 'transparent';
        return {
          open: true, kind: surf.className,
          veilTransparent: transparent, veilBlur: vs.backdropFilter,
          anchored: ss.transformOrigin !== '50% 50%', origin: ss.transformOrigin,
          inViewport: r.left >= -1 && r.top >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1,
          box: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
        };
      })()`);
      // REGRESSION (2026-08-17, George live): clicking a filter INSIDE the roster walked the panel
      // down-left, one click at a time — `anchorPoint()` reads the last press and callers evaluate
      // it during render, so every click inside became the new anchor. The origin is frozen at
      // mount now; this proves it, per shot, rather than trusting the fix.
      const held = await win.webContents.executeJavaScript(`(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const surf = document.querySelector('.popsurf') || document.querySelector('.modal');
        if (!surf) return null;
        const at = () => { const r = surf.getBoundingClientRect(); return Math.round(r.left) + ':' + Math.round(r.top); };
        const before = at();
        const inside = [...surf.querySelectorAll('button')].filter((b) => !b.disabled).slice(0, 3);
        for (const b of inside) {
          const r = b.getBoundingClientRect();
          b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
          await sleep(180);
        }
        return { clicked: inside.length, before, after: at(), held: before === at() };
      })()`);
      shots.push({ file: file.replace(ROOT + '/', ''), theme, drove, ...probe, held });
      console.log(`▸ ${name} · ${theme}`, drove === 'ok' ? '' : `DRIVE=${drove}`, JSON.stringify(probe), 'held=' + JSON.stringify(held));
    }
  }
  writeFileSync(join(OUT, 'audit.json'), JSON.stringify(shots, null, 2));
  const bad = shots.filter((s) => !s.open || !s.veilTransparent || s.veilBlur !== 'none' || !s.inViewport
    || (s.held && (!s.held.clicked || !s.held.held)));
  console.log(`\n${shots.length} shots → ${OUT.replace(ROOT + '/', '')}${bad.length ? `\n${bad.length} FAILED the veil/viewport checks` : ''}`);
  app.quit();
});
