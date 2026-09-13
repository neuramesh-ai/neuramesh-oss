// Review terminals, free ptys and the background-process tracker — extracted from
// sync.ts (track B-sync).
//
// The pty map itself stays with startSync: the agent host's reclaim path needs
// killTaskPtys when a task is accepted, so the map is created there and handed here. That
// is the seam for every IPC group — deps for what startSync OWNS, live imports for module
// state (procEvents is a module-level bus, so it is imported, not passed).
import { ipcMain, type WebContents } from 'electron';
import { existsSync as existsSyncTop, mkdirSync as mkdirSyncTop } from 'node:fs';
import type { PowerSyncDatabase } from '@powersync/node';
import { emitProcChange, procEvents } from '../../procbus';
import { executing, stopExecuting } from '../../agents';
import { brainRoot, cachePath, deliverablePath } from '../../harness/brain';

export type PtyTerm = { write: (d: string) => void; resize: (c: number, r: number) => void; kill: () => void; taskNumber: number };

export interface TerminalDeps {
  db: () => PowerSyncDatabase;
  /** created by startSync so the host's reclaim path can kill a task's shells */
  ptys: Map<string, PtyTerm>;
  procWatchers: Map<string, () => void>;
}

export function registerTerminals({ db, ptys, procWatchers }: TerminalDeps): void {
// integrated terminal (review cockpit run tier) — a pty scoped to the task's
// RETAINED local deliverable workspace. Local-only: only the machine that
// ran the task has the workspace; read + RUN (it's the user's own shell on
// their own machine). Never synced.
const workspaceDir = async (taskNumber: number, hasRepo: boolean): Promise<string | null> => {
  const { existsSync } = await import('node:fs');
  // the terminal opens the SAME directory the flow built (docs/harness/01 §3.2): worktrees live
  // under cache/, deliverables under the root. Reading a different path than the writer is what
  // made this say "not on this machine" while the work sat happily one directory over.
  const dir = hasRepo ? cachePath('worktrees', `nm-${taskNumber}`) : deliverablePath(taskNumber);
  return existsSync(dir) ? dir : null;
};

ipcMain.handle('nm:terminal-info', async (_e, { taskNumber, hasRepo }: { taskNumber: number; hasRepo: boolean }) => {
  const cwd = await workspaceDir(taskNumber, hasRepo);
  return { available: !!cwd, cwd };
});
ipcMain.handle('nm:terminal-open', async (event, { subId, taskNumber, hasRepo, cols, rows }: { subId: string; taskNumber: number; hasRepo: boolean; cols: number; rows: number }) => {
  // A task whose workspace is not on THIS machine used to return a bare {ok:false} that nothing
  // surfaced: the tab rendered an empty pane. Say which folder is missing, then fall back to the
  // NeuraMesh home so you still get a usable shell — an explained terminal you can work in beats
  // a dead one. The jail below re-roots to whatever we actually opened, so it stays coherent.
  const workspace = await workspaceDir(taskNumber, hasRepo);
  const nmHome = brainRoot();
  if (!workspace && !existsSyncTop(nmHome)) { try { mkdirSyncTop(nmHome, { recursive: true }); } catch { /* fall back to spawn failure */ } }
  const cwd = workspace ?? nmHome;
  const missingNote = workspace
    ? null
    : `\r\n\x1b[33mnm:\x1b[0m \x1b[2m#${taskNumber}'s ${hasRepo ? 'worktree' : 'deliverables folder'} is not on this machine — opened ~/.neuramesh instead.\x1b[0m\r\n`;
  const pty = await import('node-pty');
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { join: pjoin } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const sender: WebContents = event.sender;
  // confine the validation terminal to the task workspace: a zsh chpwd hook
  // snaps PWD back whenever it escapes the jail root (no accidental `cd /`
  // into the host fs). NOTE: a working-dir jail, not full OS isolation —
  // absolute reads still work; sandbox-exec hardening is a follow-up.
  const zdot = mkdtempSync(pjoin(tmpdir(), 'nm-term-'));
  writeFileSync(
    pjoin(zdot, '.zshrc'),
    [
      'builtin cd "$NMJAIL" 2>/dev/null',
      '__nm_jail() {',
      '  local cur="${PWD:A}" root="${NMJAIL:A}"',
      '  case "$cur/" in',
      '    "$root/"*|"$root") ;;',
      '    *) builtin cd "$root"; print -P "%F{yellow}nm: this terminal is confined to the task workspace%f" ;;',
      '  esac',
      '}',
      'autoload -Uz add-zsh-hook 2>/dev/null && add-zsh-hook chpwd __nm_jail',
      "PROMPT='%F{green}nm%f %1~ %# '",
    ].join('\n'),
  );
  const term = pty.spawn('/bin/zsh', [], {
    name: 'xterm-color',
    cwd,
    cols: cols || 80,
    rows: rows || 24,
    env: { ...process.env, ZDOTDIR: zdot, NMJAIL: cwd } as Record<string, string>,
  });
  const cleanup = () => { try { rmSync(zdot, { recursive: true, force: true }); } catch { /* gone */ } };
  // the note rides the shell's FIRST output so it lands under the prompt rather than being
  // overwritten by the zsh startup redraw
  let note = missingNote;
  term.onData((d) => {
    if (sender.isDestroyed()) return;
    sender.send('nm:terminal-data', { subId, data: d });
    if (note) { const n = note; note = null; queueMicrotask(() => { if (!sender.isDestroyed()) sender.send('nm:terminal-data', { subId, data: n }); }); }
  });
  term.onExit(() => { if (!sender.isDestroyed()) sender.send('nm:terminal-exit', { subId }); ptys.delete(subId); emitProcChange(); cleanup(); });
  ptys.set(subId, {
    write: (d) => term.write(d),
    resize: (c, r) => { try { term.resize(c, r); } catch { /* race on close */ } },
    kill: () => { try { term.kill(); } catch { /* gone */ } cleanup(); },
    taskNumber,
  });
  emitProcChange();
  console.log(`terminal_open task=${taskNumber} cwd=${cwd.replace(process.env['HOME'] ?? '~', '~')} jailed`);
  return { ok: true, cwd };
});
ipcMain.handle('nm:terminal-input', (_e, { subId, data }: { subId: string; data: string }) => ptys.get(subId)?.write(data));
ipcMain.handle('nm:terminal-resize', (_e, { subId, cols, rows }: { subId: string; cols: number; rows: number }) => ptys.get(subId)?.resize(cols, rows));
ipcMain.handle('nm:terminal-close', (_e, { subId }: { subId: string }) => { ptys.get(subId)?.kill(); ptys.delete(subId); emitProcChange(); });

// code-workspace terminal — a pty rooted at the folder the user opened in the code
// viewer (their own shell, their own machine; reuses the same input/resize/close +
// data/exit channel as the task terminal). Not jailed: they chose this folder.
ipcMain.handle('nm:pty-open', async (event, { subId, cwd, cols, rows, startupCommand }: { subId: string; cwd: string; cols: number; rows: number; startupCommand?: string }) => {
  const { existsSync, mkdirSync } = await import('node:fs');
  const { homedir } = await import('node:os');
  // An empty/invalid cwd lands in the NEURAMESH home (~/.neuramesh — the root that holds
  // worktrees/ and deliverables/), never the user's home directory. A terminal opened from this
  // app is for this app's work; dropping someone into ~ makes their whole machine the workspace.
  const nmHome = brainRoot();
  if (!existsSync(nmHome)) { try { mkdirSync(nmHome, { recursive: true }); } catch { /* fall back below */ } }
  const dir = cwd && existsSync(cwd) ? cwd : existsSync(nmHome) ? nmHome : homedir();
  const pty = await import('node-pty');
  const sender: WebContents = event.sender;
  const shell = process.env['SHELL'] || '/bin/zsh';
  const term = pty.spawn(shell, [], { name: 'xterm-color', cwd: dir, cols: cols || 80, rows: rows || 24, env: { ...process.env } as Record<string, string> });
  let pendingStartup = startupCommand?.trim() || null;
  term.onData((d) => {
    if (!sender.isDestroyed()) sender.send('nm:terminal-data', { subId, data: d });
    if (pendingStartup) {
      const command = pendingStartup;
      pendingStartup = null;
      queueMicrotask(() => term.write(`${command}\r`));
    }
  });
  term.onExit(() => { if (!sender.isDestroyed()) sender.send('nm:terminal-exit', { subId }); ptys.delete(subId); emitProcChange(); });
  ptys.set(subId, {
    write: (d) => term.write(d),
    resize: (c, r) => { try { term.resize(c, r); } catch { /* race on close */ } },
    kill: () => { try { term.kill(); } catch { /* gone */ } },
    taskNumber: -1,
  });
  emitProcChange();
  console.log(`pty_open cwd=${dir.replace(process.env['HOME'] ?? '~', '~')}${startupCommand ? ' startup=claude-design' : ''}`);
  return { ok: true };
});

// ── background-processes tracker: live count + list + stop, over the ptys (terminals) and
//    executing (agent runs) registries; procbus emits 'change' from every mutation site ──
ipcMain.handle('nm:process-list', async () => {
  const agents: Array<{ taskId: string; taskNumber: number | null; agentName: string; title: string }> = [];
  for (const taskId of executing.keys()) {
    const row = await db().get<{ number: number; title: string; agent_name: string | null }>(
      `select t.number, t.title, a.name as agent_name from tasks t left join agents a on a.id = t.assignee_id where t.id = ?`, [taskId]).catch(() => null);
    agents.push({ taskId, taskNumber: row?.number ?? null, agentName: row?.agent_name ?? 'agent', title: row?.title ?? '' });
  }
  const terminals = [...ptys.entries()].map(([subId, p]) => ({ subId, taskNumber: p.taskNumber, title: p.taskNumber > 0 ? `#${p.taskNumber}` : 'terminal' }));
  return { agents, terminals };
});
ipcMain.handle('nm:process-kill', (_e, { kind, id }: { kind: 'agent' | 'terminal'; id: string }) => {
  if (kind === 'terminal') { ptys.get(id)?.kill(); ptys.delete(id); emitProcChange(); return { ok: true }; }
  if (kind === 'agent') { stopExecuting(id); return { ok: true }; }
  return { ok: false };
});
ipcMain.handle('nm:process-watch', (event, { subId }: { subId: string }) => {
  const sender: WebContents = event.sender;
  const on = () => { if (!sender.isDestroyed()) sender.send('nm:process-changed', { subId }); };
  procEvents.on('change', on);
  procWatchers.set(subId, on);
  sender.once('destroyed', () => { procEvents.off('change', on); procWatchers.delete(subId); });
  return { ok: true };
});
ipcMain.handle('nm:process-unwatch', (_e, { subId }: { subId: string }) => { const on = procWatchers.get(subId); if (on) { procEvents.off('change', on); procWatchers.delete(subId); } });
}
