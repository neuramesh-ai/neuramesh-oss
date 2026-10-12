// Run through ego-browser in an existing QA TaskSpace with a disposable coding thread open.
// This uses the real API and sends one text-only agent prompt. It does not approve work.
const assert = (await import('node:assert/strict')).default;
const { mkdir, writeFile } = await import('node:fs/promises');
const { resolve } = await import('node:path');
const spaceId = Number(process.env.REVIEW_SPACE_ID);
const threadId = process.env.REVIEW_THREAD_ID;
if (!spaceId || !threadId) throw new Error('Set REVIEW_SPACE_ID and REVIEW_THREAD_ID for the QA thread.');
const p = (await taskSpace(spaceId)).page('p1');
const evidence = resolve('docs/design/code-review-2026-10/evidence');
await mkdir(evidence, { recursive: true });
const row = `[data-thread-id="${threadId}"]`;
const inGroup = (group) => `[data-recent-group="${group}"] ${row}`;
const composer = 'textarea[placeholder="Describe what to investigate or plan · ↵ send"]';
const checks = [];
// Restore the test's starting condition through the real bridge, not a local storage mock.
await p.evaluate((id) => window.nm.threadUnsettle(id), threadId);
await p.waitForSelector(inGroup('idle'));
await p.hover(row, { label: 'Reveal thread actions' });
assert.notEqual(await p.evaluate((s) => getComputedStyle(document.querySelector(`${s} .navhistact`)).display, row), 'none');
assert.equal(await p.evaluate((s) => document.querySelector(`${s} .nhsettle`).textContent, row), 'Settle');
assert.equal(await p.evaluate((s) => document.querySelector(`${s} .navhisttitle`).getBoundingClientRect().right > document.querySelector(`${s} .navhistact`).getBoundingClientRect().left, row), false);
await p.screenshot({ path: `${evidence}/settle-label-dark.png` });
checks.push('Settle has a visible text label', 'long title does not overlap the action');
await p.click(`${row} .nhsettle`, { label: 'Settle the QA thread' });
await p.waitForSelector(inGroup('settled'));
await p.click('.nmtoastundo', { label: 'Undo the settle' });
await p.waitForSelector(inGroup('idle'));
checks.push('hover Settle moves Idle to Settled', 'Undo restores Idle');
// The same action remains available through the row menu.
await p.hover(row, { label: 'Open thread actions' });
await p.click(`${row} button[aria-label="More"]`, { label: 'Open thread menu' });
await p.click('loc=role:menuitem[name="Settle"]', { label: 'Settle from the menu' });
await p.waitForSelector(inGroup('settled'));
assert.equal(await p.evaluate((s) => !!document.querySelector(`${s} .nhsettle`), row), false);
await p.reload();
await p.waitForSelector(inGroup('settled'));
await p.click(`${row} .navhistrow`, { label: 'View settled conversation' });
await p.waitForSelector(composer);
// Wait for the host's reconnect write as well as the browser render.
await p.evaluate((id) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => { off?.(); reject(new Error('No code-session reconnect')); }, 15000);
  let off;
  off = window.nm.watchCodeSessions((rows) => {
    const session = rows.find((r) => r.id === id);
    if (session && ['idle', 'resumable', 'completed'].includes(session.state) && !session.ended_at) {
      clearTimeout(timer); queueMicrotask(() => off?.()); resolve(true);
    }
  });
}), threadId);
await p.waitForSelector(inGroup('settled'));
checks.push('menu Settle works', 'settle survives reload and a runtime reconnect', 'settled row has no redundant action');
if (await p.evaluate(() => document.querySelector('[aria-label="Side panel"]')?.getAttribute('aria-pressed') === 'true')) {
  await p.click('[aria-label="Fold the side panel"]', { label: 'Focus the conversation' });
}
await p.hover('.codingthread .thead', { label: 'Show settled thread state' });
await p.screenshot({ path: `${evidence}/recents-settled-dark.png` });
const answer = 'Recents settle lifecycle verified.';
await p.fill(composer, `Reply with exactly: ${answer} Do not use tools, change files, propose a plan, or run commands.`);
await p.press(composer, 'Enter');
await p.waitForSelector(inGroup('working'));
assert.equal(await p.evaluate((s) => !!document.querySelector(`${s} .nhsettle`), row), false);
await p.screenshot({ path: `${evidence}/recents-working-dark.png` });
await p.waitForFunction((text) => [...document.querySelectorAll('.codingthread .md p')].some((p) => p.textContent === text), answer, { timeout: 60000 });
await p.waitForSelector(inGroup('idle'));
checks.push('real prompt moves Settled to Working', 'running agent has no settle control', 'real reply returns the thread to Idle');
// Keyboard access uses the same visible control.
await p.focus(`${row} .navhistrow`);
await p.press(`${row} .navhistrow`, 'Tab');
assert.equal(await p.evaluate(() => document.activeElement?.classList.contains('nhsettle')), true);
await p.keyboard.press('Enter');
await p.waitForSelector(inGroup('settled'));
checks.push('keyboard Settle works');
await p.click('[data-recent-group="settled"] > button');
assert.equal(await p.evaluate((s) => !!document.querySelector(s), row), false);
await p.click('[data-recent-group="settled"] > button');
await p.waitForSelector(inGroup('settled'));
checks.push('section collapse and reopen preserve the selected conversation');
await p.hover('.codingthread .thead', { label: 'Show completed verification' });
await p.screenshot({ path: `${evidence}/recents-complete-dark.png` });
await writeFile(`${evidence}/settle-label-browser-checks.json`, JSON.stringify({ passed: true, threadId, checks }, null, 2));
console.log({ passed: true, checks });
