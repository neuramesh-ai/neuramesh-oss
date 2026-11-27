import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Focused real-component regression. No model or repository edits run in this fixture. */
export async function checkComposerReview(page, url, out) {
  await mkdir(out, { recursive: true });
  const checks = [];
  const check = (name, condition) => { assert.ok(condition, name); checks.push(name); };
  const selected = () => page.evaluate(() => document.querySelector('[role="tab"][aria-selected="true"]')?.textContent);
  const waitTab = tab => page.waitForFunction(name => document.querySelector('[role="tab"][aria-selected="true"]')?.textContent === name, tab);
  await page.goto(url);
  await page.waitForSelector('textarea', { state: 'visible' });
  await page.fill('textarea', '/');
  check('slash lists built-in compact and the workspace skill', await page.evaluate(() => document.querySelector('.slashpop')?.textContent.includes('/compact') && document.querySelector('.slashpop')?.textContent.includes('task-handoff')));
  await page.screenshot({ path: join(out, '01-slash-dark.png') });
  await page.press('textarea', 'Enter');
  check('Enter inserts compact without sending it', await page.evaluate(() => document.querySelector('textarea').value === '/compact' && document.querySelector('[role="status"]').textContent.includes('Last sent nothing') && !document.querySelector('.slashpop')));
  await page.press('textarea', 'Enter');
  check('second Enter sends the built-in command', await page.evaluate(() => document.querySelector('[role="status"]').textContent.includes('Last sent /compact')));
  await page.fill('textarea', '/task'); await page.press('textarea', 'Tab');
  check('Tab attaches the selected skill', await page.evaluate(() => document.querySelector('[role="status"]').textContent.includes('Attached task-handoff')));
  await page.fill('textarea', '/compact');
  check('typing compact clears any skill attachment', await page.evaluate(() => document.querySelector('[role="status"]').textContent.includes('No skill attached') && !document.querySelector('.slashpop')));
  await page.click('text="Toggle skills"'); await page.fill('textarea', '/');
  check('compact remains available with no skills installed', await page.evaluate(() => document.querySelector('[role="option"]')?.textContent.includes('/compact')));
  await page.click('[role="option"]');
  check('mouse picks compact', await page.evaluate(() => document.querySelector('textarea').value === '/compact'));
  await page.fill('textarea', '');
  for (const action of ['Approve changes', 'Decline', 'Resolve remotely']) {
    await page.click('text="Propose edit"'); await waitTab('Changes');
    if (action === 'Approve changes') await page.screenshot({ path: join(out, '02-pending-review.png') });
    await page.click(`text="${action}"`); await waitTab('Conversation');
    check(`${action.toLowerCase()} returns to Conversation`, await selected() === 'Conversation');
  }
  await page.screenshot({ path: join(out, '03-returned-conversation.png') });
  for (const tab of ['Files', 'Changes']) {
    await page.click('text="Propose edit"'); await waitTab('Changes');
    await page.click(`loc=role:tab[name='${tab}']`);
    await page.click('text="Resolve remotely"');
    check(`manual ${tab} selection is preserved`, await selected() === tab);
  }
  await page.click("loc=role:tab[name='Conversation']");
  await page.click('text="Switch theme"'); await page.click('text="Toggle skills"'); await page.fill('textarea', '/');
  await page.screenshot({ path: join(out, '04-slash-light.png') });
  await writeFile(join(out, 'component-checks.json'), JSON.stringify({ fixture: true, passed: true, checks }, null, 2));
  return checks;
}
