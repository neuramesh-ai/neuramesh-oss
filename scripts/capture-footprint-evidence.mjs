// Evidence for the agents' footprint (worktree-berths round + George's review round 2026-08-11):
// the Home corner RING (utilization + score, click opens the view), the destination in plain words
// (workspaces / dependencies / repos — never the daemon's berths/donors vocabulary, no em-dashes),
// the hover layer, and the report-only fleet well — in BOTH verification themes.
//
// Every absence assertion is paired with a non-zero positive control. Run after a preview build:
//   pnpm -C apps/desktop exec vite build --config vite.preview.config.mjs \
//     && pnpm -C apps/desktop exec electron scripts/capture-footprint-evidence.mjs
import { app, BrowserWindow } from 'electron';
import { writeFileSync, mkdirSync } from 'node:fs';

const R = process.env.NM_REPO_ROOT ?? new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const OUT = `${R}/docs/evidence/footprint`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const RING = `(() => {
  const ring = document.querySelector('.fpring');
  return {
    rings: document.querySelectorAll('.fpring').length,
    inGreet: document.querySelectorAll('.hgreetblk .fpring').length,
    pct: ring?.querySelector('.fpringpct')?.textContent ?? '',
    title: ring?.getAttribute('title') ?? '',
    arcs: ring ? ring.querySelectorAll('svg circle').length : 0,
    cards: document.querySelectorAll('.fpcard').length,
  };
})()`;

const VIEW = `(() => {
  const view = document.querySelector('.fpview');
  const text = view?.textContent ?? '';
  const labels = [...document.querySelectorAll('.fpchartwrap svg .fpbandlabel')].map((t) => t.textContent);
  return {
    views: document.querySelectorAll('.fpview').length,
    stats: document.querySelectorAll('.fpstat').length,
    warnStats: document.querySelectorAll('.fpstat.warnv').length,
    bands: document.querySelectorAll('.fpchartwrap svg path').length,
    bandLabels: labels,
    legend: document.querySelectorAll('.fpvizlegend > span').length,
    rows: document.querySelectorAll('.fpview .fprow').length,
    fleetRows: document.querySelectorAll('.fpfleet .fprow').length,
    fleetFoot: document.querySelector('.fpfleetfoot')?.textContent ?? '',
    fleetMeter: document.querySelector('.fpfleet .fprow .meter i')?.getAttribute('style') ?? '',
    note: document.querySelector('.fpnote')?.textContent ?? '',
    // the plain-words contract: daemon vocabulary and em-dashes never reach the user
    jargon: (text.match(/berth|donor|clone|CoW|apparent/gi) ?? []).length,
    emdash: (text.match(/—/g) ?? []).length,
    plain: (text.match(/workspaces|dependencies/gi) ?? []).length,
    cleanBtns: [...document.querySelectorAll('.fpviz button')].map((b) => b.textContent.trim()),
    padding: view ? getComputedStyle(view).paddingLeft : '',
  };
})()`;

app.whenReady().then(async () => {
  mkdirSync(OUT, { recursive: true });
  const win = new BrowserWindow({ width: 1440, height: 940, show: false });
  let bad = 0;
  const fail = (m) => { console.error(`ASSERT FAILED: ${m}`); bad++; };
  const control = (m) => { console.error(`CONTROL FAILED: ${m}`); bad++; };
  const js = (c) => win.webContents.executeJavaScript(c);
  const shot = async (n) => writeFileSync(`${OUT}/${n}.png`, (await win.webContents.capturePage()).toPNG());

  try {
    for (const theme of ['cream-oak', 'dark']) {
      // Home: the corner ring in the greeting row — the card is DEAD (George review round)
      await win.loadURL(`file://${R}/apps/desktop/out/preview/index.html?theme=${theme}&plan=cloud&channel=dev`);
      await sleep(4500);
      const ring = await js(RING);
      console.log(`ring/${theme}`, JSON.stringify(ring));
      if (ring.rings !== 1) control(`expected 1 footprint ring on Home, got ${ring.rings} — nothing below is proven`);
      if (ring.inGreet !== 1) fail('the ring is not in the greeting row');
      if (!/^\d+%$/.test(ring.pct)) fail(`the ring score reads "${ring.pct}"`);
      if (!/Agent disk: .+ of .+/.test(ring.title)) fail(`the ring tooltip reads "${ring.title}"`);
      if (ring.arcs !== 2) fail(`${ring.arcs} ring arcs, want track + fill`);
      if (ring.cards !== 0) fail(`${ring.cards} footprint card(s) still on Home — the card was retired`);
      await shot(`home-ring-${theme}`);

      // the ring opens the destination
      await js(`(() => { document.querySelector('.fpring')?.click(); return true; })()`);
      await sleep(1200);
      const view = await js(VIEW);
      console.log(`view/${theme}`, JSON.stringify(view));
      if (view.views !== 1) control(`the ring did not open the destination (${view.views} .fpview) — nothing below is proven`);
      if (view.stats < 3) fail(`${view.stats} hero stats`);
      if (view.warnStats !== 1) fail(`${view.warnStats} warn-toned stats, want exactly the fleet total`);
      if (view.bands !== 3) fail(`${view.bands} area bands, want 3`);
      if (JSON.stringify(view.bandLabels.slice().sort()) !== JSON.stringify(['dependencies', 'repos', 'workspaces'])) fail(`band labels are ${JSON.stringify(view.bandLabels)}`);
      if (view.legend !== 3) fail(`${view.legend} legend entries`);
      if (view.rows < 4) fail(`${view.rows} breakdown rows`);
      if (view.fleetRows !== 2) fail(`${view.fleetRows} fleet rows`);
      if (!/never touches these/.test(view.fleetFoot)) fail(`the fleet ruling reads "${view.fleetFoot}"`);
      if (!/var\(--warn\)/.test(view.fleetMeter)) fail(`fleet meter is not --warn (${view.fleetMeter})`);
      if (!/real use is smaller/.test(view.note)) fail(`the honesty note reads "${view.note}"`);
      if (view.plain < 4) control(`only ${view.plain} plain-word hits — the jargon assertion is unproven`);
      if (view.jargon !== 0) fail(`${view.jargon} jargon hits (berth/donor/clone/CoW/apparent) reached the user`);
      if (view.emdash !== 0) fail(`${view.emdash} em-dash(es) in the view`);
      if (!view.cleanBtns.includes('Clean up')) fail(`viz actions are ${JSON.stringify(view.cleanBtns)}`);
      if (parseFloat(view.padding) < 20) fail(`view padding-left is ${view.padding}, want breathing room`);
      await shot(`destination-${theme}`);

      // the hover layer
      const hov = await js(`(() => {
        const svg = document.querySelector('.fpchartwrap svg');
        const r = svg.getBoundingClientRect();
        svg.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: r.left + r.width * 0.55, clientY: r.top + r.height / 2 }));
        return new Promise((res) => setTimeout(() => res({
          tips: document.querySelectorAll('.fptip').length,
          rows: document.querySelectorAll('.fptip .r').length,
          labels: [...document.querySelectorAll('.fptip .r')].map((x) => x.textContent.replace(/[\\d.]+ GB/, '').trim()),
          cross: document.querySelectorAll('.fpchartwrap svg line[stroke="var(--ring)"]').length,
        }), 120));
      })()`);
      console.log(`hover/${theme}`, JSON.stringify(hov));
      if (hov.tips !== 1) fail(`hover produced ${hov.tips} tooltips`);
      if (hov.rows !== 4) fail(`the tooltip has ${hov.rows} rows`);
      if (!hov.labels.some((l) => /workspaces/.test(l))) fail(`tooltip rows read ${JSON.stringify(hov.labels)} — plain words expected`);
      if (hov.cross !== 1) fail(`${hov.cross} crosshair lines`);
      await shot(`destination-hover-${theme}`);
    }

    // Clean up: the button opens a TRUE preview — the sweeper's own itemized verdict — and only
    // the popover's confirm acts. Cancel and Esc both stand down without touching anything.
    await win.loadURL(`file://${R}/apps/desktop/out/preview/index.html?theme=cream-oak&plan=cloud&channel=dev`);
    await sleep(4500);
    await js(`(() => { document.querySelector('.fpring')?.click(); return true; })()`);
    await sleep(1200);
    const preRows = await js(`document.querySelectorAll('.fpview .fprow').length`);
    if (preRows < 4) control(`pre-clean-up rows ${preRows} — the delta is unproven`);
    await js(`(() => { [...document.querySelectorAll('.fpviz button')].find((b) => b.textContent.trim() === 'Clean up')?.click(); return true; })()`);
    await sleep(400);
    const confirm = await js(`(() => {
      const c = document.querySelector('.fpconfirm');
      const text = c?.textContent ?? '';
      return {
        open: !!c,
        items: document.querySelectorAll('.fpconfirm .r').length,
        labels: [...document.querySelectorAll('.fpconfirm .r')].map((r) => r.textContent),
        safe: /Active work is never touched/.test(text),
        total: [...document.querySelectorAll('.fpconfirm .acts button')].map((b) => b.textContent.trim()),
        emdash: (text.match(/—/g) ?? []).length,
        rowsWhileOpen: document.querySelectorAll('.fpview .fprow').length,
      };
    })()`);
    console.log('confirm', JSON.stringify(confirm));
    if (!confirm.open) control('the Clean-up preview never opened — the confirm flow is unproven');
    if (confirm.items < 2) fail(`the preview lists ${confirm.items} item lines`);
    if (!confirm.labels.some((l) => /workspace/.test(l)) || !confirm.labels.some((l) => /dependency/.test(l))) fail(`preview lines read ${JSON.stringify(confirm.labels)}`);
    if (!confirm.safe) fail('the preview is missing the never-touched line');
    if (!confirm.total.some((t) => /^Clean up · 2\.3 GB$/.test(t)) || !confirm.total.includes('Cancel')) fail(`preview actions are ${JSON.stringify(confirm.total)}`);
    if (confirm.emdash !== 0) fail(`${confirm.emdash} em-dash(es) in the preview`);
    if (confirm.rowsWhileOpen !== preRows) fail('opening the preview already changed the rows — it must be read-only');
    await shot('destination-confirm-cream-oak');

    // Cancel stands down, nothing changes
    await js(`(() => { [...document.querySelectorAll('.fpconfirm .acts button')].find((b) => b.textContent.trim() === 'Cancel')?.click(); return true; })()`);
    await sleep(300);
    const cancelled = await js(`(() => ({ open: !!document.querySelector('.fpconfirm'), rows: document.querySelectorAll('.fpview .fprow').length }))()`);
    if (cancelled.open) fail('Cancel left the preview open');
    if (cancelled.rows !== preRows) fail(`Cancel changed the rows (${preRows} → ${cancelled.rows})`);

    // confirm through the preview: the whisper lands and the rows shrink
    await js(`(() => { [...document.querySelectorAll('.fpviz button')].find((b) => b.textContent.trim() === 'Clean up')?.click(); return true; })()`);
    await sleep(400);
    await js(`(() => { [...document.querySelectorAll('.fpconfirm .acts button')].find((b) => /^Clean up · /.test(b.textContent.trim()))?.click(); return true; })()`);
    await sleep(900);
    const after = await js(`(() => ({
      done: document.querySelector('.fpviz .fpdone')?.textContent ?? '',
      rows: document.querySelectorAll('.fpview .fprow').length,
      open: !!document.querySelector('.fpconfirm'),
      disabled: [...document.querySelectorAll('.fpviz > .fpvizhead button, .fpviz .fpconfirmwrap > button')].some((b) => b.disabled),
    }))()`);
    console.log('cleanup', JSON.stringify(after));
    if (!/^Freed 2\.3 GB$/.test(after.done)) fail(`the clean-up whisper reads "${after.done}"`);
    if (after.rows >= preRows) fail(`clean up removed nothing (rows ${preRows} → ${after.rows})`);
    if (after.open) fail('the preview survived its own confirm');
    if (!after.disabled) fail('with nothing left to free, the Clean up button is not disabled');
    await shot('destination-cleaned-cream-oak');

    // nav: OUT of the Shortcuts band (control: Whiteboards there), IN the workspace rail — the
    // ProjectsFace stays mounted in a side dock, so its rows are queryable without opening it
    const nav = await js(`(() => ({
      short: [...document.querySelectorAll('.navdest .navitem, .navdest button')].map((b) => b.textContent.trim()),
      rail: [...document.querySelectorAll('.pfnew')].map((b) => b.textContent.trim()),
    }))()`);
    console.log('nav', JSON.stringify(nav));
    if (!nav.short.some((t) => /Whiteboards/.test(t))) control('the Shortcuts band lists no Whiteboards — the exclusion is unproven');
    else if (nav.short.some((t) => /Footprint/.test(t))) fail('Footprint is still in the Shortcuts band');
    if (!nav.rail.some((t) => /Agents & machines/.test(t))) control('the workspace rail shows no Agents & machines — the inclusion is unproven');
    else if (!nav.rail.some((t) => /Footprint/.test(t))) fail('the workspace rail does not carry Footprint');
  } catch (e) { console.error('CAPTURE CRASHED:', e); bad++; }

  console.log(bad ? `\n${bad} FAILURE(S)` : '\nall assertions passed');
  app.exit(bad ? 1 : 0);
});
