// Render the DMG installer background with a dynamic "v{version} · {arch}" pill
// composited onto the clean base art (top-right), matching the design's chip.
//
// Runs UNDER electron (it uses webContents.capturePage):
//   electron scripts/dmg-render.cjs --arch arm64 [--theme light] [--version 0.4.1] [--out build/.generated]
//
// Output: <out>/dmg-bg.png (640×440) + <out>/dmg-bg@2x.png (1280×880). The 1x is a
// clean downscale of the 2x render, so the two always agree.
const { app, BrowserWindow } = require('electron');
const { writeFileSync, mkdirSync } = require('node:fs');
const path = require('node:path');

// A THROW BEFORE app.whenReady() MUST STILL EXIT. Electron prints "App threw an error during load"
// and then keeps running with no window, so the beforePack hook's execFileSync waited on this
// process until GitHub's 6-hour job timeout (v0.122.0's first build, 2026-09-05 — the font package
// below had been renamed and the require threw at load). Any uncaught error is now a non-zero exit,
// which the hook turns into the clean, label-less art.
process.on('uncaughtException', (e) => { console.error('dmg_bg_render_failed', e); app.exit(1); });

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
const appDir = path.resolve(__dirname, '..'); // apps/desktop
const theme = arg('theme', 'light');
const arch = arg('arch', 'arm64');
const version = arg('version', require(path.join(appDir, 'package.json')).version);
const outDir = path.isAbsolute(arg('out', '')) ? arg('out', '') : path.join(appDir, arg('out', 'build/.generated'));

const base2x = path.join(appDir, `build/neuramesh-dmg-background-${theme}@2x.png`);
// the app's mono (rail-ink round, 2026-09-04: JetBrains Mono replaced Geist Mono) — the installer's
// version chip is set in the same face the app sets its own chips in
const fontPath = path.join(
  path.dirname(require.resolve('@fontsource-variable/jetbrains-mono/package.json')),
  'files/jetbrains-mono-latin-wght-normal.woff2',
);

// muted chip tones per theme (the brand's --muted / --border2)
const C = theme === 'dark' ? { text: '#b09a8a', border: '#4f3c2f' } : { text: '#8a7969', border: '#d8c4a8' };

const label = `v${version} · ${arch}`;
// geometry authored in @2x (1280×880) space — chip mirrors the top-left logo margin
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  @font-face { font-family:'JetBrains Mono Variable'; src:url('file://${fontPath}') format('woff2'); font-weight:100 800; font-style:normal; }
  html,body{margin:0;padding:0}
  .win{position:relative;width:1280px;height:880px;overflow:hidden;background:url('file://${base2x}') no-repeat;background-size:1280px 880px;}
  .ver{position:absolute;top:44px;right:48px;font-family:'JetBrains Mono Variable',monospace;font-weight:500;font-size:21px;letter-spacing:.5px;line-height:1;color:${C.text};border:1.6px solid ${C.border};border-radius:11px;padding:7px 15px;white-space:nowrap;}
</style></head><body><div class="win"><span class="ver">${label}</span></div></body></html>`;

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  mkdirSync(outDir, { recursive: true });
  const tmp = path.join(app.getPath('temp'), `nm-dmg-${process.pid}.html`);
  writeFileSync(tmp, html);
  const win = new BrowserWindow({ width: 1280, height: 880, useContentSize: true, show: false, webPreferences: { sandbox: true } });
  await win.loadFile(tmp);
  await new Promise((r) => setTimeout(r, 700)); // let the woff2 + base image settle
  const shot = await win.webContents.capturePage();
  // capturePage size follows the display's scale factor; normalize so output dims are exact
  writeFileSync(path.join(outDir, 'dmg-bg@2x.png'), shot.resize({ width: 1280, height: 880, quality: 'best' }).toPNG());
  writeFileSync(path.join(outDir, 'dmg-bg.png'), shot.resize({ width: 640, height: 440, quality: 'best' }).toPNG());
  console.log(`dmg_bg_rendered theme=${theme} arch=${arch} version=${version} label="${label}" out=${outDir}`);
  app.exit(0);
}).catch((e) => { console.error('dmg_bg_render_failed', e); app.exit(1); });
