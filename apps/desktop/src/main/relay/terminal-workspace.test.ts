import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
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
import { repoTerminalDirectory, terminalDirectory, threadTerminalDirectory } from './terminal-workspace';
import { useHydration } from '../harness/hydration';
import { gitChildEnv } from '../harness/workspaces';

test('real shells open in the selected task, coding session, agent thread, or global workspace', async () => {
  const original = process.env.NM_BRAIN;
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'nm-shell-scope-')));
  process.env.NM_BRAIN = root;
  const db = new DatabaseSync(':memory:');
  db.exec(`create table tasks(id, workspace_id, number, repo_id, branch);
    create table threads(id,workspace_id,kind,task_id);
    create table code_sessions(id,workspace_id,thread_id,created_by);
    insert into tasks values('task','ws',1119,'repo','nm/1119');
    insert into threads values('task-thread','ws','coding','task'),('agent-thread','ws','chat',null),('coding-thread','ws','coding',null);
    insert into code_sessions values('coding-thread','ws','coding-thread','human');`);
  const replica = {
    async get<T>(sql: string, params: unknown[] = []) { return db.prepare(sql).get(...params as SQLInputValue[]) as T; },
    async getAll<T>(sql: string, params: unknown[] = []) {
      return db.prepare(sql).all(...params as SQLInputValue[]) as T[];
    },
  };
  db.exec(`create table projects(id,workspace_id); create table project_repos(project_id,repo_id,is_primary);
    create table repos(id,workspace_id,name,org_name,clone_url,default_branch,local_path);
    create table connectors(project_id,workspace_id,provider,status,handle);
    insert into projects values('project','ws');
    insert into repos values('folder','ws','flowe-ai','local',null,'main','/Volumes/example/appdot/flowe-ai'),('github','ws','flowe-ai','example','https://github.com/example/flowe-ai.git','main',null);
    insert into project_repos values('project','folder',1),('project','github',0);`);
  const repoFolder = cachePath('repos', 'github');
  mkdirSync(repoFolder, { recursive: true });
  const git = (args: string[]) => execFileSync('git', args, { cwd: repoFolder, env: gitChildEnv(), encoding: 'utf8' }).trim();
  git(['init', '-b', 'main']); git(['config', 'user.name', 'QA']); git(['config', 'user.email', 'qa@example.invalid']);
  writeFileSync(join(repoFolder, 'tracked'), 'committed\n'); git(['add', 'tracked']); git(['commit', '-m', 'fixture']);
  writeFileSync(join(repoFolder, 'tracked'), 'dirty retained work\n'); writeFileSync(join(repoFolder, 'untracked'), 'retained private work\n');
  const before = git(['status', '--porcelain']);
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
    threadTerminalDirectory: (id, actor) => threadTerminalDirectory(replica, 'ws', id, actor),
    repoTerminalDirectory: (id, project) => repoTerminalDirectory(replica, 'ws', id, project),
  });
  const cfg = { relayUrl, machineId: async () => 'runner', clientBearer: async () => 'fixture' };
  const shell = (target: { threadId?: string; taskNumber?: number; hasRepo?: boolean; repo?: { repoId: string; projectId: string }; cwd?: string }) => new Promise<string>((resolve, reject) => {
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
      [{ taskNumber: 12, hasRepo: false }, deliverablePath(12)],
      [{}, root],
      [{ repo: { repoId: 'folder', projectId: 'project' }, cwd: '/Volumes/example/appdot/flowe-ai' }, repoFolder],
    ] as const;
    for (const [target, folder] of cases) {
      const output = await shell(target);
      assert.ok(stripVTControlCharacters(output).split(/[\r\n]+/).includes(folder), output);
    }
    assert.match(await shell({ taskNumber: 999, hasRepo: true }), /worktree is unavailable/);
    assert.match(await shell({ threadId: 'missing-thread' }), /coding worktree is unavailable/i);
    await assert.rejects(threadTerminalDirectory(replica, 'other', 'agent-thread', 'human'), /unavailable/);
    await assert.rejects(threadTerminalDirectory(replica, 'ws', 'coding-thread', 'other'), /unavailable/);
    assert.equal(git(['status', '--porcelain']), before);
    assert.equal(readFileSync(join(repoFolder, 'untracked'), 'utf8'), 'retained private work\n');
    await assert.rejects(repoTerminalDirectory(replica, 'other', 'folder', 'project'), /not attached/);
    await assert.rejects(repoTerminalDirectory(replica, 'ws', 'folder', 'other'), /not attached/);
    await assert.rejects(repoTerminalDirectory(replica, 'ws', '../folder', 'project'), /Invalid/);
    await assert.rejects(terminalDirectory({ ch: 'x', t: 'open', meta: { repoId: 'folder', projectId: 'project' } }, undefined, (id, project) => repoTerminalDirectory(replica, 'ws', id, project)), /Reconnect/);
    const hydrated: string[] = [];
    useHydration({ async ensure(path) { hydrated.push(path); }, async matching() {}, pending: () => false });
    assert.deepEqual(await repoTerminalDirectory(replica, 'ws', 'folder', 'project'), { cwd: repoFolder });
    assert.deepEqual(hydrated, [repoFolder], 'the requested clone hydrates before the presence check');
    useHydration(null);
    rmSync(repoFolder, { recursive: true });
    await assert.rejects(repoTerminalDirectory(replica, 'ws', 'folder', 'project'), /cloud checkout is unavailable/);
    assert.equal(existsSync(repoFolder), false, 'a missing checkout is not recreated as an empty directory');
  } finally {
    useHydration(null);
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
