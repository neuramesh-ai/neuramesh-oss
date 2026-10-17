import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EngineeringMachineOpenMeta, EngineeringRuntimeEvent } from '../../engineering-protocol';
import * as orchmcp from '../runtime/orchmcp';
import { AgyChannelSession, type AgyLaneDeps } from './engineering-agy';
import type { AgyLaneTool } from './engineering-agy-tools';
import { fakeAgyScript } from './engineering-agy-fake.test-helper';

const opened: AgyChannelSession[] = [];
// an open fake agy keeps the test runner alive, so every session closes, a failed one too
after(async () => { await Promise.all(opened.map((session) => session.close())); await orchmcp.closeBridge(); });
const script = fakeAgyScript();
const permissions = (command: boolean) => ({ read: true, edit: true, command, web: true, mcp: true });

function lane(o: { mode?: 'plan' | 'act'; command?: boolean } = {}) {
  const cwd = mkdtempSync(join(tmpdir(), 'nm-agy-session-'));
  const argvFile = join(cwd, '..', `argv-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  const events: EngineeringRuntimeEvent[] = [];
  const titles: string[] = [];
  const commands: string[] = [];
  const managed: AgyLaneTool[] = [{
    name: 'run_commands', description: 'Run shell commands.', inputSchema: { type: 'object', properties: { commands: { type: 'array', items: { type: 'string' } } } },
    execute: async (input) => { commands.push(...((input as { commands: string[] }).commands)); return 'ran'; },
  }];
  const deps: AgyLaneDeps = {
    bin: async () => ({ path: process.execPath, lead: [script] }),
    bridge: async () => `http://127.0.0.1:${await orchmcp.ensureBridge()}`,
    register: orchmcp.registerTurn,
    unregister: orchmcp.unregisterTurn,
    managedTools: () => managed,
    spawn: (command, args, options) => spawn(command, args, { ...options, env: { ...options.env, FAKE_AGY_ARGV: argvFile }, stdio: ['pipe', 'pipe', 'pipe'] }),
  };
  const meta: EngineeringMachineOpenMeta = {
    actorId: '00000000-0000-4000-8000-000000000001', threadId: `00000000-0000-4000-8000-${Math.floor(Math.random() * 1e12).toString().padStart(12, '0')}`,
    repoId: 'repo-1', repoName: 'repo', branch: 'main', mode: o.mode ?? 'act', permissions: permissions(o.command ?? true), policy: permissions(true), modelId: 'gemini-4-argon', reasoningEffort: 'high',
  };
  const session = new AgyChannelSession(meta, cwd, { providerId: 'gemini', modelId: 'gemini-4-argon', lane: 'agy' }, 'gemini-4-argon', null, [], (event) => events.push(event), deps, () => {},
    undefined, async (title) => { titles.push(title); return {}; });
  const until = async (check: () => boolean, ms = 8000) => {
    const end = Date.now() + ms;
    while (!check()) { if (Date.now() > end) throw new Error(`timed out; events: ${JSON.stringify(events.map((e) => e.type))}`); await new Promise((r) => setTimeout(r, 20)); }
  };
  const ended = () => events.filter((e) => e.type === 'ended').length;
  const text = () => events.flatMap((e) => {
    const inner = e.type === 'agent_event' ? ((e.event['payload'] as Record<string, unknown>)?.['event'] as Record<string, unknown>) : undefined;
    return inner?.['type'] === 'content_end' && inner['contentType'] === 'text' ? [String(inner['text'])] : [];
  });
  opened.push(session);
  return { session, cwd, events, titles, commands, until, ended, text, argv: () => JSON.parse(readFileSync(argvFile, 'utf8')) as string[] };
}

test('a turn streams through the same events as the Cline lane and ends completed', async () => {
  const t = lane();
  await t.session.init([]);
  assert.equal(t.events[0]?.type, 'plan_progress');
  assert.deepEqual({ ...t.events[1], cwd: undefined }, { type: 'ready', provider: 'gemini', model: 'gemini-4-argon', cwd: undefined, modelId: 'gemini-4-argon', brainPack: null, agent: undefined, reasoningEffort: 'high' });
  t.session.command({ type: 'prompt', prompt: 'say hello please' });
  await t.until(() => t.ended() === 1);
  assert.deepEqual(t.events.filter((e) => e.type === 'status').map((e) => (e as { status: string }).status), ['running', 'idle']);
  assert.match(t.text()[0] ?? '', /say hello please$/, 'the first turn carries the user message last');
  assert.deepEqual(t.events.find((e) => e.type === 'usage'), { type: 'usage', inputTokens: 100, outputTokens: 7 });
  assert.equal((t.events.find((e) => e.type === 'ended') as { reason: string }).reason, 'completed');
  const argv = t.argv();
  assert.deepEqual(argv.slice(argv.indexOf('--model'), argv.indexOf('--model') + 4), ['--model', 'gemini-4-argon-high', '--mode', 'accept-edits']);
  assert.equal(argv.at(-1), '-p=');
});

test('NeuraMesh tools run through the bridge: a metadata tool at once, a command on approval', async () => {
  const t = lane({ command: false });
  await t.session.init([]);
  t.session.command({ type: 'prompt', prompt: 'MCP set_thread_title {"title":"Fix login"}' });
  await t.until(() => t.ended() === 1);
  assert.deepEqual(t.titles, ['Fix login']);
  assert.equal(t.events.some((e) => e.type === 'agent_event' && JSON.stringify(e).includes('could not reach the NeuraMesh tools')), false, 'no blocked notice while the tools answer');
  t.session.command({ type: 'prompt', prompt: 'MCP run_commands {"commands":["npm test"]}' });
  await t.until(() => t.events.some((e) => e.type === 'approval'));
  const approval = t.events.find((e) => e.type === 'approval') as { approvalId: string; category: string; toolName: string };
  assert.equal(approval.category, 'command');
  assert.equal(approval.toolName, 'run_commands');
  assert.deepEqual(t.commands, [], 'nothing runs before the approval');
  t.session.command({ type: 'approval', approvalId: approval.approvalId, approved: true });
  await t.until(() => t.ended() === 2);
  assert.deepEqual(t.commands, ['npm test']);
  assert.match(t.text().at(-1) ?? '', /^tool:ran$/);
  // the nm tools have answered in this session, so a refused own command is not a missing-tools sign
  t.session.command({ type: 'prompt', prompt: 'CMD try your own tool' });
  await t.until(() => t.ended() === 3);
  assert.equal(t.events.some((e) => e.type === 'agent_event' && JSON.stringify(e).includes('could not reach the NeuraMesh tools')), false);
});

test('Plan mode keeps agy in its default mode and blocks a command over the bridge', async () => {
  const t = lane({ mode: 'plan' });
  await t.session.init([]);
  t.session.command({ type: 'prompt', prompt: 'MCP run_commands {"commands":["rm -rf build"]}' });
  await t.until(() => t.ended() === 1);
  assert.equal(t.argv().includes('--mode'), false, 'no agy mode: its default refuses its own writes and commands');
  assert.deepEqual(t.commands, []);
  assert.ok(t.events.some((e) => e.type === 'mode_blocked' && e.category === 'command'));
  assert.match(t.text().at(-1) ?? '', /Blocked by Neuramesh Plan mode/);
});

test('a refused command says once that the NeuraMesh tools are missing, abort ends a slow turn, and a crash names agy\'s own error', async () => {
  const t = lane();
  await t.session.init([]);
  const blocked = () => t.events.filter((e) => e.type === 'agent_event' && JSON.stringify(e).includes('could not reach the NeuraMesh tools')).length;
  t.session.command({ type: 'prompt', prompt: 'CMD run the tests' });
  await t.until(() => t.ended() === 1);
  assert.equal(blocked(), 1);
  t.session.command({ type: 'prompt', prompt: 'CMD run them again' });
  await t.until(() => t.ended() === 2);
  assert.equal(blocked(), 1, 'said once per session');
  // a refused last step that left the turn empty gets one retry, and its reply ends the turn
  t.session.command({ type: 'prompt', prompt: 'EMPTY CMD then nothing' });
  await t.until(() => t.ended() === 3);
  assert.match(t.text().at(-1) ?? '', /^done:/);
  assert.equal((t.events.filter((e) => e.type === 'ended').at(-1) as { reason: string }).reason, 'completed');
  t.session.command({ type: 'prompt', prompt: 'SLOW reply' });
  await t.until(() => t.events.filter((e) => e.type === 'status' && e.status === 'running').length === 4);
  t.session.command({ type: 'abort' });
  await t.until(() => t.ended() === 4);
  assert.equal((t.events.filter((e) => e.type === 'ended').at(-1) as { reason: string }).reason, 'aborted');
  t.session.command({ type: 'prompt', prompt: 'CRASH now' });
  await t.until(() => t.events.some((e) => e.type === 'error'));
  assert.match((t.events.find((e) => e.type === 'error') as { message: string }).message, /^Gemini stopped: the model is unavailable$/);
  t.session.command({ type: 'restore', checkpointRunCount: 1 });
  assert.equal((t.events.at(-1) as { code?: string }).code, 'RESTORE_UNAVAILABLE');
});
