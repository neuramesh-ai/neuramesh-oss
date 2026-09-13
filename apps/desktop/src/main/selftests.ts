// THE ARGV SELF-TESTS — three proofs that a native capability actually works inside Electron.
//
// `--pty-selftest` (node-pty loads and runs), `--pty-reclaim-selftest` (a task's review terminal
// really dies when its workspace is reclaimed — and ONLY that task's), and `--render-selftest`
// (native HTML→PNG capture, no external browser). Each prints a verdict and exits.
//
// Split out of index.ts's boot sequence, which they are not part of: they are independent of
// each other and of everything after them, and every one ends the process. That independence is
// the same reason the shot modes left smoke-sync while its phases stayed.
import { app } from 'electron';

/** Runs whichever self-test the argv asked for. Only returns if none did. */
export async function runSelfTests(): Promise<void> {
// --pty-selftest: prove node-pty loads + runs in the Electron runtime
if (process.argv.includes('--pty-selftest')) {
  try {
    const pty = await import('node-pty');
    const sh = pty.spawn(process.env['SHELL'] ?? '/bin/zsh', ['-c', 'echo nm-pty-ok'], { cwd: app.getPath('home') });
    let out = '';
    sh.onData((d) => (out += d));
    await new Promise((r) => sh.onExit(() => r(null)));
    console.log(`PTY_SELFTEST=${out.includes('nm-pty-ok') ? 'PASS' : 'FAIL'} out=${out.trim().slice(0, 40)}`);
  } catch (err) {
    console.error('PTY_SELFTEST=FAIL', err);
  }
  app.exit(0);
  return;
}

// --pty-reclaim-selftest: prove a task's review terminal is actually killed
// when its workspace is reclaimed (accept/close) — and only that task's
if (process.argv.includes('--pty-reclaim-selftest')) {
  try {
    const pty = await import('node-pty');
    const term = pty.spawn(process.env['SHELL'] ?? '/bin/zsh', [], { cwd: app.getPath('home') });
    const pid = term.pid;
    const ptys = new Map<string, { kill: () => void; taskNumber: number }>();
    ptys.set('s1', { kill: () => term.kill(), taskNumber: 1004 });
    let other = false;
    ptys.set('s2', { kill: () => { other = true; }, taskNumber: 99 }); // unrelated — must NOT be touched
    let killed = 0; // the exact reclaim filter from sync.ts
    for (const [id, p] of ptys) { if (p.taskNumber === 1004) { p.kill(); ptys.delete(id); killed++; } }
    await new Promise((r) => setTimeout(r, 300));
    let alive = true;
    try { process.kill(pid, 0); } catch { alive = false; }
    const ok = !alive && killed === 1 && !other && ptys.has('s2');
    console.log(`PTY_RECLAIM_SELFTEST=${ok ? 'PASS' : 'FAIL'} killed=${killed} target_alive=${alive} other_touched=${other}`);
  } catch (err) {
    console.error('PTY_RECLAIM_SELFTEST=FAIL', err);
  }
  app.exit(0);
  return;
}

// --render-selftest: prove native HTML→PNG capture works (no external browser)
if (process.argv.includes('--render-selftest')) {
  try {
    const { renderHtmlStringToPng } = await import('./render');
    const png = await renderHtmlStringToPng('<body style="background:#3ECF8E"><h1>nm render ok</h1></body>');
    console.log(`RENDER_SELFTEST=${png.length > 1000 ? 'PASS' : 'FAIL'} bytes=${png.length}`);
  } catch (err) {
    console.error('RENDER_SELFTEST=FAIL', err);
  }
  app.exit(0);
  return;
}
}
