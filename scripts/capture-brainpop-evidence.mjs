// Evidence for the compressed brain popup (the shell round R6, direction C off
// mockups/brain-picker-compact.html): same shape, 340×~340 instead of 560×~420, rows as
// one-liners, both panes scrolling inside ONE fixed body so a many-seat room can never grow it.
//   pnpm -C apps/desktop exec vite build --config vite.preview.config.mjs \
//     && pnpm -C apps/desktop exec electron scripts/capture-brainpop-evidence.mjs
import { app, BrowserWindow } from 'electron';
import { writeFileSync, mkdirSync } from 'node:fs';

const R = process.env.NM_REPO_ROOT ?? new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const OUT = `${R}/docs/evidence/shell-round`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  mkdirSync(OUT, { recursive: true });
  const win = new BrowserWindow({ width: 1440, height: 940, show: false });
  let bad = 0;
  const fail = (m) => { console.error(`ASSERT FAILED: ${m}`); bad++; };
  const control = (m) => { console.error(`CONTROL FAILED: ${m}`); bad++; };
  const js = (code) => win.webContents.executeJavaScript(code);
  const shot = async (name) => writeFileSync(`${OUT}/${name}.png`, (await win.webContents.capturePage()).toPNG());

  try {
    for (const theme of ['cream-oak', 'dark']) {
      await win.loadURL(`file://${R}/apps/desktop/out/preview/index.html?theme=${theme}&plan=cloud`);
      await sleep(3600);
      // the stage hosts the pill
      await js(`(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', metaKey: true, bubbles: true })); return true; })()`);
      await sleep(700);
      const a = await js(`(() => new Promise((res) => {
        const pill = [...document.querySelectorAll('.stagewrap .cchip')].find((c) => /Brain/.test(c.textContent));
        if (!pill) { res({ noPill: true }); return; }
        pill.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        setTimeout(() => {
          const pop = document.querySelector('.brainpop');
          if (!pop) { res({ noPop: true }); return; }
          const r = pop.getBoundingClientRect();
          const body = pop.querySelector('.brbody');
          const out = {
            w: Math.round(r.width), h: Math.round(r.height),
            bodyH: Math.round(body.getBoundingClientRect().height),
            rows: pop.querySelectorAll('.brrow').length,
            rowH: Math.round(pop.querySelector('.brrow')?.getBoundingClientRect().height ?? 0),
            rolesScrolls: getComputedStyle(pop.querySelector('.brrrows')).overflowY,
            // R7: the prose is GONE (rows above are the positive control) and the scope
            // segment leads with "This thread"
            proseNodes: pop.querySelectorAll('.brrname, .brrsub, .brrhint, .bpsupport, .brpkfoot, .bpdtag').length,
            scopeLead: pop.querySelector('.brrscope button')?.textContent ?? null,
            footRest: pop.querySelector('.brrfoot span')?.textContent ?? null,
          };
          // flip to Packs — the SAME height must hold (the §15 no-resize contract)
          [...pop.querySelectorAll('.brtab')].find((t) => /Packs/.test(t.textContent))?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          setTimeout(() => {
            const r2 = pop.getBoundingClientRect();
            out.packH = Math.round(r2.height);
            out.packListW = Math.round(pop.querySelector('.bplist')?.getBoundingClientRect().width ?? 0);
            out.detailOverflow = (() => { const d = pop.querySelector('.bpdetail'); return d ? d.scrollWidth - d.clientWidth : null; })();
            res(out);
          }, 350);
        }, 350);
      }))()`);
      console.log(`brainpop/${theme}`, JSON.stringify(a));
      if (a.noPill || a.noPop) { control('the pill or popup never mounted'); continue; }
      if (a.w !== 340) fail(`popup is ${a.w}px wide, not 340 (R6)`);
      if (a.bodyH !== 296) fail(`body is ${a.bodyH}px, not the fixed 296`);
      if (a.rows === 0) control('no role rows — the compression is unproven');
      if (a.rowH > 34) fail(`a role row is ${a.rowH}px tall — not a one-liner`);
      if (a.rolesScrolls !== 'auto') fail(`the roles list does not scroll inside the box (${a.rolesScrolls})`);
      if (a.proseNodes !== 0) fail(`${a.proseNodes} stripped-prose node(s) survive (R7)`);
      if (a.scopeLead !== 'This thread') fail(`the scope segment leads with ${JSON.stringify(a.scopeLead)}, not "This thread"`);
      if (a.footRest !== '') fail(`the resting footer still speaks: ${JSON.stringify(a.footRest)} (it may only report dirty/changed counts)`);
      if (a.packH !== a.h) fail(`switching to Packs resized the popup (${a.h} → ${a.packH}) — the §15 contract broke`);
      if (a.packListW > 130) fail(`the pack list is still ${a.packListW}px wide`);
      if (a.detailOverflow != null && a.detailOverflow > 1) fail(`the pack detail overflows by ${a.detailOverflow}px`);
      await shot(`brainpop-packs-${theme}`);
      await js(`(() => { [...document.querySelectorAll('.brtab')].find((t) => /Roles/.test(t.textContent))?.dispatchEvent(new MouseEvent('click', { bubbles: true })); return true; })()`);
      await sleep(300);
      await shot(`brainpop-roles-${theme}`);
    }
  } catch (e) { console.error('CAPTURE CRASHED:', e); bad++; }
  console.log(bad ? `\n${bad} FAILURE(S)` : '\nall assertions passed');
  app.exit(bad ? 1 : 0);
});
