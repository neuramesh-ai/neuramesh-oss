// `--shot` modes: projects, appearance, attachments — extracted from index.ts (track B-devshots).

import { app } from 'electron';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ShotCtx } from '../driver';
    // NM_SHOT_ONLY=projects: the top-left project switcher (one project at a time,
    // owning its channels) + the create-project modal. Both themes.
export async function projects({ win, dir, js, sleep, waitFor }: ShotCtx): Promise<void> {
  await waitFor('.wsswitch', 80);
  await js(`(() => { const s = document.createElement('style'); s.textContent = '*,*::before,*::after{animation-duration:.001s!important;transition-duration:.001s!important}'; document.head.appendChild(s); })()`);
  // open the switcher; wait for workspace-meta to populate the default project + its channels
  await js(`document.querySelector('.wsswitch')?.click()`);
  await waitFor('.projmenu', 40);
  for (let i = 0; i < 30; i++) { if (Number(await js(`[...document.querySelectorAll('.projmenu-meta')].filter((e) => /#/.test(e.textContent)).length`)) >= 1) break; await sleep(500); }
  await sleep(300);
  console.log(`projects_shot items=${await js(`document.querySelectorAll('.projmenu-item').length`)}`);
  for (const theme of ['dark', 'cream-oak'] as const) {
    await js(`document.documentElement.dataset.theme = '${theme}'`);
    await sleep(350);
    writeFileSync(join(dir, `projects-switcher-${theme}.png`), (await win.webContents.capturePage()).toPNG());
    console.log(`shot_saved=${join(dir, `projects-switcher-${theme}.png`)}`);
  }
  // the create-project modal, filled with a name + a couple of channels to move in
  await js(`document.querySelector('.projmenu-new')?.click()`);
  await waitFor('.chipselect', 40);
  await js(`(() => { const i = document.querySelector('.modal input'); if (i) { const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; set.call(i,'Marketing landing page'); i.dispatchEvent(new Event('input',{bubbles:true})); } })()`);
  await js(`[...document.querySelectorAll('.chiptoggle')].filter((b) => /#marketing|#dev/.test(b.textContent)).forEach((b) => b.click())`);
  await sleep(300);
  for (const theme of ['dark', 'cream-oak'] as const) {
    await js(`document.documentElement.dataset.theme = '${theme}'`);
    await sleep(350);
    writeFileSync(join(dir, `projects-create-${theme}.png`), (await win.webContents.capturePage()).toPNG());
    console.log(`shot_saved=${join(dir, `projects-create-${theme}.png`)}`);
  }
  app.exit(0);
  return;
}

    // NM_SHOT_ONLY=appearance: the 4 themes applied across the whole app, plus the
    // Appearance picker modal (system-sync card + 4 theme cards w/ live previews).
    // Themes are pure CSS-variable swaps, so no seeding is needed — just the chrome.
export async function appearance({ win, dir, js, sleep, waitFor }: ShotCtx): Promise<void> {
  await waitFor('.topbar', 80);
  // open a channel so the frame shows real chrome (sidebar + composer + chat)
  await js(`[...document.querySelectorAll('.chan')].find(c => c.textContent.includes('dev'))?.click()`);
  await sleep(600);
  // freeze animations for crisp frames
  await js(`(() => { const s = document.createElement('style'); s.textContent = '*,*::before,*::after{animation-duration:.001s!important;transition-duration:.001s!important}'; document.head.appendChild(s); })()`);
  await sleep(300);
  // 1) the whole app in each of the four themes — proves every theme renders
  for (const theme of ['dark', 'soft-dark', 'light', 'cream-oak'] as const) {
    await js(`document.documentElement.dataset.theme = '${theme}'`);
    await sleep(350);
    writeFileSync(join(dir, `appearance-${theme}.png`), (await win.webContents.capturePage()).toPNG());
    console.log(`shot_saved=${join(dir, `appearance-${theme}.png`)}`);
  }
  // 2) the Appearance modal — open once, then flip the theme under it (the modal
  //    chrome themes via CSS vars; the card previews use their own fixed colors)
  await js(`[...document.querySelectorAll('.topbar .btn')].find((b) => /appearance/i.test(b.title || ''))?.click()`);
  if (!(await waitFor('.themegrid', 40))) console.log('appearance_shot WARN no .themegrid');
  await sleep(400);
  console.log(`appearance_shot cards=${await js(`document.querySelectorAll('.themecard').length`)} sel=${await js(`!!document.querySelector('.themecard.sel')`)}`);
  for (const theme of ['dark', 'cream-oak'] as const) {
    await js(`document.documentElement.dataset.theme = '${theme}'`);
    await sleep(350);
    writeFileSync(join(dir, `appearance-panel-${theme}.png`), (await win.webContents.capturePage()).toPNG());
    console.log(`shot_saved=${join(dir, `appearance-panel-${theme}.png`)}`);
  }
  app.exit(0);
  return;
}

    // NM_SHOT_ONLY=attachments: the full chat-attachment experience — multiline composer,
    // the staged tray (image + file with upload progress), the free over-limit upgrade modal,
    // the sent message in the feed, the full-res lightbox, and the artifact-screen gallery.
    // Files are staged into the REAL composer via the hidden file input + a DataTransfer.
export async function attachments({ win, dir, js, sleep, waitFor }: ShotCtx): Promise<void> {
  const shoot = async (name: string, themes: readonly string[] = ['dark', 'cream-oak']) => {
    for (const theme of themes) {
      await js(`document.documentElement.dataset.theme = '${theme}'`);
      await sleep(300);
      writeFileSync(join(dir, `${name}-${theme}.png`), (await win.webContents.capturePage()).toPNG());
      console.log(`shot_saved=${join(dir, `${name}-${theme}.png`)}`);
    }
  };
  await waitFor('.composer', 80);
  await js(`[...document.querySelectorAll('.chan')].find((c) => c.textContent.includes('dev'))?.click()`);
  await sleep(600);
  await js(`(() => { const s = document.createElement('style'); s.textContent = '*{animation-duration:.001s!important;transition-duration:.001s!important}'; document.head.appendChild(s); })()`);
  await sleep(200);
  // dismiss the first-run tour so frames aren't dimmed
  await js(`document.querySelector('.tour-skip') && document.querySelector('.tour-skip').click()`);
  await sleep(400);

  // ── multiline composer (Slice 1): a multi-line draft grows the box
  const setDraft = (v: string) => `(() => { const ta = document.querySelector('.composer textarea'); const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set; set.call(ta, ${JSON.stringify(v)}); ta.dispatchEvent(new Event('input', { bubbles: true })); })()`;
  await js(setDraft('Some context for the team:\n• the composer grows with the message\n• Enter sends, Shift+Enter makes a newline\n• and it scrolls past a few lines'));
  await sleep(300);
  await shoot('attach-multiline', ['dark']);
  await js(setDraft(''));
  await sleep(200);

  // install a canvas→PNG File helper + a staging helper that drives the real file input
  await js("(() => { window.__mkImg = async (label, hue) => { const w=900,h=620,c=document.createElement('canvas'); c.width=w;c.height=h; const x=c.getContext('2d'); const g=x.createLinearGradient(0,0,w,h); g.addColorStop(0,'hsl('+hue+',68%,56%)'); g.addColorStop(1,'hsl('+((hue+50)%360)+',72%,46%)'); x.fillStyle=g; x.fillRect(0,0,w,h); x.fillStyle='rgba(255,255,255,.95)'; x.font='bold 90px Inter, sans-serif'; x.textAlign='center'; x.textBaseline='middle'; x.fillText(label, w/2, h/2); const b=await new Promise(function(r){c.toBlob(r,'image/png');}); return new File([b], label.toLowerCase().replace(/[^a-z0-9]+/g,'-')+'.png', {type:'image/png'}); }; })()");
  await js("(() => { window.__stage = async (filesPromise) => { const files = await filesPromise; const input = document.querySelector('.composer input[type=file]'); const dt = new DataTransfer(); for (const f of files) dt.items.add(f); input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true })); }; })()");

  // ── composer tray: one image + one markdown file (Slice 3 previews + progress)
  await js("window.__stage(Promise.all([ window.__mkImg('Mockup', 20), Promise.resolve(new File(['# NeuraMesh\\nattachment spec\\n'], 'spec.md', {type:'text/markdown'})) ]))");
  await waitFor('.atray .atile', 50);
  await sleep(900);
  await shoot('attach-compose');

  // ── free over-limit → upgrade modal (Slice 3 limits + upgrade path)
  await js("window.__stage(Promise.all([ window.__mkImg('Logo', 130), window.__mkImg('Chart', 210), window.__mkImg('Flow', 290) ]))");
  if (await waitFor('.upmodal', 50)) { await sleep(400); await shoot('attach-upgrade'); await js(`document.querySelector('.overlay')?.click()`); await sleep(300); }
  else console.log('attach_shot WARN no upgrade modal');

  // clear staged → send ONE image to show the feed render (Slice 4)
  await js(`[...document.querySelectorAll('.atray .aremove')].forEach((b) => b.click())`);
  await sleep(300);
  await js("window.__stage(Promise.all([ window.__mkImg('Design', 200) ]))");
  await waitFor('.atray .atile', 50);
  await sleep(900);
  await js(`[...document.querySelectorAll('.composer .row .btn.primary')].find((b) => /send/i.test(b.textContent || ''))?.click()`);
  if (await waitFor('.msg .msgimg', 80)) {
    await sleep(900);
    await shoot('attach-feed');
    await js(`document.querySelector('.msg .msgimg')?.click()`);
    if (await waitFor('.alightbox', 50)) { await sleep(500); await shoot('attach-lightbox', ['dark']); await js(`document.querySelector('.alightboxclose')?.click()`); await sleep(200); }
    else console.log('attach_shot WARN no lightbox');
  } else console.log('attach_shot WARN no msgimg in feed');

  // ── channel artifact screen — "Shared in chat" gallery (Slice 4)
  await js(`[...document.querySelectorAll('.navitem')].find((b) => /library/i.test(b.getAttribute('aria-label') || ''))?.click()`);
  if (await waitFor('.libgallery .libtile', 60)) { await sleep(600); await shoot('attach-library'); }
  else console.log('attach_shot WARN no library gallery');

  app.exit(0);
  return;
}
