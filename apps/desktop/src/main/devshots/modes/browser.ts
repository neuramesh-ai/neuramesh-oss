// `--shot` modes: browser, stream, unread, logs — extracted from index.ts (track B-devshots).

import { app } from 'electron';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ShotCtx } from '../driver';
    // NM_SHOT_ONLY=browser: the dock mini-browser (docs/21) — a REAL <webview> guest
    // rendering a page from a local demo server (deterministic, offline-safe), the
    // icon dockbar, the URL bar + 3-way mode segment; plus the blank-tab empty state.
    // Logs verify the enforced bits the pixels can't: guest URL, allowpopups reaching
    // the tag, and the page title flowing into the dock tab.
export async function browser({ win, dir, js, sleep, waitFor }: ShotCtx): Promise<void> {
  const { createServer } = await import('node:http');
  const demo = createServer((_req, res) => {
    res.setHeader('content-type', 'text/html');
    res.end(`<!doctype html><meta charset="utf-8"><title>Mini-browser demo</title>
<style>body{font:15px/1.65 -apple-system,BlinkMacSystemFont,sans-serif;margin:0;display:grid;place-items:center;min-height:100vh;background:#f6f2e9;color:#2b2620}main{max-width:540px;padding:40px}h1{font-size:27px;margin:0 0 10px}p{color:#6b6357}code{background:#eae4d6;padding:2px 6px;border-radius:6px}a{color:#8a5a2c}</style>
<main><h1>Served from 127.0.0.1</h1><p>This page renders inside NeuraMesh's dock mini-browser — a real Chromium <code>&lt;webview&gt;</code> guest with enforced caps: http(s) only, no preload, popups stay in the pane.</p><p><a href="/two">a same-origin link</a></p></main>`);
  });
  await new Promise<void>((r) => demo.listen(0, '127.0.0.1', () => r()));
  const port = (demo.address() as { port: number }).port;
  // NM_SHOT_URL: prove an arbitrary (e.g. public) site loads in the guest — sites that
  // refuse IFRAMING (X-Frame-Options) still render here, because a webview is top-level
  // browsing, not a frame. Saves browser-external-*.png and skips the local-page extras.
  const external = process.env['NM_SHOT_URL'];
  const target = external || `http://127.0.0.1:${port}/`;
  await waitFor('.dockbar');
  await js(`(() => { const s = document.createElement('style'); s.textContent = '*,*::before,*::after{animation-duration:.001s!important;transition-duration:.001s!important}'; document.head.appendChild(s); })()`);
  await js(`document.querySelector('.dockbarbtn[aria-label="Browser"]')?.click()`);
  if (!(await waitFor('.bwurl', 40))) console.log('browser_shot WARN no .bwurl');
  await js(`(() => {
    const inp = document.querySelector('.bwurl');
    if (!inp) return;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(inp, ${JSON.stringify(target)});
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  })()`);
  if (!(await waitFor('webview.bwview', 40))) console.log('browser_shot WARN no webview');
  await sleep(external ? 3500 : 1800); // guest attach + paint (public sites need real network time)
  console.log(`browser_shot guest_url=${await js(`document.querySelector('webview.bwview')?.getURL?.() ?? null`)} allowpopups=${await js(`document.querySelector('webview.bwview')?.hasAttribute('allowpopups')`)} tab_title=${JSON.stringify(await js(`document.querySelector('.docktab.on .docktabtitle')?.textContent ?? null`))}`);
  const prefix = external ? 'browser-external' : 'browser';
  for (const theme of ['dark', 'cream-oak'] as const) {
    await js(`document.documentElement.dataset.theme = '${theme}'`);
    await sleep(350);
    writeFileSync(join(dir, `${prefix}-${theme}.png`), (await win.webContents.capturePage()).toPNG());
    console.log(`shot_saved=${join(dir, `${prefix}-${theme}.png`)}`);
  }
  if (!external) {
    // the blank tab's empty state — folder / terminal / browser, the third action visible
    await js(`document.querySelector('.docktabadd')?.click()`);
    if (!(await waitFor('.cwemptybtns', 40))) console.log('browser_shot WARN no empty state');
    await sleep(300);
    for (const theme of ['dark', 'cream-oak'] as const) {
      await js(`document.documentElement.dataset.theme = '${theme}'`);
      await sleep(350);
      writeFileSync(join(dir, `browser-newtab-${theme}.png`), (await win.webContents.capturePage()).toPNG());
      console.log(`shot_saved=${join(dir, `browser-newtab-${theme}.png`)}`);
    }
    // popup-policy probe: window.open from the guest must navigate the SAME pane
    // (guard routes it via setWindowOpenHandler) — the log line is the assertion
    await js(`document.querySelector('webview.bwview')?.executeJavaScript('window.open("/two"); true')`);
    await sleep(900);
    console.log(`browser_shot popup_probe guest_url=${await js(`document.querySelector('webview.bwview')?.getURL?.() ?? null`)} allowpopups=${await js(`document.querySelector('webview.bwview')?.hasAttribute('allowpopups')`)}`);
  }
  demo.close();
  app.exit(0);
  return;
}

    // NM_SHOT_ONLY=stream: prove the live token-stream bubble in both themes.
    // A real stream needs a live agent + API key; here we feed the renderer a
    // synthetic nm:agent-stream for the open conversation's key — the exact
    // payload shape wake()/wakeThread() emit — so the StreamBubble path is real.
export async function stream({ win, dir, js, sleep, waitFor }: ShotCtx): Promise<void> {
  const sample = 'On it — wiring the **handler** now. Plan:\n\n1. validate the payload\n2. enforce the FSM transition\n3. emit the event\n\nBack with a diff shortly.';
  await waitFor('.chan', 100); // channels must sync before one can be opened
  await js(`([...document.querySelectorAll('.chan')].find(c => /dev|general/.test(c.textContent)) ?? document.querySelector('.chan'))?.click()`);
  await js(`document.querySelector('.viewtog button:nth-child(1)')?.click()`);
  await waitFor('.msgs');
  // the live-bubble key is the OPEN channel's id — poll until it's set
  let chatKey = '';
  for (let i = 0; i < 40 && !chatKey; i++) {
    chatKey = await js(`document.querySelector('.msgs')?.dataset.streamkey || ''`);
    if (!chatKey) await sleep(300);
  }
  console.log(`stream_shot chatKey=${chatKey}`);
  win.webContents.send('nm:agent-stream', { key: chatKey, agent: 'rex', text: sample, done: false });
  if (!(await waitFor('.msg.streaming', 20))) console.log('stream_shot WARN no .msg.streaming');
  await sleep(400);
  for (const theme of ['dark', 'light'] as const) {
    await js(`document.documentElement.dataset.theme = '${theme}'`);
    await sleep(350);
    const img = await win.webContents.capturePage();
    writeFileSync(join(dir, `stream-chat-${theme}.png`), img.toPNG());
    console.log(`shot_saved=${join(dir, `stream-chat-${theme}.png`)}`);
  }
  app.exit(0);
  return;
}

    // NM_SHOT_ONLY=unread: the Tasks board with thread-unread affordances.
    // A fresh shot profile has an empty last-read map, so every task carrying
    // thread activity reads as unread — exactly the dots/tints we're proving.
export async function unread({ win, dir, js, sleep, waitFor }: ShotCtx): Promise<void> {
  await waitFor('.navitem', 100);
  await js(`[...document.querySelectorAll('.navitem')].find(n => n.textContent.includes('Tasks'))?.click()`);
  await waitFor('.tcard', 60);
  // the latest-threads poll lands a beat after thread messages sync — wait
  // for the first unread tint rather than a fixed sleep (else dots are empty)
  if (!(await waitFor('.unreadcard', 40))) console.log('unread_shot WARN no .unreadcard');
  await sleep(400);
  for (const theme of ['dark', 'light'] as const) {
    await js(`document.documentElement.dataset.theme = '${theme}'`);
    await sleep(350);
    const img = await win.webContents.capturePage();
    writeFileSync(join(dir, `unread-board-${theme}.png`), img.toPNG());
    console.log(`shot_saved=${join(dir, `unread-board-${theme}.png`)}`);
  }
  app.exit(0);
  return;
}

    // NM_SHOT_ONLY=logs: Agent Logs polish — deep-link from a task + token/cost
    // + export. Seeds token-bearing rows (claude-mode usage; echo logs none),
    // then proves the deep-link by clicking the full-view's ☰ Logs button.
export async function logs({ win, dir, js, sleep, waitFor }: ShotCtx): Promise<void> {
  // wait for synced data first — that guarantees startSync registered its
  // ipc handlers (incl. the seed) before we call one (else it races + fails)
  await waitFor('.navitem', 100);
  await js(`[...document.querySelectorAll('.navitem')].find(n => n.textContent.includes('Tasks'))?.click()`);
  await waitFor('.tcard', 60);
  await js(`window.nm?.debugSeedLogs?.().catch(() => {})`); // never let a seed hiccup abort the shot
  await sleep(300);
  await js(`[...document.querySelectorAll('.tcard')].find(c => c.textContent.includes('#1004'))?.click()`);
  await waitFor('.tfbar');
  await js(`[...document.querySelectorAll('.tfbar .btn')].find(b => /Logs/.test(b.textContent))?.click()`);
  if (!(await waitFor('.taskfilter', 40))) console.log('logs_shot WARN no .taskfilter');
  if (!(await waitFor('.logtok', 20))) console.log('logs_shot WARN no .logtok');
  await sleep(400);
  for (const theme of ['dark', 'light'] as const) {
    await js(`document.documentElement.dataset.theme = '${theme}'`);
    await sleep(350);
    const img = await win.webContents.capturePage();
    writeFileSync(join(dir, `logs-task-${theme}.png`), img.toPNG());
    console.log(`shot_saved=${join(dir, `logs-task-${theme}.png`)}`);
  }
  app.exit(0);
  return;
}
