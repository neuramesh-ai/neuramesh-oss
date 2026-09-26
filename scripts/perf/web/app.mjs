// app.mjs: the journeys through the NeuraMesh browser client, as CDP steps. Shared by
// measure-frames.mjs and videos.mjs. Every in-page read returns location.origin and is checked
// against the expected origin; every selector that finds nothing throws (an audit that matches
// nothing must fail, never pass).
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluate, sleep } from './cdp.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const SEED = JSON.parse(readFileSync(resolve(here, 'seed.json'), 'utf8'));
export const LONG_TITLE = SEED.longThread.title;       // 'perf-lab · long thread'
export const REPLY_TITLE = SEED.replyThread.title;     // 'perf-lab · reply target'
export const LONG_LAST = 'That is the whole history for this thread';
export const REPLY_FIRST = 'Can you give me the release checklist status';

export class App {
  constructor(cdp, page, origin) { Object.assign(this, { cdp, page, origin }); }

  async js(expr, opts = {}) {
    const v = await evaluate(this.cdp, this.page, expr, { awaitPromise: false, timeoutMs: 180_000, ...opts });
    return v;
  }
  /** evaluate an expression that returns an object carrying `origin`; refuse a foreign origin */
  async read(expr, opts = {}) {
    const v = await evaluate(this.cdp, this.page, expr, { timeoutMs: 180_000, ...opts });
    if (!v || v.origin !== this.origin) throw new Error(`probe answered from ${v?.origin ?? 'nowhere'}, expected ${this.origin}: ${JSON.stringify(v).slice(0, 200)}`);
    return v;
  }
  async waitFor(cond, { timeoutMs = 180_000, everyMs = 250, what = cond } = {}) {
    const t0 = Date.now();
    for (;;) {
      const ok = await this.js(`!!(${cond})`).catch(() => false);
      if (ok) return Date.now() - t0;
      if (Date.now() - t0 > timeoutMs) throw new Error(`timed out after ${timeoutMs} ms waiting for ${String(what).slice(0, 160)}`);
      await sleep(everyMs);
    }
  }
  /** centre of the first element the finder expression returns, scrolled into view first */
  async boxOf(finder, { scroll = true } = {}) {
    // the element, scrolled into view, AND the thing a click at its centre would actually hit: a
    // row that exists but sits under another surface (Home stays mounted behind an open session)
    // is not clickable, and a click there would silently land on something else
    const b = await this.read(`(() => {
      const e = (${finder});
      if (!e) return { origin: location.origin, none: true };
      ${scroll ? "e.scrollIntoView({ block: 'center', inline: 'nearest' });" : ''}
      const r = e.getBoundingClientRect();
      const x = r.x + r.width / 2, y = r.y + Math.min(r.height / 2, 20);
      const hit = document.elementFromPoint(x, y);
      const covered = !hit || !(hit === e || e.contains(hit));
      return { origin: location.origin, x, y, w: r.width, h: r.height, covered, hit: hit ? hit.tagName + '.' + String(hit.className).split(' ')[0] : null, text: (e.textContent || '').trim().slice(0, 80) };
    })()`);
    if (b.none || b.w < 1) throw new Error(`no element for ${finder.slice(0, 160)}`);
    if (b.covered) throw new Error(`element covered (a click would hit ${b.hit}): ${finder.slice(0, 160)}`);
    return b;
  }
  async click(b) {
    const { cdp, page } = this;
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: b.x, y: b.y }, page, 180_000);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: b.x, y: b.y, button: 'left', clickCount: 1 }, page, 180_000);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: b.x, y: b.y, button: 'left', clickCount: 1 }, page, 180_000);
  }
  /** two animation frames, so a scrollIntoView has been painted before a timed click */
  async settleFrames() { await this.js(`new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))`, { awaitPromise: true }); }

  // ── finders ──────────────────────────────────────────────────────────────────────────────
  static homeRow(title) { return `[...document.querySelectorAll('.histrow')].find((r) => (r.textContent || '').includes(${JSON.stringify(title)}))`; }
  static railRow(title) { return `[...document.querySelectorAll('.navhistrow')].find((r) => (r.textContent || '').includes(${JSON.stringify(title)}))`; }
  static onThread(title, text) { return `(() => { const t = document.querySelector('.threadpanel .convotitle'); const l = document.querySelector('.convomsgs'); return !!t && t.textContent.includes(${JSON.stringify(title)}) && !!l && (l.textContent || '').includes(${JSON.stringify(text)}); })()`; }

  /** on Home = no session open (Home stays mounted behind one) + the composer and the long-thread row there */
  static homeReady() { return `!document.querySelector('.threadpanel') && !!document.querySelector('.hcomposer textarea') && !!(${App.homeRow(LONG_TITLE)})`; }
  async onHome() { return this.js(App.homeReady()); }
  /** land on Home with the long-thread row in the ledger (the New chat row is Home's door) */
  async ensureHome() {
    // Home must be STABLE, not just present: after a boot the app restores the last open session a
    // moment later, and a click aimed at a Home row then lands on the thread that slid over it
    const t0 = Date.now();
    for (let attempt = 0; attempt < 4; attempt++) {
      if (!(await this.onHome())) {
        const b = await this.boxOf(`document.querySelector('.navnew .navnewrow') || document.querySelector('.navnew')`, { scroll: false });
        await this.click(b);
        await this.waitFor(App.homeReady(), { timeoutMs: 180_000, what: 'Home with the perf-lab row, no session open' });
      }
      await sleep(1500);
      if (await this.onHome()) return Date.now() - t0;
    }
    throw new Error('Home never stayed on screen for 1.5 s');
  }
  /** the rail lists RECENTS flat (a machine-local preference, persisted in the profile): the
   *  thread → thread journey clicks a rail row, and the grouped PROJECTS face folds rows away */
  /** document-start script: the rail's Recents preference (the app's own `nm:navView` key), set
   *  only when the profile has none, so a person's choice in a kept profile is never overwritten */
  static railRecentsPrefSource(port) {
    return `(() => { if (location.port !== ${JSON.stringify(String(port))}) return; try { if (!localStorage.getItem('nm:navView')) localStorage.setItem('nm:navView', 'recents'); } catch (e) {} })();`;
  }
  async ensureRailRecents() {
    const on = await this.js(`!![...document.querySelectorAll('.navgrphdlbl')].find((b) => /recents/i.test(b.textContent || '') && b.classList.contains('on'))`);
    if (on) return false;
    const b = await this.boxOf(`[...document.querySelectorAll('.navgrphdlbl')].find((b) => /recents/i.test(b.textContent || ''))`, { scroll: false });
    await this.click(b);
    await this.waitFor(`!![...document.querySelectorAll('.navgrphdlbl')].find((b) => /recents/i.test(b.textContent || '') && b.classList.contains('on'))`, { timeoutMs: 30_000, what: 'the rail on Recents' });
    return true;
  }
  /** make a rail row exist: Recents shows the newest rows in steps, so press `Show n more`
   *  (untimed setup) until the row is there, or say it never came */
  async revealRailRow(title, maxPages = 20) {
    for (let k = 0; k < maxPages; k++) {
      if (await this.js(`!!(${App.railRow(title)})`)) return k;
      const more = await this.js(`!!document.querySelector('.navhist .navgrpmore.flat')`);
      if (!more) break;
      await this.click(await this.boxOf(`document.querySelector('.navhist .navgrpmore.flat')`));
      await sleep(400);
    }
    if (await this.js(`!!(${App.railRow(title)})`)) return maxPages;
    throw new Error(`the rail never showed a row for "${title}"`);
  }
  /** the thread's scroll container: .convomsgs or its nearest scrollable ancestor */
  static scrollerJs() {
    return `(() => { let e = document.querySelector('.convomsgs'); while (e && !(e.scrollHeight > e.clientHeight + 10 && /auto|scroll/.test(getComputedStyle(e).overflowY))) e = e.parentElement; return e; })()`;
  }
  /** the scroller's state, and the point the wheel is sent to: the scroller's LEFT GUTTER (outside
   *  the centred message column), because a wheel gesture latches to the innermost scroller under
   *  the pointer, and a code block or table that scrolls on its own would swallow a steady wheel
   *  (seen: the thread stopped at the same scrollTop every run). `hitIsScroller` says whether the
   *  point really lands on the scroller itself. */
  async scrollState() {
    return this.read(`(() => {
      const e = ${App.scrollerJs()};
      if (!e) return { origin: location.origin, none: true };
      const r = e.getBoundingClientRect();
      const col = document.querySelector('.convomsgs > .msg, .convomsgs > *:not(:empty)');
      const cr = col ? col.getBoundingClientRect() : null;
      const x = cr && cr.left - r.left > 40 ? r.left + Math.round((cr.left - r.left) / 2) : r.left + 12;
      const y = r.top + r.height / 2;
      const hit = document.elementFromPoint(x, y);
      return { origin: location.origin, el: e.className, top: Math.round(e.scrollTop), height: e.scrollHeight, client: e.clientHeight, x, y, hitIsScroller: hit === e, hit: hit ? hit.tagName + '.' + String(hit.className).split(' ')[0] : null, msgs: document.querySelector('.convomsgs')?.children.length ?? 0 };
    })()`);
  }
}

/** a realistic ~6 KB agent reply: headings, a 40-line code fence, a table, lists. The HEAD and
 *  TAIL tokens let the reply journey tell "the start is on screen" from "all of it is". */
export function replyBody(token) {
  const code = Array.from({ length: 40 }, (_, i) => {
    const lines = [
      `export async function migrateRoom(db: Db, room: RoomId): Promise<MigrationReport> {`,
      `  const started = performance.now();`,
      `  const rows = await db.getAll<MessageRow>('SELECT id, body, created_at FROM messages WHERE channel_id = ?', [room]);`,
      `  let moved = 0;`,
      `  for (const row of rows) {`,
      `    if (!row.body.trim()) continue;`,
      `    await db.execute('UPDATE messages SET body = ? WHERE id = ?', [normalise(row.body), row.id]);`,
      `    moved++;`,
      `  }`,
      `  return { room, moved, ms: Math.round(performance.now() - started) };`,
    ];
    return lines[i % lines.length];
  }).join('\n');
  const rows = [
    ['Freeze the release branch', 'rex', 'Done', 'Branch cut at the tagged commit, CI green on the merge ref'],
    ['Re-snapshot PowerSync', 'george', 'Waiting', 'The new synced table needs the publication and a sync rule'],
    ['Backfill the room index', 'patch', 'Done', 'Ran on the dev stack first, then on production in batches of 500'],
    ['Verify the web boot', 'scout', 'Done', 'The built client reached its first screen in real Chrome'],
    ['Publish the desktop draft', 'george', 'Waiting', 'Human-gated, after the backend is live'],
    ['Update the parity ledger', 'plume', 'Done', 'One row closed, one row opened for the phone'],
    ['Roll the cloud machines', 'bosun', 'Waiting', 'On the next release tag, never a short sha'],
    ['Announce the release', 'plume', 'Draft', 'Two posts drafted, both waiting for approval'],
  ];
  return [
    `## ${token}-HEAD Release plan for the web client`,
    '',
    'Here is the full plan for the release. It covers the checklist, the order of the steps, the one migration, and the risks I see. Each step names its owner. The two steps that wait on you are marked **Waiting**.',
    '',
    '### Checklist',
    '',
    '- [x] Freeze the release branch and tag the commit',
    '- [x] Run the full test suite on the merge ref',
    '- [x] Verify the built web client in real Chrome',
    '- [ ] Re-snapshot PowerSync after the deploy',
    '- [ ] Publish the desktop draft in the releases repository',
    '- [ ] Close the parity ledger row in the version bump PR',
    '',
    '### Steps and owners',
    '',
    '| Step | Owner | Status | Notes |',
    '|---|---|---|---|',
    ...rows.map((r) => `| ${r.join(' | ')} |`),
    '',
    '### The migration',
    '',
    'The room index backfill ran as the function below. It is idempotent, so a second run moves nothing.',
    '',
    '```ts',
    code,
    '```',
    '',
    '### Risks',
    '',
    '1. The PowerSync re-snapshot can take up to ten minutes on production. Clients keep their local replica during it, so reads stay available.',
    '2. The desktop draft must not be published before the control-api image exists, or the new desktop pulls an image that is not there.',
    '3. A client that runs an old build keeps working. The new column is additive and old clients ignore it.',
    '4. The backfill holds a row lock for each batch of 500. On production that is under 40 ms a batch, so no user write waits on it long enough to notice.',
    '5. The web client caches its assets by content hash. A member who keeps a tab open for days gets the new build on the next reload, and the old tab keeps working until then.',
    '6. The sync rule change is validated in CI, but that job is advisory. I will read the deploy step result myself, not the check mark.',
    '',
    '### Rollback',
    '',
    'If the web boot check fails after the deploy, the rollback is one step: promote the previous deployment in Vercel. The database migration is additive, so the previous build runs on the new schema without a change. The PowerSync sync rules stay as they are, because the old client ignores the new table.',
    '',
    'If the desktop draft shows a problem before it is published, delete the draft and cut the next patch version. A draft never reaches a user, so there is nothing to roll back on the machines.',
    '',
    '### Notes from the review',
    '',
    '- The reviewer checked the diff against the Definition of Done and found no gap.',
    '- CI passed on the pull request and on the merge ref.',
    '- The migration test covers an empty room, a room with one message, and a room with 10,000 messages.',
    '- The new index is partial, so it costs nothing for rooms that never use it.',
    '- The web boot check ran twice, once on each theme, and both screenshots are in the Evidence block.',
    '- The phone app needs no change for this release.',
    '- The parity ledger row for the browser terminal closes in the version bump pull request.',
    '- The release notes are drafted in plain words and wait for your review.',
    '',
    '### What I need from you',
    '',
    '- Approve the release plan in this thread.',
    '- Publish the desktop draft when the backend is live.',
    '',
    `That is the whole plan. I will post the verification report here when the release lands. ${token}-TAIL`,
  ].join('\n');
}
