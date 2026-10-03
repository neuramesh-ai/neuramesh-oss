// the agents' browser tools (models-and-replies round, board C3): web_open, web_read, web_click,
// web_type and web_screenshot. one implementation behind every registry that offers them (the
// orchestrator's, the conversation's, the worker bus and its Claude clones), as host/searchx.ts is
// for search_x. they drive the agents' browser only (service.ts withAgentPage): no call here can
// reach a person's browser or its sign-ins, because no call here asks for one.
//
// every answer says plainly what happened, a refused address and a site that blocked the visit
// included, because a model told nothing fills the gap with a guess.
import type { LogFn } from '../agentlog';
import { checkUrl } from './address-guard';
import { browserService } from './registry';
import type { BrowserPage } from './page';
import type { BrowserService } from './service';

export interface WebTools {
  open(i: { url: string }): Promise<string>;
  read(i?: { from?: number }): Promise<string>;
  click(i: { text?: string; selector?: string }): Promise<string>;
  type(i: { selector: string; text: string; submit?: boolean }): Promise<string>;
  screenshot(i: { name?: string }): Promise<string>;
}

export interface WebToolCtx {
  agentName: string;
  log?: LogFn;
  /** save a picture through the turn's own artifact path: the saved name, or null when it failed */
  attach(image: Buffer, name: string, mime: string): Promise<string | null>;
  /** where a saved picture shows, said to the model: "The person sees it in this thread." */
  savedWhere: string;
}

export const WEB_TEXT_BUDGET = 12_000;
const LOAD_MS = 20_000;
// the statuses a site answers a visit it will not serve: a sign-in wall, a bot wall, a rate limit
const BLOCKING = new Set([401, 403, 407, 429, 451, 503]);
const NO_PAGE = 'No page is open. Open one with web_open first.';

// page scripts are plain strings: a compiled function's text can carry the compiler's helpers,
// which do not exist inside the page
const READ = String.raw`(() => { const root = document.querySelector('main, article, [role=main]') || document.body; return { title: document.title, url: location.href, text: root ? root.innerText : '' }; })()`;
const FIND = String.raw`(arg) => {
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const shown = (el) => { const r = el.getBoundingClientRect(); const st = getComputedStyle(el); return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none'; };
  const name = (el) => el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('title') || '';
  let el = null;
  if (arg.selector) { try { el = document.querySelector(arg.selector); } catch (e) { return { error: 'selector' }; } }
  else {
    const want = norm(arg.text);
    const all = Array.from(document.querySelectorAll('a, button, input[type=submit], input[type=button], [role=button], [role=link], [role=tab], [role=menuitem], [role=option], summary, label')).filter(shown);
    el = all.find((e) => norm(name(e)) === want) || all.find((e) => norm(name(e)).startsWith(want)) || all.find((e) => norm(name(e)).includes(want)) || null;
  }
  if (!el) return null;
  el.scrollIntoView({ block: 'center', inline: 'center' });
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, label: String(name(el) || el.tagName).replace(/\s+/g, ' ').trim().slice(0, 80) };
}`;
const FOCUS = String.raw`(sel) => {
  let el = null;
  try { el = document.querySelector(sel); } catch (e) { return 'selector'; }
  if (!el) return 'missing';
  el.scrollIntoView({ block: 'center' });
  el.focus();
  if (typeof el.select === 'function') el.select();
  else if (el.isContentEditable) { const range = document.createRange(); range.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(range); }
  return document.activeElement === el ? 'ok' : 'unfocused';
}`;

const refusedText = (reason: string): string => `The address was refused: ${reason}. NeuraMesh opens only public web addresses. Do not try to reach it another way.`;

/** the page's readable text from character `from`, cut at the budget, with its title and address */
export async function pageText(page: BrowserPage, from = 0): Promise<string> {
  const r = await page.evaluate<{ title: string; url: string; text: string }>(READ);
  if (!r) return 'The page could not be read.';
  const text = String(r.text).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const part = text.slice(from, from + WEB_TEXT_BUDGET);
  const next = from + WEB_TEXT_BUDGET;
  const tail = next < text.length ? `\n\n(The text stops at character ${next.toLocaleString('en-US')} of ${text.length.toLocaleString('en-US')}. Call web_read with from ${next} for more.)` : '';
  return `Title: ${r.title || 'Untitled'}\nAddress: ${r.url}\n\n${part || (from ? '(Nothing more: the text ends before that character.)' : '(The page shows no text.)')}${tail}`;
}

export function webToolsFor(ctx: WebToolCtx, svc: BrowserService | null = browserService()): WebTools | undefined {
  if (!svc) return undefined;
  const { agentName, log, attach, savedWhere } = ctx;
  const say = (summary: string, warn = false): void => log?.({ kind: 'tool', phase: warn ? 'result' : 'call', summary, ...(warn ? { level: 'warn' as const } : {}) });
  /** what the newest load means, when it was not a page: a refusal by the proxy, a site's wall */
  const blocked = (page: BrowserPage): string | null => {
    if (page.doc?.refused) return refusedText(page.doc.refused);
    if (page.doc && BLOCKING.has(page.doc.status)) return `The site blocked the visit (HTTP ${page.doc.status}). Tell the person, and use another source. Do not retry this site in a loop.`;
    return null;
  };
  const failed = (reason: string): string => {
    const refusal = svc.lastRefusal();
    return refusal && Date.now() - refusal.at < 15_000 ? `The page did not open. ${refusedText(refusal.reason)}` : `The page did not open: ${reason}.`;
  };
  /** after a click or an enter: wait for a navigation that starts, never for one that does not */
  const afterInput = async (page: BrowserPage): Promise<string | null> => {
    if (!(await page.loadingWithin(800))) return null;
    page.doc = null;
    await page.settled(LOAD_MS);
    return blocked(page);
  };
  const where = (page: BrowserPage): string => `The page is now "${page.state.title || 'Untitled'}" at ${page.state.url}.`;
  const onPage = async (fn: (page: BrowserPage) => Promise<string>): Promise<string> => {
    const live = svc.agentPage();
    if (!live || live.state.url === 'about:blank') return NO_PAGE;
    return svc.withAgentPage(agentName, fn).catch((e: unknown) => `The browser failed: ${e instanceof Error ? e.message : String(e)}.`);
  };

  return {
    async open({ url }) {
      say(`web_open ${url.slice(0, 80)}`);
      const v = checkUrl(/^[a-z][a-z0-9+.-]*:/i.test(url.trim()) ? url.trim() : `https://${url.trim()}`);
      const r = v.ok ? await svc.allowed(v.url.hostname) : v;
      if (!v.ok || !r.ok) { const reason = !v.ok ? v.reason : !r.ok ? r.reason : ''; say(`web_open refused: ${reason}`, true); return refusedText(reason); }
      return svc.withAgentPage(agentName, async (page) => {
        const nav = await page.navigate(v.url.href, LOAD_MS);
        if (!nav.ok) { say(`web_open failed: ${nav.reason}`, true); return failed(nav.reason); }
        const wall = blocked(page);
        if (wall) { say(`web_open blocked: HTTP ${page.doc?.status ?? '?'}`, true); return wall; }
        return pageText(page);
      }).catch((e: unknown) => `The browser failed: ${e instanceof Error ? e.message : String(e)}.`);
    },

    read(i) { say(`web_read${i?.from ? ` from ${i.from}` : ''}`); return onPage((page) => pageText(page, i?.from ?? 0)); },

    click({ text, selector }) {
      say(`web_click ${(selector ?? text ?? '').slice(0, 80)}`);
      if (!text && !selector) return Promise.resolve('Give the visible text of the element, or a CSS selector.');
      return onPage(async (page) => {
        const hit = await page.evaluate<{ x: number; y: number; label: string } | { error: string } | null>(`(${FIND})(${JSON.stringify({ text: text ?? null, selector: selector ?? null })})`);
        if (!hit) return `No element matches ${selector ? `the selector ${selector}` : `the text "${text}"`}. Read the page with web_read, then use the exact visible text or a CSS selector.`;
        if ('error' in hit) return `The selector ${selector} is not valid CSS.`;
        await page.mouse('move', hit.x, hit.y);
        await page.mouse('down', hit.x, hit.y, 'left', 1);
        await page.mouse('up', hit.x, hit.y, 'left', 1);
        return (await afterInput(page)) ?? `Clicked "${hit.label}". ${where(page)}`;
      });
    },

    type({ selector, text, submit }) {
      say(`web_type ${selector.slice(0, 80)}${submit ? ' + Enter' : ''}`); // never the text: it may be a person's data
      return onPage(async (page) => {
        const r = await page.evaluate<string>(`(${FOCUS})(${JSON.stringify(selector)})`);
        if (r === 'selector') return `The selector ${selector} is not valid CSS.`;
        if (r !== 'ok') return `No field matches the selector ${selector}. Read the page with web_read first.`;
        await page.insertText(text);
        if (!submit) return `Typed into ${selector}.`;
        await page.key('down', 'Enter', 'Enter', 13);
        await page.key('up', 'Enter', 'Enter', 13);
        return (await afterInput(page)) ?? `Typed into ${selector} and pressed Enter. ${where(page)}`;
      });
    },

    screenshot({ name }) {
      say(`web_screenshot${name ? ` ${name.slice(0, 60)}` : ''}`);
      return onPage(async (page) => {
        const shot = await page.screenshot();
        const base = (name ?? 'page').replace(/\.(png|jpe?g)$/i, '').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^[-.]+/, '').slice(0, 60) || 'page';
        const saved = await attach(shot.data, `${base}.${shot.mime === 'image/png' ? 'png' : 'jpg'}`, shot.mime);
        return saved ? `Saved the screenshot as ${saved}. ${savedWhere}` : 'The screenshot did not save. Say so plainly.';
      });
    },
  };
}
