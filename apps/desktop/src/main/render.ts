// Native HTML → PNG rendering for agent self-validation. We ARE Electron, so
// Chromium is already here, arm64-native — no Rosetta-x86 Chrome to fight, no
// DevTools port to bind, no Playwright/Puppeteer dep. An agent validating a
// visual deliverable gets a screenshot in ~1s instead of a 9-minute spiral
// (the #1004 lesson, 2026-06-13). Render fast so agents validate MORE, not less.
import { BrowserWindow } from 'electron';

interface RenderOpts {
  width?: number;
  height?: number;
  settleMs?: number; // time to let inline JS run / paint settle before capture
}

async function capture(load: (win: BrowserWindow) => Promise<void>, opts?: RenderOpts): Promise<Buffer> {
  const win = new BrowserWindow({
    width: opts?.width ?? 1280,
    height: opts?.height ?? 800,
    show: false,
    webPreferences: {
      // agent-produced HTML renders sandboxed: no node, isolated, no preload
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  try {
    await load(win);
    // did-finish-load fires before first paint; give inline JS + layout a beat
    await new Promise((r) => setTimeout(r, opts?.settleMs ?? 700));
    const img = await win.webContents.capturePage();
    return img.toPNG();
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

export function renderHtmlFileToPng(htmlPath: string, opts?: RenderOpts): Promise<Buffer> {
  return capture((win) => win.loadFile(htmlPath), opts);
}

export function renderHtmlStringToPng(html: string, opts?: RenderOpts): Promise<Buffer> {
  return capture((win) => win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`), opts);
}

// Capture a RUNNING app route (e.g. a Next.js dev/preview server the worker started) — a real
// Chromium window navigates to the URL and runs the app's JS, so it works where static-HTML
// rendering can't. Longer default settle so the route hydrates before the snapshot.
export function renderUrlToPng(url: string, opts?: RenderOpts): Promise<Buffer> {
  return capture((win) => win.loadURL(url), { settleMs: 1500, ...opts });
}
