// the orchestrator's CLI transports on a cloud machine, where there is no electron (2026-10-03).
//
// rex seated on gpt-5.6-sol in hq answered "Electron failed to install correctly, please delete
// node_modules/electron and try installing again". a cloud machine runs the daemon under plain node
// (the image sets ELECTRON_SKIP_BINARY_DOWNLOAD=1), and codexSdkOrchestratorTurn imported electron
// only to ask where to write the MCP shim. the worker's codex path already asked userDataDir(), which
// answers NM_USERDATA (/nm/state on a machine) outside electron. agy's transport had the same import.
//
// so each test runs a transport the way a machine does: plain node, NM_USERDATA set, and a stand-in
// CLI on PATH that speaks the real wire (codex's --experimental-json events, agy's reply markers).
//   node --import tsx --test apps/desktop/src/main/host/orchturn-cloud.test.ts
import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, test } from 'node:test';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agyOrchestratorTurn, codexSdkOrchestratorTurn } from './orchturn';
import * as orchmcp from '../runtime/orchmcp';

// the bridge is a live listener: without the close the runner never drains (bus-e2e.test.ts)
after(() => orchmcp.closeBridge());

const ARGS = { model: 'gpt-5.6-sol', token: '', systemPrompt: 'you are the orchestrator', transcript: 'human: hello', tools: [] };
const KEEP = ['PATH', 'HOME', 'NM_USERDATA'] as const;
let saved: Record<string, string | undefined> = {};
let root = '';
let bin = '';
let state = '';

beforeEach(() => {
  saved = Object.fromEntries(KEEP.map((k) => [k, process.env[k]]));
  root = mkdtempSync(join(tmpdir(), 'nm-orch-cloud-'));
  bin = join(root, 'bin');
  state = join(root, 'state');
  for (const d of [bin, state, join(root, 'home')]) mkdirSync(d, { recursive: true });
  process.env['PATH'] = `${bin}:${process.env['PATH'] ?? ''}`;
  process.env['HOME'] = join(root, 'home'); // agy merges its MCP config under ~/.gemini
  process.env['NM_USERDATA'] = state;
});

afterEach(() => {
  for (const k of KEEP) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  rmSync(root, { recursive: true, force: true });
});

/** a stand-in CLI: a shell script on PATH that records its argv and prints what the test scripts */
function standIn(name: string, body: string): void {
  const p = join(bin, name);
  writeFileSync(p, `#!/bin/sh\nprintf '%s\\n' "$@" > "${join(root, `${name}.argv`)}"\n${body}\n`);
  chmodSync(p, 0o755);
}

test('the codex transport answers outside electron, and its shim lands in NM_USERDATA', async () => {
  // the version the floor in runtime/cli.ts accepts, so ensureCli never tries an upgrade here
  standIn('codex', [
    'if [ "$1" = "--version" ]; then echo "codex-cli 0.153.4"; exit 0; fi',
    'cat > /dev/null',
    `echo '{"type":"thread.started","thread_id":"t-1"}'`,
    `echo '{"type":"turn.started"}'`,
    // the shapes codex-cli 0.153.4 sends (measured 2026-10-03): a reasoning summary and a tool call
    // arrive before the reply, each whole, and the reply arrives whole at the end
    `echo '{"type":"item.completed","item":{"id":"r-1","type":"reasoning","text":"**Comparing the storage adapters**"}}'`,
    `echo '{"type":"item.started","item":{"id":"m-1","type":"mcp_tool_call","server":"nm","tool":"list_tasks","arguments":{"state":"open"},"status":"in_progress"}}'`,
    `echo '{"type":"item.completed","item":{"id":"i-1","type":"agent_message","text":"hello from codex"}}'`,
    `echo '{"type":"turn.completed","usage":{"input_tokens":1,"cached_input_tokens":0,"output_tokens":1}}'`,
  ].join('\n'));

  // the bubble's feed: the thoughts stream before the reply, and never become it (the repo-connect round's Option A)
  const fed: Array<[string, string | undefined]> = [];
  const reply = await codexSdkOrchestratorTurn({ ...ARGS, onDelta: (t, th) => { fed.push([t, th]); } });

  assert.equal(reply, 'hello from codex');
  assert.deepEqual(fed, [
    ['', '**Comparing the storage adapters**'],
    ['', '**Comparing the storage adapters**\n\n› list_tasks · open'],
    ['hello from codex', '**Comparing the storage adapters**\n\n› list_tasks · open'],
  ]);
  assert.match(readFileSync(join(root, 'codex.argv'), 'utf8'), /model_reasoning_summary="detailed"/, 'codex is asked for the summaries the bubble shows');
  const shim = join(state, 'nm-orch-mcp-shim.mjs');
  assert.ok(existsSync(shim), 'the shim is written to the machine state folder');
  assert.match(readFileSync(join(root, 'codex.argv'), 'utf8'), new RegExp(shim.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'codex is told to start the shim it was given');
});

test('a codex rex whose model the ChatGPT plan lacks answers on the account default', async () => {
  // codex-cli 0.153.4 on a model the plan lacks (the #694 review): the reason, then exit 1. The SDK throws
  // its exit code past turn.failed, so a drain that read on lost the reason and never fell back
  const calls = join(root, 'codex.calls');
  const why = 'The gpt-5.6-sol model is not supported when using Codex with a ChatGPT account.';
  standIn('codex', [
    'if [ "$1" = "--version" ]; then echo "codex-cli 0.153.4"; exit 0; fi',
    'cat > /dev/null',
    `echo "$*" >> "${calls}"`,
    `echo '{"type":"thread.started","thread_id":"t-1"}'`,
    `echo '{"type":"turn.started"}'`,
    'case " $* " in *" --model gpt-5.6-sol "*)',
    `  echo '{"type":"error","message":"${why}"}'`,
    `  echo '{"type":"turn.failed","error":{"message":"${why}"}}'`,
    '  echo "Reading prompt from stdin..." >&2; exit 1;;',
    'esac',
    `echo '{"type":"item.completed","item":{"id":"i-1","type":"agent_message","text":"hello from the default model"}}'`,
    `echo '{"type":"turn.completed","usage":{"input_tokens":1,"cached_input_tokens":0,"output_tokens":1}}'`,
  ].join('\n'));

  const reply = await codexSdkOrchestratorTurn(ARGS);

  assert.equal(reply, 'hello from the default model');
  const asked = readFileSync(calls, 'utf8').trim().split('\n');
  assert.equal(asked.length, 2, 'one turn on the seated model, then one on the account default');
  assert.match(asked[0]!, /--model gpt-5\.6-sol/);
  assert.doesNotMatch(asked[1]!, /--model/);
});

test('the agy transport answers outside electron, and its shim lands in NM_USERDATA', async () => {
  standIn('agy', 'printf "step one\\nNMREPLYSTART\\nhello from agy\\nNMREPLYEND\\n"');

  const reply = await agyOrchestratorTurn({ ...ARGS, model: 'gemini-3.5-flash' });

  assert.equal(reply, 'hello from agy');
  const shim = join(state, 'nm-orch-mcp-shim.mjs');
  assert.ok(existsSync(shim), 'the shim is written to the machine state folder');
  const cfg = readFileSync(join(root, 'home', '.gemini', 'config', 'mcp_config.json'), 'utf8');
  assert.ok(cfg.includes(shim), "agy's MCP config points at that shim");
});
