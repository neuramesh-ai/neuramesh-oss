// The `--shot=<dir>` evidence harness (docs/12, docs/13, docs/21).
//
// Dev-only: 30 scripted capture modes, one per NM_SHOT_ONLY value. It lived inside the
// Electron entry as a single 1,500-line function, which meant it was also STATICALLY
// imported into every shipped build. index.ts now imports it lazily at its one call site,
// so a signed release never carries it.
//
// A registry, not a run of 30 ifs: an unknown mode is now named in the log instead of
// falling through every branch to a silent exit.
import { app } from 'electron';
import type { BrowserWindow } from 'electron';
import { mkdirSync } from 'node:fs';
import type { ShotCtx } from './driver';
import * as auth from './modes/auth';
import * as browser from './modes/browser';
import * as mission from './modes/mission';
import * as skills from './modes/skills';
import * as workspace from './modes/workspace';
import * as agents from './modes/agents';
import * as lessons from './modes/lessons';
import * as task from './modes/task';
import * as validate from './modes/validate';
import * as createagent from './modes/createagent';

const MODES: Record<string, (c: ShotCtx) => Promise<void>> = {
  ...auth,
  ...browser,
  ...mission,
  ...skills,
  ...workspace,
  ...agents,
  ...lessons,
  ...task,
  ...validate,
  ...createagent,
};

export async function captureShots(win: BrowserWindow, dir: string): Promise<void> {
  mkdirSync(dir, { recursive: true });
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (selector: string, tries = 60) => {
    for (let i = 0; i < tries; i++) {
      if (await js(`!!document.querySelector('${selector}')`)) return true;
      await sleep(300);
    }
    console.log(`shot_wait_timeout selector=${selector}`);
    return false;
  };
  try {
    // Shot runs use a FRESH userData profile, which triggers the first-run tour —
    // its overlay swallows every click the harness makes (the skillpacks shot's
    // "packs=0" failure). Dismiss it up front: set the toured flag and click
    // Skip if the overlay already mounted. Applies to every NM_SHOT_ONLY mode.
    await sleep(600);
    await js(`(() => { try { localStorage.setItem('nm:toured', '1'); } catch {} document.querySelector('.tour-skip')?.click(); })()`);
    const only = process.env['NM_SHOT_ONLY'] ?? '';
    const mode = MODES[only];
    // Exit 0 on an unknown/absent mode, as the fall-through always did — but SAY so:
    // a typo used to exit silently green, which is the evidence-harness version of an
    // audit that cannot fail.
    if (!mode) {
      console.log(`shot_no_mode NM_SHOT_ONLY=${JSON.stringify(only)} known=${Object.keys(MODES).length}`);
      app.exit(0);
      return;
    }
    await mode({ win, dir, js, sleep, waitFor });
    app.exit(0);
  } catch (err) {
    console.error('SHOT=FAIL', err);
    app.exit(1);
  }
}
