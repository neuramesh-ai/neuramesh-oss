import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { stripVTControlCharacters } from 'node:util';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { WebSocketServer } from 'ws';
import { createHub } from '@neuramesh/relay';
import { openRelayPty, resetRelay } from '@neuramesh/relay-client';
import { chatWorkspaceDir } from '../chatmode';
import { cachePath, deliverablePath } from '../harness/brain';
import { engineeringWorktreeName } from '../harness/worktree-rows';
import { connectMachineEdge } from './machine-edge';
import { numberedTaskTerminalDirectory, threadTerminalDirectory } from './terminal-workspace';

test('real shells open in the selected task, coding session, agent thread, or global workspace', async () => {
  const original = process.env.NM_BRAIN;
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'nm-shell-scope-')));
  process.env.NM_BRAIN = root;
  const db = new DatabaseSync(':memory:');
  db.exec(`create table tasks(id, workspace_id, number, repo_id, branch, state, submitted_sha, pr_number, base_ref, channel_id);
    create table threads(id,workspace_id,kind,task_id,archived_at,channel_id);
    create table repos(id,workspace_id,default_branch,clone_url,local_path);
    create table code_sessions(id,workspace_id,thread_id,created_by,repo_id,repo_name,branch,project_id);
    insert into tasks values('task','ws',1119,'repo','nm/1119','in_progress',null,null,'main','c1');
    insert into threads(id,workspace_id,kind,task_id) values('task-thread','ws','coding','task'),('agent-thread','ws','chat',null),('coding-thread','ws','coding',null);
    insert into code_sessions(id,workspace_id,thread_id,created_by) values('coding-thread','ws','coding-thread','human');`);
  const replica = {
    async getAll<T>(sql: string, params: unknown[] = []) {
      return db.prepare(sql).all(...params as SQLInputValue[]) as T[];
    },
  };
  const taskFolder = cachePath('worktrees', 'nm-1119');
  const codingFolder = cachePath('worktrees', engineeringWorktreeName('human', 'repo', 'coding-thread'));
  for (const folder of [taskFolder, codingFolder, deliverablePath(12)]) mkdirSync(folder, { recursive: true });
  const hub = createHub({
    validateMachine: async () => ({ machineId: 'runner', workspaceId: 'ws' }),
    validateClient: async () => ({ allowed: true, userId: 'human' }),
  });
  const server = createServer();
  const wss = new WebSocketServer({ server });
  wss.on('connection', (socket, req) => hub.handleConnection(socket, req));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const relayUrl = `ws://127.0.0.1:${(server.address() as { port: number }).port}`;
  const edge = connectMachineEdge({
    relayUrl, machineId: 'runner', token: 'nmm_fixture',
    taskTerminalDirectory: n => numberedTaskTerminalDirectory(replica,'ws',n),
    threadTerminalDirectory: (id, actor) => threadTerminalDirectory(replica, 'ws', id, actor),
  });
  const cfg = { relayUrl, machineId: async () => 'runner', clientBearer: async () => 'fixture' };
  const shell = (target: { threadId?: string; taskNumber?: number; hasRepo?: boolean }) => new Promise<string>((resolve, reject) => {
    let sent = false;
    let output = '';
    const timer = setTimeout(() => { pty.close(); reject(new Error('Terminal timed out: ' + output)); }, 8000);
    const pty = openRelayPty(cfg, {
      ...target, cols: 90, rows: 20,
      onData(chunk) {
        output += chunk;
        if (!sent && output.includes('nm') && !output.includes('unavailable')) {
          sent = true;
          pty.input('pwd -P; exit\r');
        }
      },
      onExit() { clearTimeout(timer); resolve(output); },
    });
  });
  try {
    const deadline = Date.now() + 4000;
    while (!hub.stats().machines.includes('runner') && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    const cases = [
      [{ threadId: 'task-thread' }, taskFolder],
      [{ threadId: 'coding-thread' }, codingFolder],
      [{ threadId: 'agent-thread' }, chatWorkspaceDir(homedir(), 'agent-thread')],
      [{ taskNumber: 1119, hasRepo: false }, taskFolder],
      [{}, root],
    ] as const;
    for (const [target, folder] of cases) {
      const output = await shell(target);
      assert.ok(stripVTControlCharacters(output).split(/[\r\n]+/).includes(folder), output);
    }
    assert.match(await shell({ taskNumber: 999, hasRepo: true }), /unavailable in this workspace/);
    assert.match(await shell({ threadId: 'missing-thread' }), /coding worktree is unavailable/i);
    await assert.rejects(threadTerminalDirectory(replica, 'other', 'agent-thread', 'human'), /unavailable/);
    await assert.rejects(threadTerminalDirectory(replica, 'ws', 'coding-thread', 'other'), /unavailable/);
  } finally {
    edge.close();
    resetRelay();
    await new Promise<void>(resolve => wss.close(() => resolve()));
    await new Promise<void>(resolve => server.close(() => resolve()));
    db.close();
    if (original === undefined) delete process.env.NM_BRAIN;
    else process.env.NM_BRAIN = original;
    rmSync(root, { recursive: true, force: true });
  }
});
