// WHAT A BROWSER GENUINELY CANNOT DO — answered honestly, rather than left to the fallback.
//
// These are MACHINE-local capabilities: a shell, a checkout, a filesystem, a native file picker,
// the daemon's own log store, this host's disk. A browser tab has none of them. They reach a
// machine only through nm-relay, which is not deployed yet (the relay's transport exists in
// packages/relay; the in-cluster Deployment and the browser terminal client do not).
//
// WHY ANSWER AT ALL, INSTEAD OF LEAVING THEM UNWIRED. The unwired fallback resolves an empty
// array-like — an object, and therefore TRUTHY. For a read that gets iterated that is harmless.
// For a read whose truthiness gates UI it is not: `machineLimitInfo` left unwired put a blocking
// "this workspace is on another machine" modal in front of every browser user, and a truthy
// `terminalInfo().available` handed the task view a cwd that does not exist. An honest `false`,
// `null` or `{ error }` lets each surface render its own real "not here" state, which it already
// knows how to do — every one of these shapes is one the desktop can return too.
//
// So this file is not a stub layer. It is the difference between a surface that says "no shell in
// the browser" and one that silently pretends to have opened you a terminal.
//
// WHEN THE RELAY LANDS, these are the call sites to replace — that is the point of keeping them
// in one file with one reason written down, rather than scattering `?? null` through the shell.
import type { NMBridge } from '../src/bridge/nm';

/** a handle that is already closed. openTerminal's contract is a LIVE pty; the honest browser
 *  answer is one whose onExit has already fired, so the surface tears down instead of waiting for
 *  bytes that cannot come. `subId` is the daemon's process key — there is no process, so it is ''. */
/** what the pane prints instead of a prompt. \r\n because a pty speaks CRLF, and the surface
 *  feeds these bytes straight to the terminal emulator. */
const NO_SHELL = [
  '\r\n  No shell here.\r\n\r\n',
  '  A terminal runs on a MACHINE, and this is a browser tab.\r\n',
  '  Open this workspace in the desktop app to get a shell.\r\n\r\n',
].join('');

const deadPty = () => ({ subId: '', input: () => {}, resize: () => {}, close: () => {} });

/** the shape every machine-shaped read degrades to: a named refusal, never a fake success */
const NO_MACHINE = 'not available in the browser — this needs a machine, which reaches you through nm-relay';

export function localOverrides(): Partial<NMBridge> {
  return {
    engineeringInfo: async () => ({ available: false, reason: 'Engineering requires an available workspace cloud machine.' }),
    /**
     * NULL, and it must be an explicit null rather than an unwired lane.
     *
     * The machine limit is a DESKTOP idea — "you signed into this workspace on a second Mac,
     * transfer it or upgrade". A browser is never the workspace's machine; its compute is the
     * cloud runner, which is the whole premise of the web client.
     *
     * Left unwired it returned the fallback's empty, which is an OBJECT and therefore truthy —
     * so `if (m) setMachineLimit(m)` (App.tsx) passed and hq put a blocking modal in front of
     * every browser user saying their workspace was on another machine. It was not. This is the
     * cost of a truthy fallback, paid in the loudest possible place, and the answer is to answer
     * the question rather than let the fallback guess at it.
     */
    machineLimitInfo: async () => null,

    // ── a shell ────────────────────────────────────────────────────────────────────────────
    // the terminal callbacks are how a caller learns the session ended. Calling onExit
    // immediately is the truthful answer: there was never a session. Returning a no-op closer
    // without it would leave the surface waiting for output that can never arrive.
    //
    // But exiting silently is only half honest. The pane then renders an empty terminal, which
    // reads as a shell that simply is not answering — the same ambiguity, one layer up. So the
    // reason is WRITTEN to the pane first: onData is the only channel a terminal has, the
    // surface already prints whatever arrives on it, and a person looking at the pane learns
    // why rather than guessing. Then it exits.
    openTerminal: (_n, _r, _c, _rows, onData, onExit) => { onData(NO_SHELL); onExit(); return deadPty(); },
    openTerminalCwd: (_cwd, _c, _rows, onData, onExit) => { onData(NO_SHELL); onExit(); return deadPty(); },
    // a browser has no worktree and no terminal. `available: false` is the true answer; the
    // fallback's empty made `r.available` truthy and handed the task view a bogus cwd.
    terminalInfo: async () => ({ available: false, cwd: null }),

    // ── a checkout ─────────────────────────────────────────────────────────────────────────
    gitBranches: async () => ({ current: null, branches: [] }),
    gitCheckout: async () => ({ ok: false, error: NO_MACHINE }),

    // ── a filesystem ───────────────────────────────────────────────────────────────────────
    // `error` is part of each contract, so the file tree shows the reason instead of an empty
    // directory — "nothing here" and "nowhere to look" are different states to a reader
    fsList: async () => ({ entries: [], error: NO_MACHINE }),
    fsRead: async () => ({ content: '', error: NO_MACHINE }),
    fsWrite: async () => ({ ok: false, error: NO_MACHINE }),

    // ── native host affordances ────────────────────────────────────────────────────────────
    // null is what "the human cancelled the picker" already means, so every caller handles it
    pickFolder: async () => null,
    saveFileAs: async () => ({ saved: false }),
    projectDetect: async () => null,
    logoDetect: async () => null,

    // the browser IS the external opener — this one is not a degradation, it is the native way
    openExternal: async (url: string) => { window.open(url, '_blank', 'noopener'); },
    openHtml: async (_name: string, content: string) => {
      const url = URL.createObjectURL(new Blob([content], { type: 'text/html' }));
      window.open(url, '_blank', 'noopener');
      // revoke late: revoking before the new context has fetched it yields a blank tab
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    },

    // ── this host's disk and daemon ────────────────────────────────────────────────────────
    // `ready: false` is a REAL state of this contract — the desktop answers it while the sweeper
    // is still measuring — so the footprint card already knows how to draw "no reading yet"
    footprintGet: async () => ({ ready: false as const, history: [] }),
    footprintReclaim: async () => ({ ready: false as const, history: [], snapshot: null }),
    agentLogs: async () => [],
    exportLogs: async () => ({ saved: false }),
    ensureRuntimeCli: async (runtime: string) => ({ ok: false, runtime }),
    processKill: async () => ({ ok: false }),
    watchProcesses: () => () => {},
    watchAgentLogs: () => () => {},

    // the sandbox is a property of a MACHINE's agent host; a browser has no host to sandbox
    sandboxGet: async () => ({ enabled: false, envForced: false }),
    sandboxSet: async () => ({ ok: false }),

    // ── the self-updater ───────────────────────────────────────────────────────────────────
    // a browser tab IS always the deployed version — there is nothing to check, download or
    // install. bootOverrides already pins updateState to 'idle' forever; these are the three
    // buttons that would otherwise sit behind it, and `{ ok: false }` is a shape the desktop
    // returns too, so the update card renders its own failed state rather than a fake success.
    updateCheck: async () => ({ ok: false }),
    updateDownload: async () => ({ ok: false }),
    updateInstall: async () => ({ ok: false }),

    // ── main-process event feeds ───────────────────────────────────────────────────────────
    // these are pushes FROM the daemon: a deep link opening a thread, and the capacity-failover
    // plan-limit notice. A page has no main process to hear from, so the honest answer is a
    // subscription that never fires — and, critically, an unsubscribe that is callable, because
    // every caller runs it on unmount and a missing one throws on the way out.
    onOpenThread: () => () => {},
    onPlanLimit: () => () => {},

    // ── uploads and media ──────────────────────────────────────────────────────────────────
    // fileUpload opens a NATIVE picker on desktop. The browser's own upload path is the
    // composer's attach control, which does not come through this lane.
    fileUpload: async () => ({ ok: false, added: 0, skipped: [] }),
    // mediaPreview intentionally NOT here — webnm-content.ts probes the image and answers for real, which beats a blanket null
  };
}
