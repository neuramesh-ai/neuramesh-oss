// THE STATIC SHELL'S HANDOFF (the boot round, 2026-09-24). The browser's index.html paints the frame
// and a real composer before any script runs (src/renderer/web/index.html), so a person can type while
// the app loads. This is React's half: take what they typed, the caret and the focus, and remove the
// static page in the same frame React's own composer first paints, so no keystroke is lost and
// nothing jumps. Off the web (the desktop, the preview harness) there is no static page and every
// call here is a no-op.
import { NM_PLATFORM } from './platform';

interface StaticDraft { value: string; start: number; end: number; focused: boolean }
interface StaticShell { draft(): StaticDraft | null; release(): void }

const shell = (): StaticShell | undefined => (typeof window === 'undefined' ? undefined : (window as unknown as { __nmStaticShell?: StaticShell }).__nmStaticShell);

/** what the person typed into the static composer, for the composer's first state. Pure (no removal). */
export function staticDraft(): string {
  return shell()?.draft()?.value ?? '';
}

/** move the caret and the focus into React's composer, then remove the static page */
export function handOffStaticShell(textarea: HTMLTextAreaElement | null): void {
  const s = shell();
  const d = s?.draft();
  s?.release();
  if (!d || !textarea || !d.focused) return;
  textarea.focus();
  try { textarea.setSelectionRange(d.start, d.end); } catch { /* a value React changed since */ }
}

/** remove the static page without a handoff: the app opened somewhere with no Home composer */
export function releaseStaticShell(): void {
  shell()?.release();
}

/** The facts the static page needs to draw the next visit's first frame the way React will: the
 *  greeting's name, the project, the room, the brain chip, the workspace, and whether Home opens as
 *  a reading column (it has rows). Read from what the shell just drew, written only on the web. */
export function writeShellFacts(f: { name: string | null; project: string | null; room: string | null; ledgered: boolean }): void {
  if (NM_PLATFORM !== 'web') return;
  try {
    const brain = document.querySelector('.hcomposer .hrow .cchips .cchip:not(.cmach) .lbl')?.textContent?.trim() || null;
    const ws = document.querySelector('.navwsname')?.textContent?.trim() || null;
    // a reading column that scrolls carries a scrollbar (tokens.css styles them, so they take width),
    // and that moves the centered column: the static page reserves the same bar when this is true
    const col = document.querySelector('.stagewrap.ledgered');
    const scroll = !!col && col.scrollHeight > col.clientHeight + 1;
    localStorage.setItem('nm:web:shellFacts', JSON.stringify({ v: 1, ...f, brain, ws, scroll }));
  } catch { /* private mode: the next visit draws the first-visit frame */ }
}
