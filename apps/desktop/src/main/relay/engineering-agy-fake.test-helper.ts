// a fake agy for the lane's tests: the stream-json shapes agy 1.4.0 printed on 2026-10-16, with
// switches in the prompt text. WRITE <name> writes a file the way --mode accept-edits lets agy,
// MCP <tool> <json> calls the NeuraMesh bridge through call_mcp_tool the way agy and the nm shim do,
// CMD tries agy's own command tool, which headless agy refuses, EMPTY ends the turn with no reply the
// way agy does after a refused last step, SLOW waits, CRASH exits 3.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SOURCE = String.raw`
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
const argv = process.argv.slice(2);
const flag = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
const asked = flag('--conversation');
const conversation = asked && asked.startsWith('keep-') ? asked : randomUUID();
if (asked && asked !== conversation) process.stderr.write('warning: conversation "' + asked + '" not found\n');
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
const tools = ['view_file', 'write_to_file', 'run_command', 'call_mcp_tool'];
out({ event: 'init', conversation_id: conversation, init: { model: flag('--model') || 'gemini-3.8-flash-medium', cwd: process.cwd(), tools, permission_mode: flag('--mode') || 'request-review' } });
if (process.env.FAKE_AGY_ARGV) writeFileSync(process.env.FAKE_AGY_ARGV, JSON.stringify(argv));
let step = 0;
const st = (o) => out({ event: 'step_update', step_update: { conversation_id: conversation, step_index: step, ...o } });
const queue = [];
let busy = false;
const turn = async (content) => {
  step++; st({ state: 'DONE', step_type: 'user_input' });
  if (content.includes('CRASH')) { process.stderr.write('AGY_ERROR: {"short":"the model is unavailable"}\n'); process.exit(3); }
  if (content.includes('SLOW')) await new Promise((r) => setTimeout(r, 5000));
  let reply = 'done:' + content.slice(-24).replace(/\s+/g, ' ');
  const write = /WRITE (\S+)/.exec(content);
  if (write) {
    step++; st({ state: 'ACTIVE', step_type: 'tool', tool_name: 'write_to_file', tool_info: { name: 'write_to_file', parameters: { TargetFile: write[1] } } });
    if (flag('--mode') === 'accept-edits') { writeFileSync(write[1], 'hi\n'); st({ state: 'DONE', step_type: 'tool', tool_name: 'write_to_file' }); }
    else st({ state: 'ERROR', step_type: 'tool', tool_name: 'write_to_file' });
  }
  const mcp = /MCP (\S+) (\{.*\})/.exec(content);
  if (mcp) {
    step++; st({ state: 'ACTIVE', step_type: 'tool', tool_name: 'call_mcp_tool', tool_info: { name: 'call_mcp_tool', parameters: { ServerName: 'nm', ToolName: mcp[1], Arguments: JSON.parse(mcp[2]) } } });
    const q = (s) => encodeURIComponent(s || '');
    const r = await fetch(process.env.NM_ORCH_URL + '/call?turn=' + q(process.env.NM_ORCH_TURN) + '&secret=' + q(process.env.NM_ORCH_SECRET), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: mcp[1], args: JSON.parse(mcp[2]) }) });
    reply = 'tool:' + String((await r.json()).result);
    st({ state: 'DONE', step_type: 'tool', tool_name: 'call_mcp_tool' });
  }
  const cmd = content.includes('CMD');
  if (cmd) { step++; st({ state: 'ACTIVE', step_type: 'tool', tool_name: 'run_command', tool_info: { parameters: { CommandLine: 'npm test' } } }); st({ state: 'ERROR', step_type: 'tool', tool_name: 'run_command' }); }
  if (content.includes('EMPTY')) reply = '';
  step++;
  const half = Math.floor(reply.length / 2);
  st({ state: 'ACTIVE', step_type: 'agent_response', text_delta: reply.slice(0, half) });
  st({ state: 'DONE', step_type: 'agent_response', text_delta: reply.slice(half), usage: { input_tokens: 100, output_tokens: 7 } });
  out({ event: 'result', result: { conversation_id: conversation, status: 'SUCCESS', response: reply, usage: { input_tokens: 100, output_tokens: 7 }, denied_actions: [...(write && flag('--mode') !== 'accept-edits' ? [{ action: 'write_file', display_name: 'WriteToFile' }] : []), ...(cmd ? [{ action: 'command', display_name: 'RunCommand' }] : [])] } });
};
const drain = async () => { if (busy) return; busy = true; while (queue.length) await turn(queue.shift()); busy = false; if (closed) process.exit(0); };
let closed = false;
createInterface({ input: process.stdin }).on('line', (line) => { if (!line.trim()) return; queue.push(JSON.parse(line).message.content); void drain(); }).on('close', () => { closed = true; if (!busy) process.exit(0); });
`;

/** write the fake agy once per test file; spawn it as `node <path> ...argv` */
export function fakeAgyScript(): string {
  const dir = mkdtempSync(join(tmpdir(), 'nm-fake-agy-'));
  const path = join(dir, 'agy.mjs');
  writeFileSync(path, SOURCE);
  return path;
}
