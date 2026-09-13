// `--shot` modes: remoteagent, agentcard, runtime, repolink — extracted from index.ts (track B-devshots).

import { app } from 'electron';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ShotCtx } from '../driver';
    // NM_SHOT_ONLY=remoteagent: a remote (external A2A) agent in the roster with
    // its REMOTE badge + the "Add external agent" connect modal.
export async function remoteagent({ win, dir, js, sleep, waitFor }: ShotCtx): Promise<void> {
  await waitFor('.navitem', 80);
  await js(`[...document.querySelectorAll('.navitem')].find((n) => /Agents/.test(n.textContent))?.click()`);
  await sleep(600);
  await js(`(() => { const s = document.createElement('style'); s.textContent = '*,*::before,*::after{animation-duration:.001s!important;transition-duration:.001s!important}'; document.head.appendChild(s); })()`);
  await waitFor('.agentcard', 60);
  console.log(`remoteagent_shot remote_present=${await js(`document.querySelectorAll('.rmchip').length`)}`);
  for (const theme of ['dark', 'light'] as const) {
    await js(`document.documentElement.dataset.theme = '${theme}'`);
    await sleep(350);
    writeFileSync(join(dir, `remoteagent-roster-${theme}.png`), (await win.webContents.capturePage()).toPNG());
    console.log(`shot_saved=${join(dir, `remoteagent-roster-${theme}.png`)}`);
  }
  // the Add-external-agent modal, filled with a card URL
  await js(`[...document.querySelectorAll('.btn')].find((b) => /External agent/.test(b.textContent))?.click()`);
  if (await waitFor('.modal .fld input', 40)) {
    await js(`(() => { const i = document.querySelector('.modal .fld input'); if (i) { Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(i, 'https://acme-agents.example.com/.well-known/a2a/agent-card.json'); i.dispatchEvent(new Event('input', { bubbles: true })); } })()`);
    await sleep(300);
    for (const theme of ['dark', 'light'] as const) {
      await js(`document.documentElement.dataset.theme = '${theme}'`);
      await sleep(350);
      writeFileSync(join(dir, `remoteagent-modal-${theme}.png`), (await win.webContents.capturePage()).toPNG());
      console.log(`shot_saved=${join(dir, `remoteagent-modal-${theme}.png`)}`);
    }
  }
  app.exit(0);
  return;
}

    // NM_SHOT_ONLY=agentcard: an agent's details with its A2A 1.0 Agent Card
    // revealed (the discovery surface) + the copyable well-known URL.
export async function agentcard({ win, dir, js, sleep, waitFor }: ShotCtx): Promise<void> {
  await waitFor('.navitem', 80);
  await js(`[...document.querySelectorAll('.navitem')].find((n) => /Agents/.test(n.textContent))?.click()`);
  await sleep(600);
  await js(`(() => { const s = document.createElement('style'); s.textContent = '*,*::before,*::after{animation-duration:.001s!important;transition-duration:.001s!important}'; document.head.appendChild(s); })()`);
  if (!(await waitFor('.agentcard', 60))) console.log('agentcard_shot WARN no .agentcard in roster');
  // open the orchestrator's details if present, else the first agent
  await js(`(() => { const cards = [...document.querySelectorAll('.agentcard')]; (cards.find((c) => /orch/i.test(c.textContent)) || cards[0])?.click(); })()`);
  if (!(await waitFor('.modal .btn', 40))) console.log('agentcard_shot WARN no detail modal');
  await sleep(400);
  await js(`[...document.querySelectorAll('.modal .btn')].find((b) => /Show card JSON/.test(b.textContent))?.click()`);
  if (!(await waitFor('.cardjson', 30))) console.log('agentcard_shot WARN card JSON not shown');
  await sleep(400);
  console.log(`agentcard_shot has_card=${await js(`!!document.querySelector('.cardjson')`)}`);
  for (const theme of ['dark', 'light'] as const) {
    await js(`document.documentElement.dataset.theme = '${theme}'`);
    await sleep(350);
    writeFileSync(join(dir, `agentcard-${theme}.png`), (await win.webContents.capturePage()).toPNG());
    console.log(`shot_saved=${join(dir, `agentcard-${theme}.png`)}`);
  }
  app.exit(0);
  return;
}

    // NM_SHOT_ONLY=runtime: the agent-create modal's Runtime picker (Claude /
    // Codex / Gemini) — the A2A multi-runtime seam, with Codex selected so the
    // model + provider-key label follow.
export async function runtime({ win, dir, js, sleep, waitFor }: ShotCtx): Promise<void> {
  await waitFor('.navitem', 80);
  await js(`[...document.querySelectorAll('.navitem')].find((n) => /Agents/.test(n.textContent))?.click()`);
  await sleep(500);
  await js(`(() => { const s = document.createElement('style'); s.textContent = '*,*::before,*::after{animation-duration:.001s!important;transition-duration:.001s!important}'; document.head.appendChild(s); })()`);
  for (let i = 0; i < 12; i++) {
    await js(`[...document.querySelectorAll('.btn')].find((b) => /Create agent/.test(b.textContent))?.click()`);
    await sleep(350);
    if (await js(`!!document.querySelector('.modal .fld select')`)) break;
  }
  if (!(await waitFor('.modal .fld select', 40))) console.log('runtime_shot WARN no create-agent modal');
  await js(`(() => { const i = document.querySelector('.modal .fld input'); if (i) { Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(i, 'gpt-dev'); i.dispatchEvent(new Event('input', { bubbles: true })); } })()`);
  // the Runtime <select> is the one whose options include "Codex" — set it to codex
  await js(`(() => { const rt = [...document.querySelectorAll('.modal .fld select')].find((s) => [...s.options].some((o) => /Codex/.test(o.textContent))); if (rt) { Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(rt, 'codex'); rt.dispatchEvent(new Event('change', { bubbles: true })); } })()`);
  await sleep(400);
  console.log(`runtime_shot codex_selected=${await js(`[...document.querySelectorAll('.modal .fld select')].some((s) => s.value === 'codex')`)}`);
  for (const theme of ['dark', 'light'] as const) {
    await js(`document.documentElement.dataset.theme = '${theme}'`);
    await sleep(350);
    writeFileSync(join(dir, `runtime-picker-${theme}.png`), (await win.webContents.capturePage()).toPNG());
    console.log(`shot_saved=${join(dir, `runtime-picker-${theme}.png`)}`);
  }
  app.exit(0);
  return;
}

    // NM_SHOT_ONLY=repolink: registering a GitHub repo to the workspace — the
    // Add-repository modal (board "+ repo") + the workspace-settings Repositories
    // list after it lands. Themes are CSS-driven; this captures both.
export async function repolink({ win, dir, js, sleep, waitFor }: ShotCtx): Promise<void> {
  await waitFor('.chan', 100);
  for (let i = 0; i < 16; i++) {
    await js(`[...document.querySelectorAll('.chan')].find((c) => c.textContent.trim() === '# dev')?.click()`);
    await sleep(400);
    if (await js(`/#\\s*dev/.test(document.querySelector('.topbar')?.textContent ?? '')`)) break;
  }
  // open the Board view so the create-task row (with "+ repo") is present
  for (let i = 0; i < 12; i++) {
    await js(`[...document.querySelectorAll('.viewtog button')].find((b) => b.textContent.trim().startsWith('Board'))?.click()`);
    await sleep(350);
    if (await js(`!!document.querySelector('.newtask')`)) break;
  }
  await js(`(() => { const s = document.createElement('style'); s.textContent = '*,*::before,*::after{animation-duration:.001s!important;transition-duration:.001s!important}'; document.head.appendChild(s); })()`);
  // 1) the Add-repository modal, filled with a sample GitHub URL
  await js(`[...document.querySelectorAll('.newtask .btn')].find((b) => /\\+\\s*repo/.test(b.textContent))?.click()`);
  if (!(await waitFor('.modal .fld input', 60))) console.log('repolink_shot WARN no add-repo modal');
  await js(`(() => { const i = document.querySelector('.modal .fld input'); if (i) { Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(i, 'https://github.com/galonge/nmesh-static'); i.dispatchEvent(new Event('input', { bubbles: true })); } })()`);
  await sleep(300);
  for (const theme of ['dark', 'light'] as const) {
    await js(`document.documentElement.dataset.theme = '${theme}'`);
    await sleep(350);
    writeFileSync(join(dir, `repolink-modal-${theme}.png`), (await win.webContents.capturePage()).toPNG());
    console.log(`shot_saved=${join(dir, `repolink-modal-${theme}.png`)}`);
  }
  // 2) submit it, wait for it to register + sync, then open workspace settings —
  //    the Repositories section now lists the registered repo
  await js(`[...document.querySelectorAll('.modal .btn.primary')].find((b) => /Add repository/.test(b.textContent))?.click()`);
  for (let i = 0; i < 24; i++) {
    if (await js(`[...document.querySelectorAll('.newtask option')].some((o) => /nmesh-static/.test(o.textContent))`)) break;
    await sleep(300);
  }
  console.log(`repolink_shot registered=${await js(`[...document.querySelectorAll('.newtask option')].some((o) => /nmesh-static/.test(o.textContent))`)}`);
  await js(`[...document.querySelectorAll('.topbar .btn')].find((b) => /workspace settings/i.test(b.title || ''))?.click()`);
  if (!(await waitFor('.modal', 40))) console.log('repolink_shot WARN no settings modal');
  await sleep(400);
  await js(`[...document.querySelectorAll('.modal .sect')].find((s) => /Repositories/.test(s.textContent))?.scrollIntoView({ block: 'center' })`);
  await sleep(400);
  for (const theme of ['dark', 'light'] as const) {
    await js(`document.documentElement.dataset.theme = '${theme}'`);
    await sleep(350);
    writeFileSync(join(dir, `repolink-settings-${theme}.png`), (await win.webContents.capturePage()).toPNG());
    console.log(`shot_saved=${join(dir, `repolink-settings-${theme}.png`)}`);
  }
  app.exit(0);
  return;
}
