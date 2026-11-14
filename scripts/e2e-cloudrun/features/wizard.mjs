// THE WIZARD (apps/hq/src/views/Onboarding.tsx), walked the way a person does: Continue through each
// step, the Pro step's skip where it shows, and the last step's "Start a new session →" once the crew exists. On
// the Workspace step it types the name it is given, so two runs never fight over one address.
//
// Every click is short and the loop re-reads the step after it: a step can move on by itself (the Pro
// step skips itself where billing is off), and a long click on a button that just left the page
// waits out its whole timeout for nothing (the first runs lost 30 s and the walk that way).
import { join } from 'node:path';
// the wizard's last button: "Start a new session →" since the 2026-11 upstream, "Meet @<agent> …" before it
const LAUNCH_BUTTON = /^(start a new session|meet @)/i;

export async function walkWizard(page, out, { name, timeoutMs = 300_000 } = {}) {
  const steps = [];
  const clicks = [];
  let named = false;
  const deadline = Date.now() + timeoutMs;
  const bar = page.locator('[role="progressbar"][aria-valuenow]');
  try { await bar.first().waitFor({ timeout: 30_000 }); } catch { /* none */ }
  while (Date.now() < deadline) {
    if (!(await bar.count())) return { steps, clicks, open: false, named, ...(steps.length ? {} : { note: 'no wizard on screen' }) };
    const label = (await bar.getAttribute('aria-label').catch(() => null)) ?? '?';
    if (steps.at(-1) !== label) steps.push(label);
    const now = Number(await bar.getAttribute('aria-valuenow').catch(() => 0));
    const max = Number(await bar.getAttribute('aria-valuemax').catch(() => -1));
    if (now === max) {
      // the last step reads "Please wait…" until nm.onboard has created the crew, then "Start a new session →" (it read "Meet @<orchestrator> …" before the 2026-11 upstream)
      const meet = page.getByRole('button', { name: LAUNCH_BUTTON }).first();
      await meet.waitFor({ state: 'visible', timeout: 180_000 });
      await page.screenshot({ path: join(out, 'wizard-launch.png') }).catch(() => {});
      let how = 'click';
      try { await meet.click({ timeout: 15_000 }); } catch {
        how = 'force';
        try { await meet.click({ force: true, timeout: 10_000 }); } catch { how = 'dom'; await meet.evaluate((el) => el.click()); }
      }
      await bar.first().waitFor({ state: 'detached', timeout: 30_000 });
      return { steps, clicks, open: false, finished: true, named, meetClick: how };
    }
    if (name && !named && /workspace/i.test(label)) {
      // the step focuses and selects its name field on entry
      const field = page.locator('input:focus');
      if (await field.count()) { await field.fill(name); named = true; }
    }
    const skip = page.locator('button.proskip:visible');
    const what = (await skip.count()) ? 'skip' : 'continue';
    const target = what === 'skip' ? skip.first() : page.getByRole('button', { name: /^continue/i }).first();
    try {
      await target.click({ timeout: 5_000 });
      clicks.push(`${label}: ${what}`);
    } catch {
      // disabled for now, or gone because the step moved on: read the step again
      await page.waitForTimeout(1_000);
      continue;
    }
    await page.waitForFunction(
      (prev) => document.querySelector('[role="progressbar"][aria-valuenow]')?.getAttribute('aria-label') !== prev,
      label,
      { timeout: 60_000 },
    ).catch(() => {});
  }
  return { steps, clicks, open: true, named, note: 'the walk ran out of time' };
}
