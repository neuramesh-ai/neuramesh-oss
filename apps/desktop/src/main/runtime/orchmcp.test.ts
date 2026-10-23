import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NM_MCP_ALLOW, closeBridge, ensureAgyMcpAllow, ensureBridge, objectArgs, registerTurn, unregisterTurn } from './orchmcp';

const home = () => mkdtempSync(join(tmpdir(), 'nm-agy-allow-'));
const settingsOf = (h: string) => join(h, '.gemini', 'antigravity-cli', 'settings.json');
const read = (h: string) => JSON.parse(readFileSync(settingsOf(h), 'utf8')) as Record<string, any>;

test('a home with no agy settings gets the nm allow rule', () => {
  const h = home();
  assert.equal(ensureAgyMcpAllow(h), true);
  assert.deepEqual(read(h), { permissions: { allow: [NM_MCP_ALLOW] } });
});

test('the rule merges into the person\'s settings and their own rules, once', () => {
  const h = home();
  mkdirSync(join(h, '.gemini', 'antigravity-cli'), { recursive: true });
  writeFileSync(settingsOf(h), JSON.stringify({ colorScheme: 'dark', permissions: { allow: ['command(npm test)'], deny: ['command(rm *)'] } }));
  assert.equal(ensureAgyMcpAllow(h), true);
  assert.equal(ensureAgyMcpAllow(h), true);
  assert.deepEqual(read(h), { colorScheme: 'dark', permissions: { allow: ['command(npm test)', NM_MCP_ALLOW], deny: ['command(rm *)'] } });
});

test('a settings file that does not parse is left as it was', () => {
  const h = home();
  mkdirSync(join(h, '.gemini', 'antigravity-cli'), { recursive: true });
  const broken = '{ // a comment agy may allow\n "colorScheme": "dark" }';
  writeFileSync(settingsOf(h), broken);
  assert.equal(ensureAgyMcpAllow(h), false);
  assert.equal(readFileSync(settingsOf(h), 'utf8'), broken);
  writeFileSync(settingsOf(h), '["not", "an", "object"]');
  assert.equal(ensureAgyMcpAllow(h), false);
});

test('a tool gets an object when agy forwards its arguments as a JSON string', async () => {
  const port = await ensureBridge();
  const seen: unknown[] = [];
  registerTurn('args-turn', 'args-secret', [{ name: 'echo', description: 'echo', inputSchema: {}, run: async (input) => { seen.push(input); return 'ok'; } }]);
  const call = (args: unknown) => fetch(`http://127.0.0.1:${port}/call?turn=args-turn&secret=args-secret`, { method: 'POST', body: JSON.stringify({ name: 'echo', args }) });
  await call('{"commands":["npm test"]}');
  await call({ commands: ['npm test'] });
  await call('not json');
  unregisterTurn('args-turn');
  await closeBridge();
  assert.deepEqual(seen, [{ commands: ['npm test'] }, { commands: ['npm test'] }, 'not json']);
  assert.deepEqual(objectArgs(undefined), {});
  assert.equal(objectArgs('[1, 2]'), '[1, 2]');
});
