// Run with ego-browser in an existing TaskSpace; use the production-component fixture.
const assert = (await import('node:assert/strict')).default;
const { mkdir, writeFile } = await import('node:fs/promises');
const { resolve } = await import('node:path');
const spaceId = Number(process.env.REVIEW_SPACE_ID);
if (!spaceId) throw new Error('Set REVIEW_SPACE_ID to the existing ego-browser TaskSpace.');
const task = await taskSpace(spaceId);
const page = task.page(process.env.REVIEW_PAGE ?? 'p2');
const evidence = resolve('docs/design/code-review-2026-10/evidence');
await mkdir(evidence, { recursive: true });
await page.goto('http://127.0.0.1:5303/engineering-review.html');
await page.waitForSelector('.fixture-controls');
await page.click('[aria-label="Reset fixture"]');
await page.cdp('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1050, deviceScaleFactor: 1, mobile: false });
await page.click('.fixture-controls button:nth-child(2)');
await page.waitForSelector('[data-work-plan="pane"]');
const read = () => page.evaluate(() => {
  const proposal = document.querySelector('[data-plan-proposal]');
  const overview = proposal.querySelector('[aria-label="Agent plan explanation"]');
  const preview = proposal.querySelector('[data-work-plan="inline"]');
  const point = document.querySelector('[data-work-plan="pane"] .md li');
  return {
    summary: overview.querySelector('.md').textContent,
    points: [...overview.querySelectorAll('[aria-label="Key decisions"] > li')].map(e => e.textContent),
    nextStep: overview.querySelector('[aria-label="Next step"]').textContent,
    overviewBeforeCard: overview.getBoundingClientRect().bottom <= preview.getBoundingClientRect().top,
    previewHeight: preview.getBoundingClientRect().height,
    preview: preview.textContent,
    paneText: document.querySelector('[data-work-plan="pane"]').textContent,
    paneSteps: document.querySelectorAll('[data-work-plan="pane"] ol[aria-label="Work plan steps"] > li').length,
    paneBulletDisplay: getComputedStyle(point).display,
    paneBulletWidth: point.getBoundingClientRect().width,
  };
});
const before = await read();
assert.match(before.summary, /^I reviewed the greeting module and its tests/);
assert.doesNotMatch(before.paneText, /I reviewed|I would|Select Continue/);
assert.match(before.paneText, /Add a welcome greeting that follows/);
assert.equal(before.points.length, 3);
assert.match(before.points.join(' '), /run the full suite/);
assert.match(before.nextStep, /no files have changed.*Continue in Act/);
assert.equal(before.overviewBeforeCard, true);
assert.ok(before.previewHeight < 230);
assert.match(before.preview, /Preview.*Open plan/);
assert.doesNotMatch(before.preview, /HTTP endpoint/);
assert.equal(before.paneSteps, 4);
assert.equal(before.paneBulletDisplay, 'list-item');
assert.ok(before.paneBulletWidth > 300, 'overview bullets must not inherit the 26px step-marker grid');
await page.screenshot({ path: `${evidence}/plan-report-fixture-dark.png` });
await page.click('[aria-label="Close review panel"]');
await page.focus('[data-work-plan="inline"] button');
await page.keyboard.press('Enter');
await page.waitForSelector('[data-work-plan="pane"]');
await page.click('.review-fixture > header button:last-child');
await page.waitForFunction(() => document.documentElement.dataset.theme === 'light' && !document.documentElement.hasAttribute('data-theme-switch'));
await page.screenshot({ path: `${evidence}/plan-report-fixture-light.png` });
await page.click('[aria-label="Continue in Act mode"] button:first-of-type');
assert.equal(await page.evaluate(() => !!document.querySelector('[aria-label="Continue in Act mode"]')), false);
assert.equal((await read()).points.length, 3);
await page.reload();
await page.waitForSelector('[data-plan-proposal]');
await page.click('[data-work-plan="inline"] button');
await page.waitForSelector('[data-work-plan="pane"]');
const restored = await read();
assert.deepEqual(restored.points, before.points);
assert.equal(restored.nextStep, before.nextStep);
await page.cdp('Emulation.setDeviceMetricsOverride', { width: 760, height: 1000, deviceScaleFactor: 1, mobile: false });
assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
assert.ok((await read()).previewHeight < 230);
await page.click('[aria-label="Close review panel"]');
await page.screenshot({ path: `${evidence}/plan-report-fixture-narrow.png` });
const result = { passed: true, checks: ['report describes completed investigation', 'decisions explain rationale and verification', 'next step is explicit', 'formal plan does not repeat the report', 'overview precedes compact clickable card', 'full pane retains all steps', 'pane prose uses readable bullet layout', 'keyboard opens full plan', 'light and dark themes', 'Keep planning preserves overview', 'reload preserves report and next step', 'narrow viewport fits without horizontal overflow'] };
await writeFile(`${evidence}/plan-report-browser-checks.json`, JSON.stringify(result, null, 2));
console.log(result);
