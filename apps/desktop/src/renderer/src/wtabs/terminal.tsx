// The per-task terminal (xterm), split out of guests.tsx so xterm (322 KB) and its CSS load when a
// terminal first opens, not with the App chunk every visit pays for. guests.tsx exports the lazy
// wrapper every caller already imports; this module is its body, unchanged.
import '@xterm/xterm/css/xterm.css';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal as XTerm } from '@xterm/xterm';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { nm as nmBridge } from '../bridge/nm';
import { MachineBoot } from '../compute/MachineBoot';
import type { TermHandle, TerminalProps } from './guests';

// Imported bindings lose control-flow narrowing inside closures, so re-bind (same as App.tsx).
const nm = nmBridge;

// xterm-backed terminal scoped to the task's retained local workspace (run
// tier). Local-only — only the machine that ran the task has the workspace.
const TerminalView = forwardRef<TermHandle, TerminalProps>(
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

export default TerminalView;
