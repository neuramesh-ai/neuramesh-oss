// The dock's guest panes — the capped mini-browser (docs/21) and the per-task terminal.
// Extracted from App.tsx (track A4).
import { FitAddon } from '@xterm/addon-fit';
import { IconArrowL, IconArrowR, IconClose, IconExternal, IconGlobe, IconResend } from '../ui/icons';
import { Terminal as XTerm } from '@xterm/xterm';
import { forwardRef, lazy, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { nm as nmBridge } from '../bridge/nm';
import { NM_PLATFORM } from '../lib/platform';
import { normalizeUrlInput } from '@neuramesh/shared';
import { MachineBoot } from '../compute/MachineBoot';

// Imported bindings lose control-flow narrowing inside closures, so re-bind (same as App.tsx).
const nm = nmBridge;

export const WhiteboardView = lazy(() => import('../WhiteboardView'));

// xterm-backed terminal scoped to the task's retained local workspace (run
// tier). Local-only — only the machine that ran the task has the workspace.
export interface TermHandle { fit: () => void }

export const TerminalView = forwardRef<TermHandle, { taskNumber?: number; hasRepo?: boolean; cwd: string | null; cwdRoot?: string; startupCommand?: string; onPty?: (subId: string) => void; onUpgrade?: () => void }>(
  function TerminalView({ taskNumber, hasRepo, cwd, cwdRoot, startupCommand, onPty, onUpgrade }, ref) {
  const host = useRef<HTMLDivElement>(null);
  const [exited, setExited] = useState(false);
  // the boot, pane-scoped (docs/design/machine-autowake-2026-08). null on desktop, where the
  // terminal is local and there is no machine to wait for.
  const [boot, setBoot] = useState<{ phase: 'starting' | 'connecting'; since: number } | null>(null);
  const [bootDone, setBootDone] = useState(false);
  // imperative re-fit so the dock can re-sync a terminal after it was hidden,
  // the dock was restored from minimized, or the dock height changed
  const refit = useRef<() => void>(() => {});
  useImperativeHandle(ref, () => ({ fit: () => refit.current() }), []);
  useEffect(() => {
    if (!host.current || !nm) return;
    // xterm needs concrete colors (not var(...)), so the tokens are resolved here rather than in
    // CSS. It wears the MAIN surface, not --code: a terminal is a full surface of the app, and a
    // dark slab inside a cream window reads as a foreign panel rather than as this tab's body.
    // --code stays what it is — the inline code-block token, which is meant to sit under a panel.
    const termTheme = () => {
      const cs = getComputedStyle(document.documentElement);
      const tok = (n: string, f: string) => cs.getPropertyValue(n).trim() || f;
      return {
        background: tok('--panel', '#191919'),
        foreground: tok('--text', '#eaeaea'),
        cursor: tok('--accent', '#e27c62'),
        cursorAccent: tok('--accent-ink', '#101010'),
        selectionBackground: tok('--panel3', '#2b2b2b'),
        // the ANSI-16 ramp is per-theme too (docs/33 §4): xterm's stock palette assumes a dark
        // ground, so on the paper themes its whites and dims rendered cream-on-cream.
        black: tok('--term-black', '#2e2e2e'),
        red: tok('--term-red', '#c98f8f'),
        green: tok('--term-green', '#77ac8d'),
        yellow: tok('--term-yellow', '#c9a15e'),
        blue: tok('--term-blue', '#8ba0c0'),
        magenta: tok('--term-magenta', '#cc8fb9'),
        cyan: tok('--term-cyan', '#6fb0ab'),
        white: tok('--term-white', '#b6b6b6'),
        brightBlack: tok('--term-bright-black', '#808080'),
        brightRed: tok('--term-bright-red', '#d9a8a8'),
        brightGreen: tok('--term-bright-green', '#93c7a9'),
        brightYellow: tok('--term-bright-yellow', '#d9b87e'),
        brightBlue: tok('--term-bright-blue', '#a7bcda'),
        brightMagenta: tok('--term-bright-magenta', '#ddaacb'),
        brightCyan: tok('--term-bright-cyan', '#8fc7c2'),
        brightWhite: tok('--term-bright-white', '#eaeaea'),
      };
    };
    const term = new XTerm({
      fontSize: 12,
      fontFamily: "'Geist Mono Variable', ui-monospace, Menlo, monospace",
      theme: termTheme(),
      cursorBlink: true,
      // a guest app styles for the theme IT believes in — Claude Code set to dark paints 24-bit
      // greys no light palette entry can remap, and they vanished into the paper themes. The
      // floor (WCAG AA, VS Code's terminal default) keeps any guest output readable in both.
      minimumContrastRatio: 4.5,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host.current);
    // fit must run AFTER the container is laid out, or it computes 0 rows and
    // the canvas renders black — defer past paint, then open the pty at the
    // real dimensions and re-sync the size
    let handle: { subId: string; input: (d: string) => void; resize: (c: number, r: number) => void; close: () => void } | null = null;
    const onResize = () => { try { fit.fit(); handle?.resize(term.cols, term.rows); } catch { /* closing */ } };
    refit.current = () => { onResize(); try { term.focus(); } catch { /* disposed */ } };
    // a person who navigates away has cancelled their WAIT, never the machine — the wake stands
    // and the work queues. This only stops us resolving into a pane nobody is looking at.
    let gone = false;
    const open = () => {
      const onExit = () => { setExited(true); term.write('\r\n\x1b[2m[process exited]\x1b[0m\r\n'); };
      handle = taskNumber != null
        ? nm!.openTerminal(taskNumber, hasRepo ?? false, term.cols, term.rows, (d) => term.write(d), onExit)
        : nm!.openTerminalCwd(cwdRoot ?? '', term.cols, term.rows, (d) => term.write(d), onExit, startupCommand); // '' → $HOME (clean default)
      onPty?.(handle.subId); // report the pty id so the dock can name + close this terminal from the process tracker
      term.onData((d) => handle?.input(d));
      term.focus();
    };
    const start = async () => {
      try { fit.fit(); } catch { /* not laid out yet */ }
      // WEB ONLY: make sure there IS an awake machine before opening a pty against it. Undefined
      // on desktop, where the shell is local — so this whole branch costs nothing there.
      if (nm?.machineEnsure) {
        setBoot({ phase: 'starting', since: Date.now() });
        const res = await nm.machineEnsure(
          (phase) => setBoot((b) => (b ? { ...b, phase } : b)),
          () => gone,
          taskNumber != null ? 'task' : 'shell',
        );
        if (gone) return;
        if (!res.ok) {
          setBoot(null);
          // cancelled means they left; anything else is a reason they should see IN the pane,
          // because an empty terminal reads as a hung shell (the rule webnm-local.ts set)
          if (res.reason !== 'cancelled') {
            term.write(`\r\n\x1b[33mnm:\x1b[0m \x1b[2m${res.detail}\x1b[0m\r\n`);
            setExited(true);
          }
          return;
        }
        // the fade is the handover — the boot dissolves into the prompt behind it
        setBootDone(true);
        setTimeout(() => { if (!gone) setBoot(null); }, 450);
      }
      open();
    };
    const raf = requestAnimationFrame(() => setTimeout(() => { void start(); }, 30));
    window.addEventListener('resize', onResize);
    const ro = new ResizeObserver(onResize);
    ro.observe(host.current);
    // a mount-time read freezes the palette: switch theme with a terminal open and it keeps the
    // colours of the theme it was born in. data-theme is the one signal the whole app themes off.
    const themeWatch = new MutationObserver(() => { try { term.options.theme = termTheme(); } catch { /* disposed */ } });
    themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => { gone = true; cancelAnimationFrame(raf); window.removeEventListener('resize', onResize); ro.disconnect(); themeWatch.disconnect(); handle?.close(); term.dispose(); refit.current = () => {}; };
  }, [taskNumber, cwdRoot]);
  return (
    <div className="termwrap">
      <div className="termbar"><span className="termbarcwd">{cwd ? cwd.replace(/^\/Users\/[^/]+/, '~') : (taskNumber != null ? `task #${taskNumber} · worktree` : '~/.neuramesh')}{exited ? ' · exited (closed)' : ''}</span></div>
      <div className="termhost" ref={host} />
      {boot && <MachineBoot phase={boot.phase} since={boot.since} done={bootDone} onUpgrade={onUpgrade} />}
    </div>
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
