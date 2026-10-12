// Run through ego-browser in an existing QA TaskSpace with Appearance open over a plan thread.
const assert = (await import('node:assert/strict')).default;
const { mkdir, writeFile } = await import('node:fs/promises');
const { resolve } = await import('node:path');
const task = await taskSpace(Number(process.env.REVIEW_SPACE_ID));
const page = task.page('p1');
const evidence = resolve('docs/design/code-review-2026-10/evidence');
await mkdir(evidence, { recursive: true });
await page.waitForSelector('.themecard');
await page.evaluate(() => {
  window.__themeContrast = { frames: [], count: 0 };
  const sample = () => {
    const rows = [...document.querySelectorAll('.engmodegateactions .btn, [data-work-plan="inline"] button, .modal .btn')].map((b) => {
      const s = getComputedStyle(b);
      return { label: b.textContent.trim(), foreground: s.color, background: s.backgroundColor };
    });
    window.__themeContrast.frames.push({ theme: document.documentElement.dataset.theme, rows });
  };
  new MutationObserver(() => {
    sample();
    let frames = 0;
    const next = () => { sample(); if (++frames < 12) requestAnimationFrame(next); else window.__themeContrast.count++; };
    requestAnimationFrame(next);
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
});
const startingTheme = await page.evaluate(() => document.documentElement.dataset.theme);
const sequence = [['light', 4], ['soft-dark', 3], ['cream-oak', 5], ['dark', 2]];
let changes = 0;
for (const [theme, child] of sequence) {
  if (await page.evaluate(() => document.documentElement.dataset.theme) === theme) continue;
  await page.click(`.themecard:nth-child(${child})`);
  await page.waitForFunction((count) => window.__themeContrast.count >= count, ++changes);
  assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-theme-switch')), false, 'Hover transitions must be restored');
}
const frames = await page.evaluate(() => window.__themeContrast.frames);
const luminance = (css) => css.match(/[\d.]+/g).slice(0, 3).map(Number).map((v) => v / 255).map((v) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
const contrast = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + .05) / (lo + .05); };
const rows = frames.flatMap((f) => f.rows.map((r) => ({ ...r, theme: f.theme, ratio: contrast(r.foreground, r.background) })));
assert.ok(rows.length > 100);
assert.ok(rows.every((r) => r.ratio >= 4.5), JSON.stringify(rows.filter((r) => r.ratio < 4.5)));
const hoverTransition = await page.evaluate(() => getComputedStyle(document.querySelector('.engmodegateactions .btn')).transitionDuration);
assert.notEqual(hoverTransition, '0s');
const result = { passed: true, startingTheme, frames: frames.length, samples: rows.length, minimumContrast: Math.min(...rows.map((r) => r.ratio)), themes: [...new Set(rows.map((r) => r.theme))], buttons: [...new Set(rows.map((r) => r.label))], hoverTransition, checks: ['every sampled frame meets 4.5:1 text contrast', 'all four theme palettes', 'theme guard clears', 'hover transitions return'] };
await writeFile(`${evidence}/theme-contrast-checks.json`, JSON.stringify(result, null, 2));
console.log(result);
