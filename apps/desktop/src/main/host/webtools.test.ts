// the agents' browser in every registry, asserted against what a turn is handed. where the machine
// runs Chromium (a browser service is registered), the orchestrator's triage and owning turns, the
// conversation and the worker bus each carry all five web tools, and a sweep carries none. where it
// does not (the desktop app, a machine from before the browser), no registry carries one, so the
// orchestrator manifest (orchregistry.test.ts) stays exactly as it was.
import assert from 'node:assert/strict';
import { test, afterEach } from 'node:test';
import { GoogleGenAI, Type } from '@google/genai';
import { z } from 'zod';
import { buildStubOrchestratorRegistry } from '../promptmeter';
import { setBrowserService } from '../browser/registry';
import { webToolsFor } from '../browser/agent-tools';
import { toolsForTurn } from '../harness/toolbus';
import { webChatTools } from './chattools-web';
import { zodShapeToGemini } from './orchturn';
import type { BrowserService } from '../browser/service';

const WEB = ['web_click', 'web_open', 'web_read', 'web_screenshot', 'web_type'];
const fakeService = { agentPage: () => null, withAgentPage: async () => '', lastRefusal: () => null, allowed: async () => ({ ok: false, reason: 'x' }) } as unknown as BrowserService;
const webOf = (names: string[]): string[] => names.filter((n) => n.startsWith('web_')).sort();
afterEach(() => setBrowserService(null));

test('no Chromium on this machine: no registry carries a web tool', async () => {
  for (const kind of ['triage', 'own'] as const) assert.deepEqual(webOf((await buildStubOrchestratorRegistry(kind)).map((t) => t.name)), []);
  assert.deepEqual(webOf(toolsForTurn('work', { dir: '/tmp' }).map((d) => d.name)), []);
});

test('with a browser service, triage and owning turns carry all five, and no sweep carries one', async () => {
  setBrowserService(fakeService);
  for (const kind of ['triage', 'own'] as const) assert.deepEqual(webOf((await buildStubOrchestratorRegistry(kind)).map((t) => t.name)), WEB, kind);
  for (const scope of ['digest', 'watchdog', 'monitor'] as const) assert.deepEqual(webOf((await buildStubOrchestratorRegistry('sweep', scope)).map((t) => t.name)), [], scope);
});

test('the NeuraMesh brain renders every web tool as a function declaration (orchturn.ts runs the same registry)', async () => {
  setBrowserService(fakeService);
  assert.ok(GoogleGenAI, 'the Gemini SDK the NeuraMesh brain uses');
  for (const t of (await buildStubOrchestratorRegistry('triage')).filter((x) => x.name.startsWith('web_'))) {
    assert.equal(zodShapeToGemini(t.schema, Type).type, Type.OBJECT, t.name);
  }
});

test('the conversation and the worker bus carry the five where the service is, and none where it is not', () => {
  const fakeTool = (name: string) => ({ name });
  const chat = (svcThere: boolean): string[] => {
    setBrowserService(svcThere ? fakeService : null);
    const tools = webChatTools({ z, tool: fakeTool as never, text: () => ({ content: [] }), agent: { id: 'a', name: 'sol' } as never, ch: { id: 'c', slug: 'general', workspace_id: 'w' }, threadId: 't', log: () => {}, post: async () => new Response() } as never);
    return (tools as unknown as Array<{ name: string }>).map((t) => t.name).sort();
  };
  assert.deepEqual(chat(false), []);
  assert.deepEqual(chat(true), WEB);
  const web = webToolsFor({ agentName: 'patch', attach: async () => null, savedWhere: '' })!;
  assert.deepEqual(webOf(toolsForTurn('work', { dir: '/tmp', web }).map((d) => d.name)), WEB);
  assert.deepEqual(webOf(toolsForTurn('leg', { dir: '/tmp', web }).map((d) => d.name)), WEB);
  assert.deepEqual(webOf(toolsForTurn('sweep', { dir: '/tmp', web }).map((d) => d.name)), []);
});
