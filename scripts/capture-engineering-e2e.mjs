// Electron-native evidence for Engineering OS. This loads the fresh preview build (the real
// renderer + deterministic Engineering bridge), exercises the Plan/Act approval
// flow, and captures pixels from Electron's own BrowserWindow.
//
// Run after building the preview renderer:
//   pnpm --dir apps/desktop exec vite build --config vite.preview.config.mjs
//   pnpm --dir apps/desktop exec electron ../../scripts/capture-engineering-e2e.mjs
import { app, BrowserWindow } from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs/design/engineering-os-2026-08/validation/2026-08-31-code-e2e');
const PREVIEW = `file://${join(ROOT, 'apps/desktop/out/preview/index.html')}`;
const THEME = process.env.NM_CAPTURE_THEME ?? 'dark';
const URL = `${PREVIEW}?theme=${encodeURIComponent(THEME)}&client=desktop&engineeringHarness=1&click=Code`;
const SHOW = process.env.NM_CAPTURE_SHOW === '1';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function capture(win, name) {
  const image = await win.webContents.capturePage();
  const themedName = THEME === 'dark' ? name : name.replace(/\.png$/, `-${THEME}.png`);
  writeFileSync(join(OUT, themedName), image.toPNG());
  console.log(`${themedName} ${image.getSize().width}x${image.getSize().height}`);
}

async function clickButton(win, label) {
  const clicked = await win.webContents.executeJavaScript(`(() => {
    const button = [...document.querySelectorAll('button')]
      .find((candidate) => candidate.textContent?.trim() === ${JSON.stringify(label)});
    if (!button) return false;
    button.click();
    return true;
  })()`);
  assert(clicked, `button not found: ${label}`);
}

async function fillComposer(win, text) {
  const filled = await win.webContents.executeJavaScript(`(() => {
    const textarea = document.querySelector('textarea');
    if (!textarea) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(textarea, ${JSON.stringify(text)});
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  assert(filled, 'Engineering composer was not found');
}

async function clickAria(win, label) {
  const clicked = await win.webContents.executeJavaScript(`(() => {
    const button = document.querySelector(${JSON.stringify(`button[aria-label="${label}"]`)});
    if (!button) return false;
    button.click();
    return true;
  })()`);
  assert(clicked, `button not found: ${label}`);
}

mkdirSync(OUT, { recursive: true });

app.whenReady().then(async () => {
  const errors = [];
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: SHOW,
    // An in-memory partition keeps every capture repeatable without touching a developer's
    // real NeuraMesh storage or accumulating simulated sessions across runs.
    webPreferences: { backgroundThrottling: false, partition: 'engineering-e2e' },
  });

  win.webContents.on('console-message', (...args) => {
    const [, detailsOrLevel, legacyMessage] = args;
    const details = typeof detailsOrLevel === 'object'
      ? detailsOrLevel
      : { level: detailsOrLevel, message: legacyMessage };
    const message = details.message ?? '';
    // Electron emits this warning for every unpackaged file:// preview harness. The packaged
    // renderer has its own CSP; this development-only notice is not an application error.
    if (message.includes('Electron Security Warning (Insecure Content-Security-Policy)')) return;
    if (details.level === 'error' || Number(details.level) >= 2) errors.push(message);
  });

  try {
    await win.loadURL(URL);
    await sleep(3_500);
    const home = await win.webContents.executeJavaScript('document.body.innerText');
    const composerEnabled = await win.webContents.executeJavaScript("!!document.querySelector('.engstart textarea:not(:disabled)')");
    assert(composerEnabled, 'Code harness did not enable the composer');
    assert(!home.includes('Code connected'), 'routine Code connectivity chrome remained on the landing view');
    assert(!/\bcline\b/i.test(home), 'implementation harness branding leaked into the Code UI');
    const landingDetails = await win.webContents.executeJavaScript(`(() => {
      const splitter = document.querySelector('.engsplitter');
      const lever = document.querySelector('.engsplitterbar');
      const marker = document.querySelector('.engrecent .engstatedot');
      const project = document.querySelector('.engrecentproject');
      if (!splitter || !lever) return null;
      const splitterStyle = getComputedStyle(splitter);
      const leverStyle = getComputedStyle(lever);
      return {
        splitterBorder: splitterStyle.borderLeftWidth,
        leverHeight: leverStyle.height,
        markerMode: marker?.className ?? '',
        project: project?.textContent ?? '',
      };
    })()`);
    assert(landingDetails?.splitterBorder === '0px', 'Code split surface still rendered a full-height border');
    assert(landingDetails?.leverHeight === '68px', 'Code split surface did not render the compact center lever');
    assert(landingDetails?.markerMode.includes('mode-plan'), 'recent Code task did not use its mode marker');
    assert(landingDetails?.project, 'recent Code task did not name its project context');
    await capture(win, 'engineering-home-desktop.png');
    const openedModelPicker = await win.webContents.executeJavaScript(`(() => {
      const trigger = [...document.querySelectorAll('button')]
        .find((button) => button.textContent?.trim().startsWith('Model ·'));
      if (!trigger) return false;
      trigger.click();
      return true;
    })()`);
    assert(openedModelPicker, 'Code model trigger was not rendered');
    await sleep(150);
    const modelPicker = await win.webContents.executeJavaScript(`(() => {
      const dialog = document.querySelector('[role="dialog"][aria-label="Code model"]');
      return {
        opened: Boolean(dialog),
        hasProjectDefault: dialog?.textContent?.includes('Project default') ?? false,
        hasPlatformModel: dialog?.textContent?.includes('NeuraMesh') ?? false,
        hasOpaqueStarter: dialog?.textContent?.includes('NM Cloud Starter v1') && dialog?.textContent?.includes('NeuraMesh managed'),
        leakedStarterId: dialog?.textContent?.includes('gemini-3.5-flash-lite') ?? false,
        leakedBrainControl: [...document.querySelectorAll('.engconversation button')]
          .some((button) => button.textContent?.trim().startsWith('Brain ·')),
      };
    })()`);
    assert(modelPicker.opened, 'Code model picker did not open');
    assert(modelPicker.hasProjectDefault, 'Code model picker did not offer project inheritance');
    assert(modelPicker.hasPlatformModel, 'Code model picker did not render the model catalog');
    assert(modelPicker.hasOpaqueStarter, 'Code model picker did not use the managed NeuraMesh starter label');
    assert(!modelPicker.leakedStarterId, 'Code model picker exposed the starter backing model id');
    assert(!modelPicker.leakedBrainControl, 'Code still exposed the multi-role Brain control');
    await capture(win, 'engineering-model-selector-desktop.png');
    await win.webContents.executeJavaScript(`document.querySelector('.projmenu-scrim')?.click()`);
    await sleep(150);

    await clickAria(win, 'New Code thread');
    await sleep(400);
    await fillComposer(win, 'Add a shared formatOwner helper and a focused test.');
    await clickAria(win, 'Send Code message');
    await sleep(1_200);

    const handoff = await win.webContents.executeJavaScript('document.body.innerText');
    assert(handoff.includes('Ready to implement'), 'completed Plan did not render its Act handoff');
    assert(handoff.includes('Continue in Act'), 'one-click Act continuation was not offered');
    await capture(win, 'engineering-plan-handoff-desktop.png');
    await clickButton(win, 'Continue in Act');
    await sleep(1_000);
    const approval = await win.webContents.executeJavaScript('document.body.innerText');
    const actSelected = await win.webContents.executeJavaScript(`[...document.querySelectorAll('button[aria-pressed="true"]')].some((button) => button.textContent?.trim() === 'Act')`);
    assert(actSelected, 'one-click continuation did not switch the thread to Act mode');
    await capture(win, 'engineering-approval-desktop.png');
    assert(approval.includes('Apply proposed file changes') || approval.includes('Apply 2-file patch'), 'edit approval was not rendered');
    assert(/activity/i.test(approval), 'activity receipts were not rendered before approval');
    assert(!/\bcline\b/i.test(approval), 'implementation harness branding leaked into approval state');
    await clickButton(win, 'Approve once');
    await sleep(900);
    await clickButton(win, 'Approve once');
    await sleep(1_300);
    await clickButton(win, 'Checkpoints');
    await sleep(400);

    const completed = await win.webContents.executeJavaScript('document.body.innerText');
    assert(completed.includes('Implemented and verified'), 'Engineering task did not complete');
    assert(completed.includes('Verified implementation'), 'Verified checkpoint was not created');
    assert(completed.includes('Before file edits'), 'Pre-edit checkpoint was not created');
    assert(completed.includes('Session start'), 'Session-start checkpoint was not created');
    assert(completed.includes('Applied file changes'), 'applied-edit receipt was not rendered');
    assert(completed.includes('Verification passed'), 'verification receipt was not rendered');
    assert(!/\bcline\b/i.test(completed), 'implementation harness branding leaked into completed state');
    assert(errors.length === 0, `renderer console errors: ${errors.join(' | ')}`);
    await capture(win, 'engineering-completed-desktop.png');
    console.log('Engineering Electron E2E: PASS');
    if (SHOW) await sleep(45_000);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    const exitCode = process.exitCode ?? 0;
    win.destroy();
    app.exit(exitCode);
  }
});
