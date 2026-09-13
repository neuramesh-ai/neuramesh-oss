const { app, BrowserWindow } = require('electron');
const { writeFileSync, mkdirSync, readFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const indexHtml = resolve(process.env.NM_SHOOT_INDEX), outDir = process.env.NM_SHOOT_OUT;
const specs = JSON.parse(readFileSync(process.env.NM_SHOOT_SPECS, 'utf8'));
app.disableHardwareAcceleration();
const load = async (win, query, attempt = 0) => {
  try { await win.loadFile(indexHtml, { query }); }
  catch (e) { if (attempt < 3) { await new Promise(r => setTimeout(r, 500)); return load(win, query, attempt + 1); } throw e; }
};
app.whenReady().then(async () => {
  mkdirSync(outDir, { recursive: true });
  // NM_SHOOT_ZOOM=2 → true page zoom (vh-safe, unlike body.style.zoom) for retina-density
  // crops; enableLargerThanScreen so offscreen windows aren't clamped to the display.
  const win = new BrowserWindow({ width: +process.env.NM_SHOOT_W || 1300, height: +process.env.NM_SHOOT_H || 1000, show: false, enableLargerThanScreen: true, webPreferences: { sandbox: true, zoomFactor: +process.env.NM_SHOOT_ZOOM || 1,
    // an in-memory partition (no `persist:` prefix): a shot renders the app's DEFAULTS, never a preference an earlier
    // run or a hand test left in the shared Electron storage (2026-09-12: a stale nm:navw held the rail at 290 through a
    // default change, and the evidence lied for a round)
    partition: 'nm-shoot' } });
  for (const spec of specs) {
    try {
      await load(win, spec.query || {});
      await new Promise((r) => setTimeout(r, spec.settle || 1400));
      // optional: run a JS snippet (e.g. scroll a modal to its bottom) before capture
      if (spec.js) { try { await win.webContents.executeJavaScript(spec.js); await new Promise((r) => setTimeout(r, 350)); } catch (e) { console.log('js_failed=' + spec.name + ' ' + (e && e.message)); } }
      const png = (await win.webContents.capturePage()).toPNG();
      writeFileSync(join(outDir, spec.name + '.png'), png);
      console.log('shot_saved=' + spec.name + ' bytes=' + png.length);
    } catch (e) { console.log('spec_failed=' + spec.name + ' ' + (e && e.message)); }
  }
  app.exit(0);
}).catch((e) => { console.error('shoot_failed', e); app.exit(1); });
