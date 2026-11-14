import assert from 'node:assert/strict';

/** Exercise the live composer on a completed fixture. Switching modes may update
 * controls, but must never send the draft or advance the turn by itself. */
export async function checkModePicker(page) {
  const trigger = '.codingthread .coding-mode-chip';
  const selected = '.coding-mode-menu [aria-checked="true"]';
  const draft = 'Unsent mode picker check';
  const input = '.codingthread textarea';
  const original = await page.evaluate(selector => document.querySelector(selector)?.getAttribute('aria-label'), trigger);
  assert.ok(['Coding mode: Plan','Coding mode: Act'].includes(original));
  const originalMode = original.endsWith('Plan') ? 'Plan' : 'Act';
  const otherMode = originalMode === 'Plan' ? 'Act' : 'Plan';
  const repliesBefore = await page.evaluate(() => document.querySelectorAll('.codingthread .msg.human').length);
  await page.fill(input, draft);
  await page.press(trigger, 'ArrowDown');
  await page.waitForSelector(selected);
  assert.equal(await page.evaluate(selector => document.querySelector(selector)?.querySelector('b')?.textContent, selected), originalMode);
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.coding-mode-menu')).opacity === '1');
  await page.mouse.move(12, 12);
  const appearance = await page.evaluate(selector => {
    const button = document.querySelector(selector);
    const chip = button.getBoundingClientRect(), menu = document.querySelector('.coding-mode-menu').getBoundingClientRect();
    const style = getComputedStyle(button);
    return { gap: chip.top - menu.bottom, overlaps: menu.left < chip.right && menu.right > chip.left,
      background: style.backgroundColor, border: style.borderTopColor, shadow: style.boxShadow };
  }, trigger);
  assert.ok(appearance.overlaps && Math.abs(appearance.gap - 6) <= 1, 'menu should sit directly above its selector');
  assert.equal(appearance.background, 'rgba(0, 0, 0, 0)');
  assert.equal(appearance.border, 'rgba(0, 0, 0, 0)');
  assert.equal(appearance.shadow, 'none');
  await page.press(selected, 'Escape');
  await page.waitForFunction(selector => !document.querySelector('.coding-mode-menu') && document.activeElement?.matches(selector), trigger);
  for (const target of [otherMode, originalMode]) {
    await page.click(trigger);
    await page.press(selected, target === 'Plan' ? 'Home' : 'End');
    await page.press('.coding-mode-menu [role="menuitemradio"]:focus','Enter');
    await page.waitForSelector(`${trigger}[aria-label="Coding mode: ${target}"]`);
    const value = await page.evaluate(selector => document.querySelector(selector)?.value, input);
    assert.equal(value, draft);
  }
  assert.equal(await page.evaluate(() => document.querySelectorAll('.codingthread .msg.human').length), repliesBefore);
  assert.deepEqual(await page.evaluate(() => [...document.querySelector('.codingthread .codingknobs').querySelectorAll('button[aria-label]')].map(el => el.getAttribute('aria-label')?.split(':')[0])), ['Coding mode','Permissions','Agent','Send']);
  await page.fill(input, '');
}
