// Evidence capture via Electron itself — loads the built preview harness (the real
// <App/> + mock bridge) in an offscreen BrowserWindow and capturePage()s the theme
// matrix. No headless-Chrome quirks: this IS the app's own renderer.
//   pnpm --dir apps/desktop exec electron ../../scripts/capture-evidence-electron.mjs
//   NM_EVIDENCE_OUT=<dir> NM_SHOTS=<json> … — another folder and another shot list (a JSON array of
//   [name, query, waitMs]; `query` is appended to the harness URL), so a round can capture its own
//   matrix without editing the default one below.
import { app, BrowserWindow } from 'electron';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.NM_EVIDENCE_OUT || join(ROOT, 'docs/evidence/revamp');
mkdirSync(OUT, { recursive: true });
const F = 'file://' + join(ROOT, 'apps/desktop/out/preview/index.html');

const SHOTS = process.env.NM_SHOTS ? JSON.parse(readFileSync(process.env.NM_SHOTS, 'utf8')).map(([n, q, w]) => [n, `${F}${q}`, w]) : [
  ['01-cream-home', `${F}?theme=cream-oak&plan=cloud`, 4000],
  ['02-cream-board', `${F}?theme=cream-oak&plan=cloud&click=Views&clicktext=Board,Whole project`, 6000],
  ['03-cream-task-review', `${F}?theme=cream-oak&plan=cloud&click=Views&clicktext=Board,Whole project,%231042`, 7500],
  ['04-cream-room', `${F}?theme=cream-oak&plan=cloud&click=Spikes`, 4000],
  ['05-dark-home', `${F}?theme=dark&plan=cloud`, 4000],
  ['06-dark-task-review', `${F}?theme=dark&plan=cloud&click=Views&clicktext=Board,Whole project,%231042`, 7500],
  ['07-light-home', `${F}?theme=light&plan=cloud`, 4000],
  ['08-softdark-home', `${F}?theme=soft-dark&plan=cloud`, 4000],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1440, height: 900, show: false, webPreferences: { backgroundThrottling: false } });
  for (const [name, url, wait] of SHOTS) {
    await win.loadURL(url);
    await sleep(wait);
    const img = await win.webContents.capturePage();
    writeFileSync(join(OUT, `${name}.png`), img.toPNG());
    console.log(`${name}.png ${img.getSize().width}x${img.getSize().height}`);
  }
  app.quit();
});
