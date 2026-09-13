// What a `--shot` mode is handed — extracted from index.ts (track B-devshots).
import type { BrowserWindow } from 'electron';

export interface ShotCtx {
  win: BrowserWindow;
  dir: string;
  /** run an expression in the renderer and return its value */
  js: <T = unknown>(code: string) => Promise<T>;
  sleep: (ms: number) => Promise<unknown>;
  /** poll until a selector exists; logs and resolves false on timeout */
  waitFor: (selector: string, tries?: number) => Promise<boolean>;
}
