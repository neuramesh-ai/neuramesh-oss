// INTAKE, LIVE (round 9). A thread's first message goes through intake in nm-api (the starter brain
// decides an IntakeDecision, packages/shared/src/intake.ts, stored on threads.intake, 0177). nm-api then
// sets the title, flips a coding ask to a coding thread with a workspace (a worktree of a named
// repository, or a local scratch workspace), and shows a Plan line. The selected agent does the work and
// narrates it in short progress lines. These scenarios drive it as a person does, through hq's Home
// composer, and read the rows behind the page:
//
//   intake-coding-scratch  the George case, with video: a build ask with no repository becomes a coding
//                          thread on a scratch workspace, plans, narrates, writes index.html, and the app
//                          works. It records time to title, plan, first progress line, first file, done
//   intake-question        a plain question stays a conversation and gets an answer, no workspace
//   intake-content         a content ask stays out of coding
//   intake-repo            a build ask that names the project's repository gets workspace_mode repo
//
// The stable hooks of the other lanes come first: data-intake-plan (the Plan line), data-progress-line
// (each live progress line), data-scratch-workspace (the Scratch workspace label), and the preview
// frame iframe.wfframe opened from the Files tab's "Preview page" (button[data-preview-page]). The older
// tolerant selectors stay as fallbacks, and every check carries the evidence it read. Options (env):
//   INTAKE_MODEL      a model name (or part of one) to pick in the composer's model chip. Default: the
//                     strongest model the workspace can use (house brain if nothing else is connected)
//   INTAKE_THINKING   Low | Medium | High (default High) for a model that takes a thinking level
//   INTAKE_RUN_S      how long the coding run may take (default 600)
import { randomUUID } from 'node:crypto';
import { api, door, feedRows, replica, sleep, snap, until } from './lib.mjs';

const H = (ctx) => ctx.a.userId;
const env = (k, d) => process.env[k] ?? d;
const GEORGE_ASK = 'build a palindrome html app that checks if a string is a palindrome';
/** strongest first: the first enabled model whose name matches wins */
const STRENGTH = [/argon/i, /opus/i, /\bsol\b/i, /gpt-5/i, /sonnet/i, /\bpro\b/i, /terra/i, /flash(?!-lite)/i];

const parse = (v) => { if (!v) return null; if (typeof v === 'object') return v; try { return JSON.parse(v); } catch { return null; } };
/** a stored decision, read as loosely as the contract's intakeOf (v 1, a kind, a workspace, a plan) */
const intakeOf = (v) => { const d = parse(v); return d && d.v === 1 && typeof d.kind === 'string' && Array.isArray(d.plan) ? d : null; };

/** the thread's row: the page's replica first (it is what the page renders), the feed when there is no page */
async function threadRow(ctx, id) {
  const page = ctx.a.page;
  const rows = page ? await Promise.race([
    replica(page, 'SELECT id, title, kind, intake, workspace_mode FROM threads WHERE id = ?', [id]).catch(() => null),
    sleep(500).then(() => null),
  ]) : null;
  if (rows?.[0]?.intake) return rows[0];
  return (await feedRows(H(ctx), 'threads', ctx.ws.id).catch(() => [])).find((r) => r.id === id) ?? rows?.[0] ?? null;
}

/** the composer's model chip: pick INTAKE_MODEL, else the strongest enabled model. Returns what it picked */
async function pickModel(page, scope) {
  const chip = page.locator(`${scope} .cmodel`).first();
  if (!(await chip.count())) return { picked: null, note: 'no model chip in the composer' };
  await chip.click({ timeout: 10_000 }).catch(() => {});
  const pop = page.locator('.cmodpop');
  if (!(await pop.waitFor({ state: 'visible', timeout: 8_000 }).then(() => true).catch(() => false))) return { picked: null, note: 'the model menu did not open' };
  const options = await page.$$eval('.cmodpop button.cmodpick', (els) => els.map((e) => ({ name: e.querySelector('.nm')?.textContent?.trim() ?? e.textContent.trim(), enabled: !e.disabled, on: e.getAttribute('aria-checked') === 'true' })));
  const enabled = options.filter((o) => o.enabled);
  const want = env('INTAKE_MODEL', '');
  const choice = want ? enabled.find((o) => o.name.toLowerCase().includes(want.toLowerCase()))
    : STRENGTH.map((re) => enabled.find((o) => re.test(o.name))).find(Boolean) ?? enabled.find((o) => o.on) ?? enabled[0];
  if (!choice) { await page.keyboard.press('Escape'); return { picked: null, options, note: 'no enabled model' }; }
  const level = env('INTAKE_THINKING', 'High');
  const chev = page.locator(`.cmodpop button.cmodchev[aria-label="Thinking for ${choice.name}"]`);
  if (await chev.count()) {
    await chev.first().click().catch(() => {});
    const lv = page.locator('.cmodpop .cmodlv button', { hasText: level });
    if (await lv.count()) await lv.first().click().catch(() => {});
    else await page.locator('.cmodpop button.cmodpick', { hasText: choice.name }).first().click().catch(() => {});
  } else {
    await page.locator('.cmodpop button.cmodpick', { hasText: choice.name }).first().click().catch(() => {});
  }
  await pop.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => page.keyboard.press('Escape'));
  const shown = await chip.textContent({ timeout: 3_000 }).catch(() => null);
  return { picked: choice.name, level: (await chev.count()) ? level : null, chip: shown?.trim() ?? null, options: options.map((o) => `${o.name}${o.enabled ? '' : ' (off)'}`) };
}

/**
 * Send a first message the way a person does: hq's Home, New session, no repository chip, typed and
 * sent from the composer. With no browser it posts through /v1/messages to a fresh thread with no
 * threadKind, which is what Home sends. Returns the thread id and the send time.
 */
async function homeSend(ctx, text, { model = false } = {}) {
  const page = ctx.a.page;
  if (!page) {
    const threadId = randomUUID();
    const sentAt = Date.now();
    await api('POST', '/v1/messages', { as: H(ctx), body: { workspace: ctx.ws.id, channel: ctx.ws.channelId, threadId, body: text } });
    return { threadId, sentAt, via: 'api' };
  }
  await page.goto(`${ctx.cfg.hq}/${ctx.ws.slug}`, { waitUntil: 'domcontentloaded' }).catch(() => {});
  const fresh = page.locator('[aria-label="New session"], button:has-text("New session")').first();
  await fresh.click({ timeout: 20_000 }).catch(() => {});
  const box = page.locator('.stagebox textarea, .hcomposer textarea').first();
  await box.waitFor({ state: 'visible', timeout: 30_000 });
  // no repository: intake decides the workspace. A remembered repository chip is cleared to None
  const repo = page.locator('.stagebox .crepo.lit').first();
  if (await repo.count()) {
    await repo.click().catch(() => {});
    await page.getByRole('menuitemradio', { name: /None/ }).first().click({ timeout: 5_000 }).catch(() => {});
  }
  const chosen = model ? await pickModel(page, '.stagebox') : null;
  // THE PREFILL (live run 1d6c6a80): after the wizard, Home holds a draft ("@rex introduce yourself...")
  // and says "Waiting for machine". Typing on top of it sent the draft with the ask's tail. So: wait
  // until the composer is ready (up to 90 s), clear the box, and prove it is empty before typing
  const composer = { prefill: (await box.inputValue().catch(() => '')) || null };
  const t0 = Date.now();
  await until('the composer is ready', async () => !/waiting for (the )?machine/i.test(await page.locator('.stagebox, .hcomposer').first().innerText().catch(() => '')), { timeout: 90_000, every: 1_000 }).catch(() => {});
  composer.readyWaitMs = Date.now() - t0;
  await box.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Backspace');
  if (await box.inputValue().catch(() => '')) await box.fill('');
  composer.cleared = (await box.inputValue().catch(() => 'unreadable')) === '';
  // the whole ask, then one real keystroke so the composer sees typing (the prewake fires on it)
  await box.fill(text.slice(0, -1));
  await page.keyboard.type(text.slice(-1));
  composer.value = await box.inputValue().catch(() => null);
  composer.exact = composer.value === text;
  const send = page.locator('.stagebox button[aria-label="Send"], .stagebox button.hsend').first();
  const t1 = Date.now();
  composer.sendEnabled = await until('the send button', async () => send.isEnabled().catch(() => false), { timeout: 90_000, every: 500 }).then(() => true, () => false);
  composer.sendWaitMs = Date.now() - t1;
  // the box again, the instant before Send: a late intro seed replaced the typed ask here in f4f9c91a
  // (hq stage-draft.ts fixes it). Recorded, never retyped, so the exact-send check still catches it
  composer.valueAtSend = await box.inputValue().catch(() => null);
  composer.exactAtSend = composer.valueAtSend === text;
  const sentAt = Date.now();
  if (composer.sendEnabled) await send.click();
  else await page.keyboard.press('Enter');
  const threadId = await until('the new thread in the URL', async () => /\/c\/([0-9a-f-]{36})/.exec(page.url())?.[1] ?? null, { timeout: 30_000, every: 250 }).catch(() => null);
  return { threadId, sentAt, via: 'home', model: chosen, composer };
}

/** the thread's first message is exactly the ask: no prefill in front of it, nothing lost */
async function checkSent(t, ctx, sent, text) {
  const body = await until('the sent message', async () => (await feedRows(H(ctx), 'messages', ctx.ws.id)).filter((m) => m.thread_id === sent.threadId && m.author_kind === 'human').sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))[0]?.body ?? null, { timeout: 30_000, every: 1_500 }).catch(() => null);
  return t.check('the composer sends exactly the ask (the box was cleared first)', body?.trim() === text, { sent: body, composer: sent.composer ?? null });
}

/** wait for the decision on a thread, with the time it took */
async function waitIntake(ctx, threadId, sentAt, timeout = 30_000) {
  const r = await until('threads.intake', async () => { const row = await threadRow(ctx, threadId); const d = intakeOf(row?.intake); return d ? { row, d, at: Date.now() } : null; }, { timeout, every: 500 }).catch(() => null);
  return r ? { ...r, ms: r.at - sentAt } : { row: await threadRow(ctx, threadId), d: null, ms: null };
}

/** what the coding page shows right now, read in one pass. `plan` is the decision's steps (for the plan line) */
const probe = (page, plan) => page.evaluate((steps) => {
  const text = document.body.innerText;
  const lower = text.toLowerCase();
  const step = (steps ?? []).map((s) => String(s).toLowerCase().slice(0, 28)).find((s) => s.length > 6 && lower.includes(s)) ?? null;
  // the stable hook (r9-intake): .intakeplan[data-intake-plan="<kind>"][data-intake-workspace="<ws>"]
  // with its steps in ol.intakeplansteps > li. The rest are fallbacks
  const planEl = document.querySelector('.intakeplan[data-intake-plan]') ?? document.querySelector('[data-intake-plan], [data-plan-line], [data-intake] [data-plan], .intakeplan, .planline');
  const firstLine = (e) => (e.innerText || '').trim().split('\n').map((l) => l.trim()).find((l) => l.length > 3 && !/^\d{1,2}:\d{2}(\s*[AP]M)?$/i.test(l) && !/^ready in\b/i.test(l))?.slice(0, 200);
  // THE STABLE HOOK (r9-stream): every live progress line carries data-progress-line ("live" in the
  // stream bubble, "saved" or "pending" in the activity row, "saved" on a coding view message that more
  // work follows). The bubble hides a line once the activity row shows it, so there is no double count
  const hooked = [...document.querySelectorAll('[data-progress-line]')].map((e) => ({ kind: e.getAttribute('data-progress-line') || 'line', text: firstLine(e) })).filter((x) => x.text);
  // the fallback: the older guesses and the coding view's agent messages, for a build without the hook
  const lineEls = [...document.querySelectorAll('[data-narration], [data-narrate], .narration, .narrateline, .codingthread .msg:not(.human), .threadpanel .msg.agent, .codingthread .think')];
  const lines = lineEls.map(firstLine).filter(Boolean);
  const narration = hooked.length;
  const headline = document.querySelector('.streamheadline')?.textContent?.trim() ?? null;
  const files = [...document.querySelectorAll('[data-change-review] button[aria-label^="Review "]')].map((b) => b.getAttribute('aria-label').replace(/^Review /, '').replace(/ in this change set$/, ''));
  const preview = document.querySelector('section.webpreview');
  return {
    coding: !!document.querySelector('.codingthread'),
    // the stable hook (r9-scratch): the thread head chip or the coding task's line carries data-scratch-workspace
    scratch: !!document.querySelector('[data-scratch-workspace]') || /scratch workspace/i.test(text),
    scratchHow: document.querySelector('[data-scratch-workspace]') ? 'data-scratch-workspace' : /scratch workspace/i.test(text) ? 'text' : null,
    scratchLabel: document.querySelector('[data-scratch-workspace]')?.textContent?.trim() ?? null,
    plan: planEl ? (planEl.hasAttribute('data-intake-plan') ? 'data-intake-plan' : 'element') : step ? 'step-text' : /(^|\n)\s*plan\b[:\s]/i.test(text) ? 'plan-word' : null,
    planText: (planEl?.innerText ?? '').slice(0, 300) || null,
    planKind: planEl?.getAttribute('data-intake-plan') ?? null,
    planWorkspace: planEl?.getAttribute('data-intake-workspace') ?? null,
    planSteps: planEl ? planEl.querySelectorAll('ol.intakeplansteps > li').length : 0,
    lines, hooked, narration, headline, files,
    preview: preview ? { title: preview.getAttribute('aria-label'), url: preview.querySelector('.webpreview-url')?.getAttribute('title') ?? null } : null,
    busy: !!document.querySelector('.codingthread .cagent:disabled, [data-plan-progress], .typingbar, .tdots'),
    model: document.querySelector('.codingthread .cmodel')?.textContent?.trim() ?? null,
  };
}, plan);

/** the written file as the review panel shows it: open "Review <path>", read the new side of the diff */
async function readFile(page, path) {
  const btn = page.locator(`[data-change-review] button[aria-label="Review ${path} in this change set"]`).last();
  if (!(await btn.count())) return null;
  await btn.click().catch(() => {});
  const view = page.locator(`[aria-label="Diff for ${path}"], [aria-label="File content for ${path}"]`).first();
  if (!(await view.waitFor({ state: 'visible', timeout: 15_000 }).then(() => true).catch(() => false))) return null;
  return view.evaluate((el) => [...el.querySelectorAll('[class*="diffLine"], [class*="sourceLine"]')]
    .filter((l) => !/removed/.test(l.className))
    .map((l) => l.lastElementChild?.textContent ?? '').join('\n'));
}

/**
 * Does the palindrome app work, in `target` (a Page, or the preview's Frame)? For each word it calls
 * `reset` (load the page fresh, or nothing for the live frame), types the word into the first text
 * field, presses Enter, clicks the first button, and reads only the text that is new since the page
 * loaded: the result, not the heading or the help text. Racecar must read as a palindrome, hello must not.
 */
async function gradeIn(target, reset, shotOf) {
  const out = { words: {} };
  try {
    await reset();
    const base = new Set((await target.evaluate(() => document.body.innerText)).split('\n').map((l) => l.trim()));
    for (const word of ['Racecar', 'hello']) {
      if (word !== 'Racecar') await reset();
      const field = target.locator('input[type="text"], input:not([type]), input[type="search"], textarea').first();
      if (!(await field.count())) { out.words[word] = { error: 'no text field on the page' }; continue; }
      await field.fill(word);
      await field.press('Enter').catch(() => {});
      const button = target.locator('button, input[type="submit"], input[type="button"]').first();
      if (await button.count()) await button.click({ timeout: 3_000 }).catch(() => {});
      await sleep(700);
      const after = await target.evaluate(() => document.body.innerText);
      const said = after.split('\n').map((l) => l.trim()).filter((l) => l && !base.has(l)).join(' ') || after;
      const negative = /\b(not|isn['’]t|is not|no)\b[^.\n]{0,20}palindrome|not a palindrome|✗|❌|\bfalse\b/i.test(said);
      const positive = !negative && /palindrome|✓|✅|\btrue\b|\byes\b/i.test(said);
      out.words[word] = { positive, negative, said: said.slice(0, 160), shot: await shotOf(word) };
    }
  } catch (e) {
    out.error = String(e?.message ?? e).slice(0, 200);
  }
  out.works = !!out.words.Racecar?.positive && !!out.words.hello?.negative;
  return out;
}

/** the fallback grade: the file the agent wrote, loaded as is in a page of its own */
async function gradeFile(ctx, html) {
  const page = await ctx.a.context.newPage();
  try {
    return { source: 'file', ...(await gradeIn(page, () => page.setContent(html, { waitUntil: 'load', timeout: 10_000 }), (w) => snap(page, `intake-file-${w.toLowerCase()}`))) };
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * THE PREVIEW (r9-scratch). On Cloud Run the Code shell serves no dev server, so a static page previews
 * in hq itself: the coding thread's side panel, its Files tab, the file, then "Preview page". A file tab
 * opens in Preview mode with `iframe.wfframe` (srcdoc, scripts allowed, relative CSS and JS inlined by
 * static-preview.ts). The page RUNS in that frame, so the words are typed into it. A link to index.html
 * in the agent's reply opens the same tab, so that is tried first. Returns the frame, or why not.
 */
async function openPreview(page, path) {
  const steps = [];
  const frameEl = page.locator('iframe.wfframe').last();
  const shown = () => frameEl.waitFor({ state: 'visible', timeout: 8_000 }).then(() => true).catch(() => false);
  const name = path.split('/').at(-1);
  // 0. readFile already opened the file in EngineeringReview, where button[data-preview-page] sits
  const directBtn = page.locator('button[data-preview-page]').first();
  if (await directBtn.isVisible().catch(() => false)) {
    await directBtn.click({ timeout: 5_000 }).then(() => steps.push('Preview page (from review)'), () => {});
  }
  // 1. the agent's reply links the file
  if (!(await frameEl.count()) || !(await shown())) {
    const link = page.locator(`.codingthread a:has-text("${name}")`).last();
    if (await link.count()) { await link.click().catch(() => {}); steps.push('reply link'); }
  }
  if (!(await frameEl.count()) || !(await shown())) {
    // 2. the side panel's Files tab
    let files = page.locator('.engeditor button:has-text("Files")').first();
    if (!(await files.count())) {
      await page.locator('.codingthread .overview-toggle, button[aria-label*="side panel" i], button[aria-label*="Overview" i], button[aria-label*="Files" i]').first().click({ timeout: 5_000 }).catch(() => {});
      steps.push('opened the side panel');
      files = page.locator('.engeditor button:has-text("Files")').first();
    }
    await files.click({ timeout: 10_000 }).then(() => steps.push('Files tab'), () => steps.push('no Files tab'));
    const open = page.locator(`button[aria-label="Open ${path}"], button[aria-label="Open ${name}"]`).first();
    await open.click({ timeout: 15_000 }).then(() => steps.push(`opened ${path}`), () => steps.push(`no "Open ${path}" button`));
    await page.locator('button[data-preview-page]').first().click({ timeout: 10_000 }).then(() => steps.push('Preview page'), () => steps.push('no Preview page button'));
  }
  if (!(await shown())) return { frame: null, steps };
  const frame = await (await frameEl.elementHandle()).contentFrame();
  await frame?.waitForLoadState('load', { timeout: 10_000 }).catch(() => {});
  return { frame, steps };
}

/**
 * The service's own log lines for a thread (best effort, the build's identity has logging.viewer):
 * nm-api `thread_intake thread=... kind= confidence= workspace= source= ms= applied=` and the machine's
 * `intake_wait thread=... outcome=`. Off a Google Cloud host it answers why it could not read them.
 */
async function intakeLogs(threadId, sinceMs) {
  try {
    const md = (path) => fetch(`http://metadata.google.internal/computeMetadata/v1/${path}`, { headers: { 'metadata-flavor': 'Google' }, signal: AbortSignal.timeout(3_000) });
    const project = await (await md('project/project-id')).text();
    const { access_token: token } = await (await md('instance/service-accounts/default/token')).json();
    const filter = `timestamp>="${new Date(sinceMs - 60_000).toISOString()}" AND textPayload:"thread=${threadId}" AND (textPayload:"thread_intake" OR textPayload:"intake_wait")`;
    for (let i = 0; i < 4; i++) {
      const res = await fetch('https://logging.googleapis.com/v2/entries:list', {
        method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ resourceNames: [`projects/${project}`], filter, orderBy: 'timestamp asc', pageSize: 20 }), signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return { error: `logging HTTP ${res.status}` };
      const lines = ((await res.json()).entries ?? []).map((e) => `${e.timestamp} ${String(e.textPayload ?? '').slice(0, 300)}`);
      if (lines.length || i === 3) return { lines };
      await sleep(5_000); // the log pipeline lags the write by a few seconds
    }
    return { lines: [] };
  } catch (e) {
    return { error: String(e?.message ?? e).slice(0, 120) };
  }
}

/** a program pasted into the chat: a fenced block or an html document of 1200 characters or more */
const BIG_CODE = /```(?:html|js|javascript|css)?\s*\n[\s\S]{1200,}?```|<html[\s\S]{1200,}<\/html>/i;

export const r9Intake = [
  {
    id: 'intake-coding-scratch',
    title: 'intake: a build ask with no repository becomes a coding thread on a scratch workspace, plans, narrates, writes the app, and the app works (round 9, video)',
    needs: ['browser'],
    async run(t, ctx) {
      const page = ctx.a.page;
      const RUN = Number(env('INTAKE_RUN_S', '600')) * 1000;
      const sent = await homeSend(ctx, GEORGE_ASK, { model: true });
      t.note({ model: sent.model });
      if (!t.check('the Home composer sends the ask and opens its thread', !!sent.threadId, { url: page.url(), composer: sent.composer })) return;
      const { threadId, sentAt } = sent;
      const T = {}; // ms from the send
      const since = () => Date.now() - sentAt;
      const seen = new Map(); // fallback progress line -> first ms
      const hooked = new Map(); // [data-progress-line] text -> { ms, kind }
      let first = null; let d = null; let row = null; let p = null; let idleSince = null; let indexPath = null;
      const shots = {};
      while (since() < RUN) {
        row = await threadRow(ctx, threadId).catch(() => row);
        if (row && first === null) first = { title: row.title, ms: since() };
        d = d ?? intakeOf(row?.intake);
        if (d && T.intake === undefined) T.intake = since();
        if (d && row?.title === d.title && T.title === undefined) T.title = since();
        p = await probe(page, d?.plan).catch(() => p);
        if (p) {
          // only the stable hook counts as the Plan line. A weaker match (a step's words, the word "Plan")
          // is kept as a note: it passed on page text alone in 1d6c6a80 with no Plan line on screen
          if (p.plan === 'data-intake-plan' && T.plan === undefined) { T.plan = since(); shots.plan = await snap(page, 'intake-plan'); }
          if (p.plan && p.plan !== 'data-intake-plan' && T.planHint === undefined) T.planHint = { ms: since(), how: p.plan };
          if (p.coding && T.coding === undefined) T.coding = since();
          if (p.scratch && T.scratch === undefined) T.scratch = since();
          for (const h of p.hooked) if (!hooked.has(h.text)) hooked.set(h.text, { ms: since(), kind: h.kind });
          for (const l of p.lines) if (!seen.has(l) && !l.includes(GEORGE_ASK.slice(0, 30))) seen.set(l, since());
          if ((hooked.size || seen.size) && T.progress === undefined) T.progress = since();
          if ((hooked.size || seen.size) >= 2 && !shots.mid) shots.mid = await snap(page, 'intake-progress-mid');
          if (p.files.length && T.file === undefined) { T.file = since(); shots.file = await snap(page, 'intake-first-file'); }
          indexPath = indexPath ?? p.files.find((f) => /(^|\/)index\.html$/i.test(f)) ?? null;
          if (indexPath && T.index === undefined) T.index = since();
          idleSince = p.busy ? null : (idleSince ?? Date.now());
          // done: the file is written and the page has been quiet for 20 s
          if (T.index !== undefined && idleSince && Date.now() - idleSince > 20_000) break;
        }
        await sleep(1_000);
      }
      T.total = since();
      shots.end = await snap(page, 'intake-end');
      // read after the timed loop, so this read never delays the 5 s timings
      await checkSent(t, ctx, sent, GEORGE_ASK);
      // the hook when the build has it, else the fallback guesses (and the check says which it counted)
      const viaHook = hooked.size > 0;
      const progress = viaHook ? [...hooked.entries()].map(([line, v]) => ({ ms: v.ms, kind: v.kind, line: line.slice(0, 120) }))
        : [...seen.entries()].map(([line, ms]) => ({ ms, line: line.slice(0, 120) }));
      t.note({ timings: T, firstTitle: first, progressLines: progress.length, counted: viaHook ? '[data-progress-line]' : 'fallback selectors', model: p?.model ?? null, shots });

      t.check('the thread carries the intake title within 5 s of the send', T.title !== undefined && T.title <= 5_000, { ms: T.title ?? null, heuristic: first?.title ?? null, intake: d?.title ?? null, row: row?.title ?? null });
      t.check('threads.intake says coding on a scratch workspace with a 2 to 5 step plan', d?.kind === 'coding' && d?.workspace === 'scratch' && d.plan.length >= 2 && d.plan.length <= 5,
        d ? { kind: d.kind, workspace: d.workspace, plan: d.plan, source: d.source, model: d.model, ms: d.ms, confidence: d.confidence } : { intake: row?.intake ?? null });
      t.check('the Plan line (.intakeplan[data-intake-plan]) is visible within 5 s', T.plan !== undefined && T.plan <= 5_000,
        { ms: T.plan ?? null, how: T.plan !== undefined ? 'data-intake-plan' : null, weakerMatch: T.planHint ?? null, text: p?.planText ?? null, shot: shots.plan ?? null });
      t.check('the Plan line says coding on a scratch workspace and lists 2 to 5 steps (.intakeplan)', p?.planKind === 'coding' && p?.planWorkspace === 'scratch' && p.planSteps >= 2 && p.planSteps <= 5,
        { kind: p?.planKind ?? null, workspace: p?.planWorkspace ?? null, steps: p?.planSteps ?? 0, how: p?.plan ?? null });
      t.check('the thread is a coding thread on a scratch workspace (row and page)', row?.kind === 'coding' && row?.workspace_mode === 'scratch' && T.coding !== undefined && T.scratch !== undefined,
        { kind: row?.kind ?? null, workspaceMode: row?.workspace_mode ?? null, codingSurfaceMs: T.coding ?? null, scratchLabelMs: T.scratch ?? null, scratchHow: p?.scratchHow ?? null, label: p?.scratchLabel ?? null });
      const working = viaHook ? progress : progress.filter((x) => T.index === undefined || x.ms <= T.index);
      t.check('progress lines stream while the agent works (2 or more before the file is done)', working.length >= 2,
        { counted: viaHook ? '[data-progress-line]' : 'fallback selectors', count: working.length, kinds: [...new Set(working.map((x) => x.kind).filter(Boolean))], firstMs: T.progress ?? null, lines: working.slice(0, 8), shot: shots.mid ?? null });
      t.check('the agent writes index.html (it shows in the file review)', !!indexPath, { files: p?.files ?? [], ms: T.index ?? null, shot: shots.file ?? null });

      // the preview: the page runs in hq's preview frame, so the words are typed there. The file the
      // agent wrote is the fallback grade when the frame cannot be opened or read
      const html = indexPath ? await readFile(page, indexPath) : null;
      const prev = indexPath ? await openPreview(page, indexPath) : { frame: null, steps: ['no index.html'] };
      t.check('the preview opens: index.html runs in the preview frame (iframe.wfframe)', !!prev.frame, { steps: prev.steps, shot: await snap(page, 'intake-preview') });
      let grade = prev.frame ? { source: 'preview-frame', ...(await gradeIn(prev.frame, async () => { await prev.frame.evaluate(() => location.reload()).catch(() => {}); await prev.frame.waitForLoadState('load').catch(() => {}); await sleep(300); }, (w) => snap(page, `intake-preview-${w.toLowerCase()}`))) } : null;
      if (!grade?.works && html) grade = { ...(await gradeFile(ctx, html)), frame: grade };
      grade ??= { works: false, error: 'neither the preview frame nor the file content' };
      t.check('the app works: "Racecar" reads as a palindrome and "hello" does not', grade.works, { ...grade, bytes: html?.length ?? null });

      const msgs = (await feedRows(H(ctx), 'messages', ctx.ws.id).catch(() => [])).filter((m) => m.thread_id === threadId && m.author_kind !== 'human');
      const pasted = msgs.filter((m) => BIG_CODE.test(m.body ?? '')).map((m) => ({ id: m.id.slice(0, 8), bytes: (m.body ?? '').length }));
      const domPasted = await page.evaluate((src) => [...document.querySelectorAll('.codingthread .msg:not(.human), .threadpanel .msg:not(.human)')].some((e) => new RegExp(src, 'i').test(e.innerText)), BIG_CODE.source).catch(() => false);
      t.check('no full program is pasted into the chat', !pasted.length && !domPasted, { agentMessages: msgs.length, pasted, domPasted });
      t.note({ summary: { timeToTitleMs: T.title ?? null, timeToPlanMs: T.plan ?? null, timeToFirstProgressMs: T.progress ?? null, timeToFirstFileMs: T.file ?? null, totalMs: T.total } });
      t.note({ logs: await intakeLogs(threadId, sentAt) });
    },
  },
  {
    id: 'intake-question',
    title: 'intake: a plain question stays a conversation, gets an answer, and gets no workspace',
    async run(t, ctx) {
      const text = 'what is a palindrome?';
      const sent = await homeSend(ctx, text);
      if (!t.check('the question is sent and its thread opens', !!sent.threadId, { via: sent.via })) return;
      if (sent.via === 'home') await checkSent(t, ctx, sent, text);
      const { d, row, ms } = await waitIntake(ctx, sent.threadId, sent.sentAt);
      t.check('intake decides a question (or chat) with no workspace', !!d && ['question', 'chat'].includes(d.kind) && d.workspace === 'none', d ? { kind: d.kind, workspace: d.workspace, title: d.title, ms, source: d.source } : { intake: row?.intake ?? null });
      const answer = await until('an agent answer', async () => (await feedRows(H(ctx), 'messages', ctx.ws.id)).find((m) => m.thread_id === sent.threadId && m.author_kind === 'agent' && (m.body ?? '').trim().length > 20) ?? null, { timeout: 240_000, every: 4_000 }).catch(() => null);
      const after = await threadRow(ctx, sent.threadId);
      const coding = ctx.a.page ? await ctx.a.page.locator('.codingthread').count().catch(() => 0) : 0;
      if (ctx.a.page) await snap(ctx.a.page, 'intake-question');
      t.check('it stays a conversation: no coding thread, no workspace mode', after?.kind !== 'coding' && !after?.workspace_mode && !coding, { kind: after?.kind ?? null, workspaceMode: after?.workspace_mode ?? null, codingSurface: !!coding });
      t.note({ logs: await intakeLogs(sent.threadId, sent.sentAt) });
      t.check('an agent answers it', !!answer, answer ? { words: answer.body.split(/\s+/).length, start: answer.body.slice(0, 120), mentionsReverse: /revers|backward|same.*(forward|both)/i.test(answer.body) } : null);
    },
  },
  {
    id: 'intake-content',
    title: 'intake: a content ask stays out of coding',
    async run(t, ctx) {
      const ask = 'write a short launch post for our app';
      const sent = await homeSend(ctx, ask);
      if (!t.check('the ask is sent and its thread opens', !!sent.threadId, { via: sent.via })) return;
      if (sent.via === 'home') await checkSent(t, ctx, sent, ask);
      const { d, row, ms } = await waitIntake(ctx, sent.threadId, sent.sentAt);
      t.check('intake decides content, with no workspace', d?.kind === 'content' && d?.workspace === 'none', d ? { kind: d.kind, workspace: d.workspace, title: d.title, plan: d.plan, ms } : { intake: row?.intake ?? null });
      await sleep(5_000);
      const after = await threadRow(ctx, sent.threadId);
      if (ctx.a.page) await snap(ctx.a.page, 'intake-content');
      t.check('the thread is not a coding thread and has no workspace mode', after?.kind !== 'coding' && !after?.workspace_mode, { kind: after?.kind ?? null, workspaceMode: after?.workspace_mode ?? null });
    },
  },
  {
    id: 'intake-repo',
    title: 'intake: a build ask that names the project repository gets a worktree of it (workspace_mode repo)',
    async run(t, ctx) {
      const projects = await feedRows(H(ctx), 'projects', ctx.ws.id).catch(() => []);
      const proj = projects.find((x) => Number(x.is_default) === 1 || x.is_default === true) ?? projects[0];
      const channel = proj?.context_channel_id ?? ctx.ws.channelId;
      const name = `r9-shop-${ctx.tag}`;
      const repo = await api('POST', `/internal/e2e/workspaces/${ctx.ws.id}/repos`, { fleet: true, body: { channel, name, cloneUrl: `file:///nm/work/${name}` } }).catch((e) => ({ error: e?.json?.code ?? String(e?.message ?? e).slice(0, 120) }));
      if (!t.check('the project has a repository (e2e repo door)', !!repo.repoId, repo)) return;
      const ask = `add a footer with the current year to the ${name} repository`;
      const sent = await homeSend(ctx, ask);
      if (!t.check('the ask is sent and its thread opens', !!sent.threadId, { via: sent.via })) return;
      if (sent.via === 'home') await checkSent(t, ctx, sent, ask);
      const { d, row, ms } = await waitIntake(ctx, sent.threadId, sent.sentAt);
      t.check('intake decides coding on the named repository', d?.kind === 'coding' && d?.workspace === 'repo' && (d.repoId == null || d.repoId === repo.repoId),
        d ? { kind: d.kind, workspace: d.workspace, repoId: d.repoId ?? null, expected: repo.repoId, ms } : { intake: row?.intake ?? null });
      const after = await until('workspace_mode', async () => { const r = await threadRow(ctx, sent.threadId); return r?.workspace_mode ? r : null; }, { timeout: 20_000, every: 1_000 }).catch(() => threadRow(ctx, sent.threadId));
      if (ctx.a.page) await snap(ctx.a.page, 'intake-repo');
      t.check('the thread is a coding thread with workspace_mode repo', after?.kind === 'coding' && after?.workspace_mode === 'repo', { kind: after?.kind ?? null, workspaceMode: after?.workspace_mode ?? null });
      // the clone URL is a file:// path the machine does not have: the session itself is not graded here
      t.note('the coding session on the repository is not graded: the e2e repository is a link only');
      if (ctx.ws.runner) await door.idleDrain(ctx.ws.runner).catch(() => {});
    },
  },
];
