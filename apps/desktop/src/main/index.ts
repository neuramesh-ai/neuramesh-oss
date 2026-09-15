import { runSelfTests } from './selftests';
import { registerAuthIpc } from './authipc';
import { registerRelayIpc } from './relayipc';
import { app, BrowserWindow, clipboard, ipcMain, Menu, nativeImage, protocol, shell } from 'electron';
import { mkdtempSync } from 'node:fs';
import { initContracts } from './contracts';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { currentUser, loadSession } from './auth';
import { currentClerkUser, loadClerkSession } from './auth-clerk';
import { artifactMime, bootDormant, initConnections, resyncWorkspace, setForeground, startSync, DEV_USER } from './sync';
import { connections, type Connection } from './connections';
import { startLocalStack } from './localStack/ipc';
import { registerUpgradeIpc } from './upgradeipc';
import { registerConnectionsIpc } from './connectionsipc';
import { registerMoveIpc } from './moveipc';
import { customReachable } from './customserver';
import { systemKeychain } from './keychain';
import { readFileSync } from 'node:fs';
import { parseWorkspaceIdent } from './wsident';
import { readAttachment } from './attachments';
import { initAutoUpdate } from './update';
import { claudeExecutablePath } from './runtime/adapter';
import { allowedWebviewSrc, navPolicy, popupPolicy } from './browser-guard';

app.setName('NeuraMesh');

// A Finder/Dock-launched GUI app inherits a MINIMAL PATH (/usr/bin:/bin:…) — not the login shell's,
// so user-installed CLIs the agent runtimes shell out to (codex, agy/gemini, gh, git) aren't found
// and can't even be npm-installed (npm itself is off-PATH). Recover the real PATH from the login
// shell once at startup. Packaged only (dev already has the terminal's PATH); never throws.
function hydratePathFromLoginShell(): void {
  if (process.platform === 'win32') return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { execFileSync } = require('node:child_process');
    const shell = process.env['SHELL'] || '/bin/zsh';
    const M = '__NM_PATH__';
    const raw: string = execFileSync(shell, ['-ilc', `printf '${M}%s${M}' "$PATH"`], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });
    const got = raw.split(M)[1];
    if (got && got.includes('/')) {
      const seen = new Set<string>();
      process.env['PATH'] = [...(process.env['PATH'] || '').split(':'), ...got.split(':')]
        .filter((d) => d && !seen.has(d) && seen.add(d))
        .join(':');
    }
  } catch {
    /* keep the inherited PATH — better a partial PATH than no app */
  }
}
if (app.isPackaged) hydratePathFromLoginShell();

// nm-attachment://<id> serves chat-attachment bytes from the local store to the renderer
// (full-res image + file previews). Must be declared privileged BEFORE app is ready.
protocol.registerSchemesAsPrivileged([
  { scheme: 'nm-attachment', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

const t0 = Date.now();
const smoke = process.argv.includes('--smoke');
const smokeSyncMode = process.argv.includes('--smoke-sync');
// The packaged app ALWAYS syncs at boot — `--sync` stays an opt-in for the dev harness
// only. Without this, a returning signed-in user never re-triggers ensureSync (only the
// login handlers do), so startSync never runs and the app wedges on the boot splash.
const withSync = app.isPackaged || process.argv.includes('--sync') || smokeSyncMode;

// --exit-after=<ms>: probes terminate themselves — SIGTERM to a pnpm wrapper
// does not reach the Electron child, which then lingers hosting agents.
const exitAfter = Number(process.argv.find((a) => a.startsWith('--exit-after='))?.slice(13) ?? 0);
if (exitAfter > 0) setTimeout(() => app.exit(0), exitAfter);

// --smoke-cli: release guard. Verify the PACKAGED app can resolve AND spawn its bundled native
// `claude` CLI — the spawn-ENOTDIR class of packaging regression (v0.5.0 had it; v0.5.1 shipped a
// silent no-op fix). release.yml runs this against the built .app; a non-zero exit fails the build.
if (process.argv.includes('--smoke-cli')) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { spawnSync } = require('node:child_process');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const os = require('node:os');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('node:fs');
  const say = (m: string) => fs.writeSync(2, `[smoke-cli] ${m}\n`); // sync stderr — survives process.exit
  if (!app.isPackaged) { say('skip — not packaged (dev)'); process.exit(0); }
  const p = claudeExecutablePath();
  if (!p) { say('FAIL — claudeExecutablePath() returned undefined (the SDK would spawn from inside app.asar → ENOTDIR)'); process.exit(1); }
  if (!fs.existsSync(p)) { say(`FAIL — resolved path missing: ${p}`); process.exit(1); }
  const r = spawnSync(p, ['--version'], { cwd: os.tmpdir(), encoding: 'utf8' });
  if (r.error) { say(`FAIL — spawn ${(r.error as NodeJS.ErrnoException).code}: ${r.error.message}`); process.exit(1); }
  if (r.status !== 0) { say(`FAIL — exited ${r.status}: ${String(r.stderr).trim().slice(0, 120)}`); process.exit(1); }
  say(`OK — ${p} → ${String(r.stdout).trim().slice(0, 40)}`);
  process.exit(0);
}

// NM_USERDATA: run a second instance on its own profile (multi-machine sync
// on one laptop, live demos beside the real app). Lock + DB scope to it.
if (process.env['NM_USERDATA']) app.setPath('userData', process.env['NM_USERDATA']);

// Hermetic smoke: a persistent local DB carries sync checkpoints from a dead
// stack after `compose down -v`, and recovery wedges the stream for ~20s.
if (smokeSyncMode) app.setPath('userData', mkdtempSync(join(tmpdir(), 'nm-smoke-')));

// --shot=<dir>: evidence harness — drives the synced UI to the board thread
// and captures both themes (doctrine: UI work ships with two-theme proof).
const shotDir = process.argv.find((a) => a.startsWith('--shot='))?.slice(7) ?? null;
// a shot normally runs in a throwaway profile; but if NM_USERDATA is set explicitly
// (e.g. to capture a pre-seeded signed-in session) honor it instead of overriding.
if (shotDir && !process.env['NM_USERDATA']) app.setPath('userData', mkdtempSync(join(tmpdir(), 'nm-shot-')));

// One instance per userData: a second launch focuses the first instead of
// fighting it for the local DB, the session file, and the control-api port.
// (Smoke/shot runs key off their own temp userData, so gates stay parallel.)
if (!app.requestSingleInstanceLock()) {
  console.log('another NeuraMesh instance is running — focusing it instead');
  app.exit(0);
}
app.on('second-instance', () => {
  const win = BrowserWindow.getAllWindows()[0];
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});


let syncStarted = false;
// Local mode (localStack/ipc.ts): the stack driver's `ready`, then /v1/me — what a local connection
// waits on before it touches its API. Set at whenReady when a local connection exists.
let localReachable: ((c: Connection) => Promise<void>) | null = null;
function ensureSync() {
  if (syncStarted) return;
  syncStarted = true;
  // a connection with a bearer waits for it before it touches its API: the local stack's comes
  // from the driver once the stack is ready, a custom server's from the keychain (customserver.ts)
  startSync({ waitUntilReachable: (c) => (c.kind === 'local' && localReachable ? localReachable(c) : c.kind === 'custom' && c.authMode === 'local' ? customReachable(c, systemKeychain()) : Promise.resolve()) }).catch((err) => console.error('sync failed to start:', err));
}

// context-menu items for a right-click at `params` — one builder shared by the app
// window and mini-browser guests so the two menus never drift
function contextMenuFor(params: Electron.ContextMenuParams): Electron.MenuItemConstructorOptions[] {
  const items: Electron.MenuItemConstructorOptions[] = [];
  if (params.linkURL) items.push({ label: 'Copy Link', click: () => clipboard.writeText(params.linkURL) });
  if (params.isEditable) {
    if (items.length) items.push({ type: 'separator' });
    items.push(
      { role: 'cut', enabled: params.editFlags.canCut },
      { role: 'copy', enabled: params.editFlags.canCopy },
      { role: 'paste', enabled: params.editFlags.canPaste },
      { type: 'separator' },
      { role: 'selectAll' },
    );
  } else if (params.selectionText.trim()) {
    if (items.length) items.push({ type: 'separator' });
    items.push({ role: 'copy' }, { type: 'separator' }, { role: 'selectAll' });
  } else if (!items.length) {
    items.push({ role: 'selectAll' });
  }
  return items;
}

// ── Dock mini-browser guests (docs/21) ──────────────────────────────────────────
// <webview> is enabled for the renderer's browser pane. Whatever a guest page tries,
// these caps hold: no preload/node in guests, web-only srcs and navigation, popups
// replace the pane's page (mailto → the mail app, the rest die). Enforced here —
// the renderer's address bar is UX, not the security boundary (doctrine #4).
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-attach-webview', (event, webPreferences, params) => {
    delete webPreferences.preload; // the nm bridge never reaches guest pages
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    if (!allowedWebviewSrc(params['src'])) event.preventDefault();
  });
  if (contents.getType() !== 'webview') return;
  contents.setWindowOpenHandler(({ url }) => {
    const policy = popupPolicy(url);
    if (policy === 'same-pane') void contents.loadURL(url);
    else if (policy === 'external') void shell.openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => { if (navPolicy(url) === 'deny') event.preventDefault(); });
  contents.on('context-menu', (_ev, params) => {
    const items = contextMenuFor(params);
    if (params.linkURL) items.push({ type: 'separator' }, { label: 'Open Link in Default Browser', click: () => void shell.openExternal(params.linkURL) });
    Menu.buildFromTemplate(items).popup();
  });
});

function createWindow() {
  // Brand the app icon. The NeuraMesh mark is copied from renderer/public/icon.png to
  // out/renderer/icon.png at build. On macOS the dev/run process is the generic Electron bundle, so
  // we set the dock icon at runtime (a packaged build uses build/icon.png via electron-builder); on
  // Windows/Linux the BrowserWindow `icon` drives the window + taskbar.
  const icon = nativeImage.createFromPath(join(__dirname, '../renderer/icon.png'));
  if (process.platform === 'darwin' && !icon.isEmpty()) app.dock?.setIcon(icon);
  // NM_OFFSCREEN=1 (dev, the recording harness): the renderer paints to a buffer and no window
  // reaches the screen. A window on screen paints nothing once it is minimized or covered, and a
  // first-run recording froze that way twice; offscreen, the debug port captures every frame
  // whatever the desktop shows, and nobody watches a theme flip per frame.
  const offscreen = !app.isPackaged && process.env['NM_OFFSCREEN'] === '1';
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    title: 'neuramesh',
    icon,
    // the dark theme's --bg — the pre-paint flash on cold start, so it must track tokens.css
    backgroundColor: '#101010',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: true, // dock mini-browser pane — guests are capped in web-contents-created above
      ...(offscreen ? { offscreen: true, backgroundThrottling: false } : {}),
    },
  });
  if (offscreen) { win.webContents.setFrameRate(15); console.log('offscreen=1 the window stays off screen, the debug port sees every frame'); }

  // Native right-click menu — Electron ships no default context menu, so without this, right-click
  // on chat text does nothing. Give copy on any selection (chat is freely selectable — nothing sets
  // user-select:none on it), the full cut/copy/paste/select-all set in editable fields, and copy-link
  // on links (PRs, task refs). Built per-click from the hit params so items match what's under the cursor.
  win.webContents.on('context-menu', (_e, params) => {
    Menu.buildFromTemplate(contextMenuFor(params)).popup({ window: win });
  });

  win.webContents.once('did-finish-load', () => {
    const coldstartMs = Date.now() - t0;
    if (!offscreen) win.show();
    console.log(`coldstart_ms=${coldstartMs} budget_ms=2000 ok=${coldstartMs < 2000}`);
    if (smoke) setTimeout(() => app.quit(), 150);
    if (shotDir) void import('./devshots').then((m) => m.captureShots(win, shotDir));
  });

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(async () => {
  // the agent contracts' local layer lives under userData — point it there before anything
  // composes a prompt or reads an agent's instructions
  initContracts(app.getPath('userData'));
  // the argv self-tests (selftests.ts) — each prints a verdict and exits the process
  await runSelfTests();

  loadSession();
  loadClerkSession();
  // the connections this launch has (connections.ts) — planned BEFORE nm:auth-status, which answers
  // from the foreground one, and before sync, which boots every one of them
  initConnections();
  const local = connections.all().find((c) => c.kind === 'local');
  // a warm boot has a marker naming a workspace this replica synced: the shell renders from the
  // replica while the stack comes up (F9). A first run — no marker, or one with nothing in it —
  // keeps the card on screen through the two waits.
  const startLocal = () => { if (local && !localReachable) localReachable = startLocalStack(local, { warm: () => { try { return !!parseWorkspaceIdent(readFileSync(local.markerPath, 'utf8')); } catch { return false; } } }); };
  if (local && !local.dormant) startLocal();
  // the door for a cloud user whose Local stayed dormant: start the driver, boot the connection,
  // bring it to the front. Idempotent — a live Local just comes to the front.
  ipcMain.handle('nm:local-stack-start', async () => {
    if (!local) return { ok: false as const, error: 'no local connection on this launch' };
    startLocal();
    await bootDormant(local.id);
    setForeground(local.id);
    return { ok: true as const };
  });
  const authMode = () => connections.current().authMode;
  console.log(`auth_mode=${authMode()} signed_in=${!!(authMode() === 'clerk' ? currentClerkUser() : currentUser())}`);
  // Config fingerprint — confirms the launcher wired the right values without leaking secrets: the
  // HOST for each URL (so you can see *which* control-api / PowerSync / web instance — the last 4
  // chars would just be ".com"), and the last 4 chars for each key. In a packaged build the NM_*
  // reads are baked literals; keys come from the shell. DATABASE_URL must be ∅ — the desktop never
  // holds DB creds, so ⚠SET means the launcher is misconfigured.
  const t4 = (v?: string) => (v ? `…${v.slice(-4)}` : '∅');
  const host = (v?: string) => { if (!v) return '∅'; try { return new URL(v).host; } catch { return t4(v); } };
  console.log(`env_check NM_AUTH=${process.env.NM_AUTH ?? '∅'} NM_API=${host(process.env.NM_API)} NM_POWERSYNC=${host(process.env.NM_POWERSYNC)} NM_WEB=${host(process.env.NM_WEB)} CLERK_PK=${t4(process.env.CLERK_PUBLISHABLE_KEY)} CLERK_SK=${t4(process.env.CLERK_SECRET_KEY)} DATABASE_URL=${process.env.DATABASE_URL ? '⚠SET' : '∅'}`);

  // dev mode acts as DEV_USER everywhere in main (sync, commands); the renderer must hear the same id, or "mine" is nobody's
  // Local mode has no sign-in: the local human IS the user, named by the stack's /v1/me once it
  // answers (an empty id until then keeps the renderer on its boot splash, never on sign-in)
  ipcMain.handle('nm:auth-status', () => {
    const c = connections.current();
    const mode = c.authMode;
    const user = mode === 'clerk' ? currentClerkUser() : mode === 'dev' ? { id: DEV_USER, email: 'dev@localhost' } : mode === 'local' ? { id: c.identity.actorId, email: c.identity.display || 'you@this-mac' } : currentUser();
    return { mode, user, connection: { id: c.id, kind: c.kind } };
  });
  ipcMain.handle('nm:open-external', async (_e, { url }: { url: string }) => {
    if (/^https?:\/\//.test(url)) {
      const { shell } = await import('electron');
      await shell.openExternal(url);
    }
  });
  // open a rendered HTML artifact in the user's own default browser (full fidelity,
  // outside the sandboxed in-app preview) — content is written to a temp file
  ipcMain.handle('nm:open-html', async (_e, { name, content }: { name: string; content: string }) => {
    const { writeFile, mkdtemp } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = await mkdtemp(join(tmpdir(), 'nm-preview-'));
    const safe = (name || 'preview.html').replace(/[^\w.-]/g, '_');
    const file = join(dir, /\.html?$/.test(safe) ? safe : `${safe}.html`);
    await writeFile(file, content, 'utf8');
    const { shell } = await import('electron');
    await shell.openPath(file);
  });
  // sign in / sign up / sign out (authipc.ts) — registered HERE, where they always were
  registerAuthIpc({ ensureSync, resyncWorkspace }); registerRelayIpc(); registerUpgradeIpc(); registerConnectionsIpc(); registerMoveIpc(); // + Get Pro's handoff (upgradeipc.ts) and Settings › Connections (connectionsipc.ts) and Move to Cloud (moveipc.ts) // + the desktop Code bridge's relay facts (relayipc.ts): the same identity, said to a relay

  if (smokeSyncMode) {
    try {
      await (await import('./devsmoke/smoke-sync')).smokeSync();
      app.exit(0);
    } catch (err) {
      console.error('SYNC_E2E=FAIL', err);
      app.exit(1);
    }
    return;
  }

  // a connection that can boot without a sign-in (dev, local), or one whose sign-in is stored
  const bootable = connections.all().some((c) => c.authMode === 'dev' || c.authMode === 'local' || (c.authMode === 'clerk' && currentClerkUser()) || (c.authMode === 'supabase' && currentUser()));
  if (withSync && bootable) ensureSync();
  // serve local attachment bytes to the renderer (full-res images + file previews). The id is
  // validated as a uuid inside readAttachment, so the hostname can't escape the store dir.
  protocol.handle('nm-attachment', async (req) => {
    const id = new URL(req.url).hostname;
    const bytes = await readAttachment(id);
    if (!bytes) return new Response('not found', { status: 404 });
    const mime = (await artifactMime(id)) ?? 'application/octet-stream';
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: { 'content-type': mime, 'cache-control': 'private, max-age=31536000, immutable' },
    });
  });
  // auto-update runs independent of sync/auth; checks only fire in a packaged build
  initAutoUpdate();
  createWindow();
});

app.on('window-all-closed', () => app.quit());
