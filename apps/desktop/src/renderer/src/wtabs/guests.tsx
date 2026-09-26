// The dock's guest panes — the capped mini-browser (docs/21) and the per-task terminal.
// Extracted from App.tsx (track A4).
import { IconArrowL, IconArrowR, IconClose, IconExternal, IconGlobe, IconResend } from '../ui/icons';
import { forwardRef, lazy, Suspense, useEffect, useRef, useState } from 'react';
import { nm as nmBridge } from '../bridge/nm';
import { NM_PLATFORM } from '../lib/platform';
import { normalizeUrlInput } from '@neuramesh/shared';

// Imported bindings lose control-flow narrowing inside closures, so re-bind (same as App.tsx).
const nm = nmBridge;

export const WhiteboardView = lazy(() => import('../WhiteboardView'));

// xterm-backed terminal scoped to the task's retained local workspace (run
// tier). Local-only — only the machine that ran the task has the workspace.
export interface TermHandle { fit: () => void }
export type TerminalProps = { taskNumber?: number; hasRepo?: boolean; cwd: string | null; cwdRoot?: string; startupCommand?: string; onPty?: (subId: string) => void; onUpgrade?: () => void };

// The body lives in ./terminal: xterm is the largest thing the App chunk carried (322 KB of 1.46 MB),
// and no first screen shows a terminal. The Suspense sits here, so every caller keeps rendering
// <TerminalView> as before, and the pane reads empty for the moment the chunk takes to arrive.
const LazyTerminal = lazy(() => import('./terminal'));
export const TerminalView = forwardRef<TermHandle, TerminalProps>(function TerminalView(props, ref) {
  return (
    <Suspense fallback={<div className="termwrap" />}>
      <LazyTerminal ref={ref} {...props} />
    </Suspense>
  );
});

// ── Dock mini-browser (docs/21): one page per tab inside a capped <webview> guest ──
// The pane is plain UI; every hard limit (schemes, popups, preload-stripping) lives
// main-side (browser-guard.ts). Off the real bridge (the :5199 preview harness, whose
// mock reports electron:'preview') it degrades to a sandboxed <iframe> so the harness
// stays screenshotable — a user-agent sniff would false-positive inside any
// Electron-hosted browser pane, so the bridge is the ground truth.
export const IS_ELECTRON = NM_PLATFORM === 'electron';

export type WebviewEl = HTMLElement & {
  loadURL(url: string): Promise<void>; reload(): void; stop(): void;
  goBack(): void; goForward(): void; canGoBack(): boolean; canGoForward(): boolean; getURL(): string;
};

export function BrowserPane({ url, onNavigate, onTitle }: {
  url?: string; onNavigate: (url: string) => void; onTitle: (title: string) => void;
}) {
  const [input, setInput] = useState(url ?? '');
  // `page` mounts the guest; later commits go through loadURL so the guest keeps its
  // history for back/forward — re-renders must never rewrite the src attribute (each
  // rewrite is a fresh load: the classic webview src-reflection trap).
  const [page, setPage] = useState<{ key: number; src: string } | null>(url ? { key: 0, src: url } : null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [nav, setNav] = useState({ back: false, fwd: false });
  const view = useRef<WebviewEl | null>(null);
  const ready = useRef(false);
  const lastUrl = useRef<string | null>(url ?? null); // committed location (the guest navigates past page.src)
  const urlFocused = useRef(false); // while the user is typing, navigation events don't clobber the field

  const go = (raw: string) => {
    const next = normalizeUrlInput(raw);
    if (!next) return;
    setFailed(null); setInput(next); lastUrl.current = next; onNavigate(next);
    try { onTitle(new URL(next).host || 'Browser'); } catch { /* provisional title until the page reports one */ }
    const el = view.current;
    if (el && ready.current && IS_ELECTRON) void el.loadURL(next).catch(() => { /* guest torn down mid-call */ });
    else setPage((p) => ({ key: (p?.key ?? 0) + 1, src: next })); // first page, or the guest isn't attached yet
  };

  useEffect(() => {
    const el = view.current;
    if (!el || !IS_ELECTRON) return;
    ready.current = false;
    const syncNav = () => { try { setNav({ back: el.canGoBack(), fwd: el.canGoForward() }); } catch { /* detaching */ } };
    const onReady = () => { ready.current = true; syncNav(); };
    const onStart = () => { setLoading(true); setFailed(null); };
    const onStop = () => { setLoading(false); syncNav(); };
    const onNavd = (e: Event) => {
      const u = (e as Event & { url?: string }).url;
      if (!u) return;
      lastUrl.current = u;
      if (!urlFocused.current) setInput(u);
      onNavigate(u); syncNav();
    };
    const onTtl = (e: Event) => { const t = (e as Event & { title?: string }).title; if (t) onTitle(t); };
    const onFail = (e: Event) => {
      const f = e as Event & { errorCode?: number; errorDescription?: string; isMainFrame?: boolean };
      if (f.isMainFrame === false || f.errorCode === -3) return; // subframes; -3 = aborted (stop, or a redirect race)
      setLoading(false); setFailed((f.errorDescription || 'ERR_FAILED').replace(/^ERR_/, '').replace(/_/g, ' ').toLowerCase());
    };
    el.addEventListener('dom-ready', onReady);
    el.addEventListener('did-start-loading', onStart);
    el.addEventListener('did-stop-loading', onStop);
    el.addEventListener('did-navigate', onNavd);
    el.addEventListener('did-navigate-in-page', onNavd);
    el.addEventListener('page-title-updated', onTtl);
    el.addEventListener('did-fail-load', onFail);
    return () => {
      ready.current = false;
      el.removeEventListener('dom-ready', onReady);
      el.removeEventListener('did-start-loading', onStart);
      el.removeEventListener('did-stop-loading', onStop);
      el.removeEventListener('did-navigate', onNavd);
      el.removeEventListener('did-navigate-in-page', onNavd);
      el.removeEventListener('page-title-updated', onTtl);
      el.removeEventListener('did-fail-load', onFail);
    };
  }, [page?.key]);

  const act = (f: (el: WebviewEl) => void) => { const el = view.current; if (el && ready.current) { try { f(el); } catch { /* detaching */ } } };
  const openExternal = () => { const u = lastUrl.current ?? page?.src; if (u) void nm?.openExternal(u); };
  return (
    <div className="bwwrap">
      <div className="bwbar">
        <span className="bwnav">
          <button className="bwbtn" disabled={!nav.back} onClick={() => act((el) => el.goBack())} title="Back" aria-label="Back"><IconArrowL s={13} /></button>
          <button className="bwbtn" disabled={!nav.fwd} onClick={() => act((el) => el.goForward())} title="Forward" aria-label="Forward"><IconArrowR s={13} /></button>
          {loading
            ? <button className="bwbtn" onClick={() => act((el) => el.stop())} title="Stop loading" aria-label="Stop loading"><IconClose s={12} /></button>
            : <button className="bwbtn" disabled={!page} onClick={() => act((el) => el.reload())} title="Reload" aria-label="Reload"><IconResend s={12} /></button>}
        </span>
        <input
          className="bwurl" type="text" value={input} placeholder="Enter a URL — or search"
          autoFocus={!page} spellCheck={false} autoCapitalize="off" autoCorrect="off"
          onChange={(e) => setInput(e.target.value)}
          onFocus={(e) => { urlFocused.current = true; e.target.select(); }}
          onBlur={() => { urlFocused.current = false; if (!input.trim() && lastUrl.current) setInput(lastUrl.current); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { go(input); e.currentTarget.blur(); } else if (e.key === 'Escape') e.currentTarget.blur(); }}
        />
        <button className="bwbtn" disabled={!page} onClick={openExternal} title="Open in your default browser" aria-label="Open in your default browser"><IconExternal s={13} /></button>
      </div>
      {!IS_ELECTRON && page && (
        // harness-only honesty strip: an iframe is NOT the product experience — sites that
        // forbid embedding (X-Frame-Options/CSP) refuse to render in it, while the desktop
        // app's <webview> is top-level browsing and shows them fine
        <div className="bwnote">Preview-harness rendering — sites that forbid embedding won’t display here; the desktop app browses them in a real Chromium view.</div>
      )}
      <div className="bwbody">
        {loading && <span className="bwprog" aria-hidden />}
        {!page && (
          <div className="bwempty">
            <span className="bwemptyico"><IconGlobe s={26} /></span>
            <p>Preview a dev server, open a PR, read docs — enter a URL above to start.</p>
          </div>
        )}
        {page && (IS_ELECTRON
          // allowpopups must land as a string: React DROPS unknown attributes valued boolean-true
          // (shot log: allowpopups=false), and Electron only checks the attribute's presence
          ? <webview key={page.key} ref={(el) => { view.current = el as unknown as WebviewEl | null; }} className="bwview" src={page.src} partition="persist:nm-browser" allowpopups={'' as unknown as boolean} />
          : <iframe key={page.key} className="bwview" src={page.src} sandbox="allow-scripts allow-forms allow-same-origin allow-popups" title="mini browser" />)}
        {failed && <div className="bwerr">{failed} — <button className="bwerrbtn" onClick={() => { const u = lastUrl.current; if (u) go(u); }}>retry</button></div>}
      </div>
    </div>
  );
}

// ── Workspace tabs (docs/36): ONE content area, many kinds ───────────────────────────────────
// The bottom dock retired into this. Its record already carried kind · cwd · url · pty in one
// flat global array — the right model, living in a strip that an open session painted over
// (§2.1: `.sessionsurf` was an absolute z55 SIBLING of `.main`, so the task panel's own terminal
// pin opened a tab the task immediately buried). Promoted up here the model becomes the content
// area itself: the conversation is tab one, and files, terminals and browsers open BESIDE it.
//
// Every rule the strip promises is decided in `wtabs.ts` and only DRAWN here — the conversation
// refusing to close or leave slot 0, one file being one tab, a read-only artifact never reaching
// Edit. A capability the UI merely hides is still a capability (doctrine §4).

// `newchat` retired 2026-08-16 — it merged back into `dashboard`, which IS the landing now
// (the composer) as well as the state a thread or task mounts over.
export type MainView = 'chat' | 'library' | 'memory' | 'skills' | 'code' | 'dashboard' | 'board' | 'automations' | 'calendar' | 'whiteboards' | 'footprint' | 'compute' | 'marketing' | 'engineering' | 'credits';

/**
 * THE VIEW THE URL IS ASKING FOR, on the web only.
 *
 * Stripe sends a buyer back to neuramesh.app/billing/success, which is the marketing site, not
 * the app — so the confirmation has to hand them somewhere. It links to hq.neuramesh.app with
 * `?view=credits`, and this is the other half: the app opens on the screen that proves the
 * purchase arrived, instead of a dashboard where the buyer has to go hunting for it.
 *
 * DELIBERATELY A ONE-ITEM ALLOW-LIST rather than a cast. A url that could name any MainView
 * would let a link drop someone into an arbitrary surface — harmless today, an open door the
 * moment a view means something. Desktop has no query string, so this is a no-op there.
 */
export function viewFromUrl(): MainView | null {
  try {
    return new URLSearchParams(window.location.search).get('view') === 'credits' ? 'credits' : null;
  } catch {
    return null; // no window (tests, ssr) — the caller's default stands
  }
}
