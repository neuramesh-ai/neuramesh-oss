// Inspect the completed real QA thread; this script sends no agent messages.
const assert = (await import('node:assert/strict')).default;
const { writeFile } = await import('node:fs/promises');
const { resolve } = await import('node:path');
const task = await taskSpace(Number(process.env.REVIEW_SPACE_ID));
const page = task.page(process.env.REVIEW_PAGE ?? 'p1');
const threadId = process.env.REVIEW_THREAD_ID;
if (!threadId) throw new Error('Set REVIEW_THREAD_ID to the completed live QA thread.');
const evidence = resolve('docs/design/code-review-2026-10/evidence');
const read = () => page.evaluate(() => [...document.querySelectorAll('[data-plan-proposal]')].map(e => ({
  investigation: e.querySelector('[aria-label="Agent plan explanation"] .md')?.textContent ?? null,
  decisions: [...e.querySelectorAll('[aria-label="Key decisions"] > li')].map(x => x.textContent),
  nextStep: e.querySelector('[aria-label="Next step"]')?.textContent ?? null,
  card: e.querySelector('[data-work-plan="inline"]')?.textContent,
})));
const open = async (index) => {
  await page.evaluate(i => document.querySelectorAll('[data-work-plan="inline"] button')[i]?.scrollIntoView({ block: 'center' }), index);
  await page.click(`[data-work-plan="inline"] button >> nth=${index}`);
  await page.waitForSelector('[data-work-plan="pane"]');
  return page.evaluate(() => document.querySelector('[data-work-plan="pane"]').textContent);
};
await page.goto(`http://127.0.0.1:5302/acme/c/${threadId}?db=brain-device-a`);
await page.waitForSelector('[aria-label="Agent plan explanation"]');
const saved = await read();
assert.ok(saved.at(-1).decisions.length >= 1);
assert.match(saved.at(-1).decisions.join(' '), /test|verif/i);
assert.match(saved.at(-1).nextStep, /Act|implement/);
assert.ok(saved.at(-1).investigation.length > 20);
const earlier = await open(saved.length - 2);
assert.match(earlier, /Earlier work plan/);
const current = await open(saved.length - 1);
assert.ok(!current.includes(saved.at(-1).investigation), 'the pane must not repeat the conversation report');
assert.ok(!current.includes(saved.at(-1).nextStep));
assert.ok(current.includes('node --test'));
assert.ok(await page.evaluate(() => document.querySelectorAll('[data-work-plan="pane"] ol[aria-label="Work plan steps"] > li').length >= 3));
assert.equal(await page.evaluate(() => document.querySelectorAll('[data-change-review]').length), 0, 'the plan turns did not edit files');
await page.reload();
await page.waitForSelector('[aria-label="Agent plan explanation"]');
assert.deepEqual(await read(), saved);
await open(saved.length - 1);
await page.cdp('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1250, deviceScaleFactor: 1, mobile: false });
if (await page.evaluate(() => !!document.querySelector('[aria-label="Hide the sidebar"]'))) await page.click('[aria-label="Hide the sidebar"]');
await page.evaluate(() => {
  const list = document.querySelector('.codingthread .tmsgs');
  const proposal = [...document.querySelectorAll('[data-plan-proposal]')].at(-1);
  list.scrollTop += proposal.getBoundingClientRect().top - list.getBoundingClientRect().top - 55;
});
await page.screenshot({ path: `${evidence}/plan-report-real-dark.png` });
const result = { passed: true, threadId, model: 'GPT-5.6 Sol', plans: saved, checks: ['real agent explains investigation and decisions with verification', 'next step is explicit', 'earlier plan is still accessible', 'formal plan excludes the conversation report', 'latest card includes the implementation and test steps', 'no additional file edit batches', 'refresh preserves explanation and plan history'] };
await writeFile(`${evidence}/plan-report-real-checks.json`, JSON.stringify(result, null, 2));
console.log({ passed: result.passed, checks: result.checks, plans: saved.length });
