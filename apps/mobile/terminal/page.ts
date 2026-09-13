// THE TERMINAL PAGE (the mobile-cloud round S8, D11): what runs INSIDE the phone's WebView — an
// xterm.js emulator wired to the same relay client the browser and the desktop dial (docs/42),
// bundled by scripts/build-mobile-terminal.mjs into src/terminal-html.ts. The WebView owns its own
// socket: this page is the second edge on the phone (Code's lane in relay.ts is the first), and
// that is said out loud rather than hidden behind a bridge that would re-encode every byte.
//
// The contract with the React Native side is four messages in and three out, all JSON:
//   in  · open {relayUrl, bearer, machineId, theme}  · input {data}  · resize  · close
//   out · ready  · exit {reason?}  · title {text}  · log {text}   (log goes to Metro, dev only)
// A refusal is a sentence in the pane (the package's `notice`), never an empty black box.
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { notice, openRelayPty, type PtyHandle } from '@neuramesh/relay-client';

interface ThemeIn { bg: string; fg: string; dim: string; cursor: string; selection: string }
type In =
  | { type: 'open'; relayUrl: string; bearer: string | null; machineId: string | null; theme: ThemeIn }
  | { type: 'input'; data: string }
  | { type: 'resize' }
  | { type: 'close' };

declare global {
  interface Window { ReactNativeWebView?: { postMessage(s: string): void } }
}

const post = (m: Record<string, unknown>): void => { window.ReactNativeWebView?.postMessage(JSON.stringify(m)); };
// a page that fails silently inside a WebView is the exact ambiguity docs/42 forbids: every throw
// reaches Metro as a line, and the pane still gets its sentence
window.addEventListener('error', (e) => post({ type: 'log', text: `error: ${e.message}` }));
window.addEventListener('unhandledrejection', (e) => post({ type: 'log', text: `rejected: ${String((e as PromiseRejectionEvent).reason)}` }));

const term = new Terminal({
  cursorBlink: true, fontSize: 12.5, lineHeight: 1.25, scrollback: 3000, allowProposedApi: true,
  fontFamily: '"Geist Mono", ui-monospace, Menlo, monospace',
});
const fit = new FitAddon();
term.loadAddon(fit);
const host = document.getElementById('term') as HTMLElement;
term.open(host);

let pty: PtyHandle | null = null;
let bearer: string | null = null;

const refit = (): void => {
  try { fit.fit(); } catch { /* not laid out yet */ }
  if (pty) pty.resize(term.cols, term.rows);
};
window.addEventListener('resize', refit);

function applyTheme(t: ThemeIn): void {
  term.options.theme = { background: t.bg, foreground: t.fg, cursor: t.cursor, cursorAccent: t.bg, selectionBackground: t.selection, brightBlack: t.dim };
  document.body.style.background = t.bg;
}

function open(m: Extract<In, { type: 'open' }>): void {
  applyTheme(m.theme);
  refit();
  bearer = m.bearer;
  if (!m.relayUrl) { term.write(notice('No relay on this build. Open a terminal on a computer instead.')); post({ type: 'exit', reason: 'no-relay' }); return; }
  post({ type: 'log', text: `dialing ${m.relayUrl} machine=${m.machineId ?? 'none'} cols=${term.cols}x${term.rows}` });
  pty = openRelayPty(
    { relayUrl: m.relayUrl, clientBearer: async () => bearer, machineId: async () => m.machineId },
    { cols: term.cols, rows: term.rows, onData: (d) => term.write(d), onExit: () => { pty = null; post({ type: 'exit' }); } },
  );
  term.focus();
}

term.onData((d) => pty?.input(d));
term.onTitleChange((text) => post({ type: 'title', text }));

function receive(raw: unknown): void {
  let m: In;
  try { m = (typeof raw === 'string' ? JSON.parse(raw) : raw) as In; } catch { return; }
  if (!m || typeof m !== 'object') return;
  if (m.type === 'open') open(m);
  else if (m.type === 'input') pty?.input(m.data);
  else if (m.type === 'resize') refit();
  else if (m.type === 'close') { pty?.close(); pty = null; }
}
// iOS posts to `window`, Android to `document` — listen on both, exactly once each
window.addEventListener('message', (ev) => receive((ev as MessageEvent).data));
document.addEventListener('message', (ev) => receive((ev as unknown as MessageEvent).data));

post({ type: 'ready' });
