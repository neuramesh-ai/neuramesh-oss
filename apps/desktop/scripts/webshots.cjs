// Capture web pages (a running dev server) and local HTML files in a real Electron window, in a
// named colour scheme — the site's reveal animations need rAF and IntersectionObserver running,
// which a hidden preview pane never gives. ONE window for every spec, like shoot.cjs: a second
// BrowserWindow in the same process failed every load with ERR_FAILED (-2), whatever the URL.
//
//   NM_WEBSHOT_SPECS=specs.json NM_WEBSHOT_OUT=dir electron scripts/webshots.cjs
//   spec: { name, url | file, query?, theme: 'dark'|'light', settle?, js?, after?, height? }
const { app, BrowserWindow, nativeTheme } = require('electron');
const { writeFileSync, mkdirSync, readFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const outDir = process.env.NM_WEBSHOT_OUT;
const specs = JSON.parse(readFileSync(process.env.NM_WEBSHOT_SPECS, 'utf8'));
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  mkdirSync(outDir, { recursive: true });
  const win = new BrowserWindow({ width: 1300, height: 900, show: false, enableLargerThanScreen: true, webPreferences: { sandbox: true } });
  win.webContents.on('did-fail-load', (_e, code, desc, url) => console.log(`fail_load code=${code} ${desc} ${url}`));
  for (const spec of specs) {
    try {
      nativeTheme.themeSource = spec.theme === 'dark' ? 'dark' : 'light';
      win.setSize(spec.width || 1300, spec.height || 900);
      if (spec.file) await win.loadFile(resolve(spec.file), { query: spec.query || {} });
      else await win.loadURL(spec.url);
      await new Promise((r) => setTimeout(r, spec.settle || 1500));
      if (spec.js) { try { await win.webContents.executeJavaScript(spec.js); await new Promise((r) => setTimeout(r, spec.after || 900)); } catch (e) { console.log('js_failed=' + spec.name + ' ' + (e && e.message)); } }
      const png = (await win.webContents.capturePage()).toPNG();
      writeFileSync(join(outDir, spec.name + '.png'), png);
      console.log('shot_saved=' + spec.name + ' bytes=' + png.length);
    } catch (e) { console.log('spec_failed=' + spec.name + ' ' + (e && e.message)); }
  }
  app.exit(0);
}).catch((e) => { console.error('webshots_failed', e); app.exit(1); });
