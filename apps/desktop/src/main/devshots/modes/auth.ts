// `--shot` modes: clerklogin, signedin, update — extracted from index.ts (track B-devshots).

import { app } from 'electron';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { simulateUpdate } from '../../update';
import type { ShotCtx } from '../driver';
export async function clerklogin({ win, dir, js, sleep }: ShotCtx): Promise<void> {
  // Clerk sign-in screen (NM_AUTH=clerk, no session) — both themes
  await sleep(1500);
  for (const theme of ['dark', 'cream-oak'] as const) {
    await js(`document.documentElement.dataset.theme = '${theme}'`);
    await sleep(350);
    writeFileSync(join(dir, `clerk-login-${theme}.png`), (await win.webContents.capturePage()).toPNG());
    console.log(`shot_saved=${join(dir, `clerk-login-${theme}.png`)} loginshown=${await js(`!!document.querySelector('.loginwrap')`)}`);
  }
  app.exit(0);
  return;
}

    // NM_SHOT_ONLY=signedin: proof of a completed sign-in — the app past the login,
    // on its synced workspace (sidebar channels delivered). Both themes.
export async function signedin({ win, dir, js, sleep }: ShotCtx): Promise<void> {
  // The pill is fed by a 2s status poll, so capturing as soon as channels
  // arrive catches a stale "◌ connecting…" frame even though sync connected.
  // Wait for it to actually read "synced", and log whatever it lands on so
  // the evidence is honest (a real stall would show here, not hide).
  let pill = '';
  for (let i = 0; i < 40; i++) {
    pill = (await js(`Array.from(document.querySelectorAll('.actions .desc')).map(e=>e.textContent||'').find(t=>/synced|offline/.test(t))||''`)) as string;
    if (/synced/.test(pill)) break;
    await sleep(300);
  }
  console.log(`signedin_shot loginshown=${await js(`!!document.querySelector('.loginwrap')`)} ws=${await js(`document.querySelector('.ws b')?.textContent || '?'`)} pill=${JSON.stringify(pill)}`);
  for (const theme of ['dark', 'cream-oak'] as const) {
    await js(`document.documentElement.dataset.theme = '${theme}'`);
    await sleep(350);
    writeFileSync(join(dir, `clerk-signedin-${theme}.png`), (await win.webContents.capturePage()).toPNG());
    console.log(`shot_saved=${join(dir, `clerk-signedin-${theme}.png`)}`);
  }
  app.exit(0);
  return;
}

    // NM_SHOT_ONLY=update: the auto-update card through its lifecycle. No real
    // signed release exists in a shot run, so synthetic main-process state is
    // pushed via simulateUpdate() and the card reacts to the nm:update broadcast.
export async function update({ win, dir, js, sleep, waitFor }: ShotCtx): Promise<void> {
  await waitFor('.navpanel', 80);
  await js(`(() => { const s = document.createElement('style'); s.textContent = '*,*::before,*::after{animation-duration:.001s!important;transition-duration:.001s!important}'; document.head.appendChild(s); })()`);
  for (const phase of ['available', 'downloading', 'ready'] as const) {
    simulateUpdate(phase);
    if (!(await waitFor('.updatecard', 40))) console.log(`update_shot WARN no .updatecard at ${phase}`);
    await sleep(300);
    console.log(`update_shot phase=${phase} card=${await js(`document.querySelector('.updatecard')?.dataset.phase || 'none'`)}`);
    for (const theme of ['dark', 'cream-oak'] as const) {
      await js(`document.documentElement.dataset.theme = '${theme}'`);
      await sleep(300);
      writeFileSync(join(dir, `update-${phase}-${theme}.png`), (await win.webContents.capturePage()).toPNG());
      console.log(`shot_saved=${join(dir, `update-${phase}-${theme}.png`)}`);
    }
  }
  app.exit(0);
  return;
}
