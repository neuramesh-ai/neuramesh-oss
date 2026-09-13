// `--shot` modes: createagent — extracted from index.ts (track B-devshots).

import { app } from 'electron';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ShotCtx } from '../driver';
    // NM_SHOT_ONLY=createagent: the Create-agent modal with the architect role
    // selected + the searchable channel multi-select open.
export async function createagent({ win, dir, js, sleep, waitFor }: ShotCtx): Promise<void> {
  await waitFor('.navitem', 100);
  await js(`[...document.querySelectorAll('.navitem')].find(n => n.textContent.includes('Agents'))?.click()`);
  await sleep(400);
  await js(`[...document.querySelectorAll('.btn')].find(b => /Create agent/.test(b.textContent))?.click()`);
  if (!(await waitFor('.rselbtn', 30))) console.log('createagent_shot WARN no modal');
  // open the rich role dropdown — the names + purpose subtext are the point
  await js(`document.querySelector('.rselbtn')?.click()`);
  if (!(await waitFor('.rseldrop', 20))) console.log('createagent_shot WARN no role dropdown');
  await sleep(300);
  for (const theme of ['dark', 'light'] as const) {
    await js(`document.documentElement.dataset.theme = '${theme}'`);
    await sleep(350);
    const img = await win.webContents.capturePage();
    writeFileSync(join(dir, `create-agent-${theme}.png`), img.toPNG());
    console.log(`shot_saved=${join(dir, `create-agent-${theme}.png`)}`);
  }
  app.exit(0);
  return;
}
