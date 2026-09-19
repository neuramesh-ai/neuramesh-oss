// THE STARTER LANE'S WIRING — the half of #354 that policy tests cannot reach.
//
// `decideAuth` returning 'starter' is already covered (runtime/authpolicy.test.ts). What was not
// covered is what the turn then DOES with that decision, and that is where the money is: the
// platform's Google key lives in control-api precisely so a machine can never hold it, and the
// only thing keeping a house-brain turn on the metered path is this dispatch. A silent fall-back
// to a direct Google call would still answer the user — correctly, even — while spending our key
// with no balance guard and no meter row. It would look like success.
//
// So these tests assert the paths that fail INVISIBLY: that the proxy is used, that a stray
// GEMINI_API_KEY cannot rescue the lane, and that running out of credits is something the
// orchestrator says rather than something it dies of.
import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { z } from 'zod';
import { geminiDispatch, geminiOrchestratorTurn, zodShapeToGemini } from './orchturn';
import type { OrchTool } from './orchtools';

const BASE = {
  model: 'gemini-3.5-flash-lite',
  token: '',
  systemPrompt: 'you are the orchestrator',
  transcript: 'hello',
  tools: [] as OrchTool[],
};
const CTX = { apiUrl: 'https://api.test', workspace: 'ws-1', actorId: 'u-1' };

/** replaces fetch with a scripted queue and records every call for assertion */
function stubFetch(replies: Array<{ status?: number; body?: unknown }>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    const next = replies.shift() ?? { status: 500, body: {} };
    return {
      ok: (next.status ?? 200) < 400,
      status: next.status ?? 200,
      json: async () => next.body ?? {},
    };
  }) as unknown as typeof globalThis.fetch;
  return { calls, restore: () => { globalThis.fetch = real; } };
}

/** a raw-REST answer, the shape the proxy passes through from Google */
const restText = (text: string) => ({ candidates: [{ content: { role: 'model', parts: [{ text }] } }] });
const restCall = (name: string, args: Record<string, unknown>) =>
  ({ candidates: [{ content: { role: 'model', parts: [{ functionCall: { name, args } }] } }] });

let undo: (() => void) | null = null;
afterEach(() => { undo?.(); undo = null; delete process.env['GEMINI_API_KEY']; });

describe('geminiDispatch — which transport a house turn takes', () => {
  test('a house model with no token goes through the metered proxy', async () => {
    const f = stubFetch([{ body: restText('hi') }]); undo = f.restore;
    const out = await geminiDispatch({ ...BASE }, { houseModel: true, ...CTX });
    assert.equal(out, 'hi');
    assert.equal(f.calls.length, 1, 'the turn must reach control-api, not Google');
    assert.equal(f.calls[0]?.url, 'https://api.test/v1/starter/generate');
  });

  test('the actor rides the request, so the proxy can check membership', async () => {
    const f = stubFetch([{ body: restText('ok') }]); undo = f.restore;
    await geminiDispatch({ ...BASE }, { houseModel: true, ...CTX });
    const headers = f.calls[0]?.init.headers as Record<string, string>;
    assert.deepEqual(JSON.parse(headers['x-nm-actor'] ?? '{}'), { kind: 'human', id: 'u-1' });
    const body = JSON.parse(String(f.calls[0]?.init.body));
    assert.equal(body.workspace, 'ws-1');
    assert.equal(body.system, 'you are the orchestrator');
  });
});

describe('the starter lane cannot be rescued into being free', () => {
  test('a GEMINI_API_KEY in the environment does NOT divert the turn off the meter', async () => {
    // the hole this lane exists to close: a key sitting in a machine's environment would make
    // the house brain answer for nothing, unguarded and unrecorded — and look perfectly healthy
    process.env['GEMINI_API_KEY'] = 'sk-a-key-that-must-not-be-used';
    const f = stubFetch([{ body: restText('still metered') }]); undo = f.restore;
    const out = await geminiOrchestratorTurn({ ...BASE, starter: true, ...CTX });
    assert.equal(out, 'still metered');
    assert.equal(f.calls.length, 1, 'an env key must not take the turn off the proxy');
  });
});

describe('running out of credits is a thing to say', () => {
  test('402 surfaces as a readable refusal, never an empty turn', async () => {
    const f = stubFetch([{ status: 402, body: { code: 'NO_CREDITS' } }]); undo = f.restore;
    await assert.rejects(
      geminiOrchestratorTurn({ ...BASE, starter: true, ...CTX }),
      (e: Error) => {
        // the human has to learn what to DO — an empty turn teaches nothing
        assert.match(e.message, /credits/i);
        assert.match(e.message, /connect your own brain|refill/i);
        return true;
      },
    );
    assert.equal(f.calls.length, 1);
  });

  test('any other failure names its status rather than answering blankly', async () => {
    const f = stubFetch([{ status: 503, body: {} }]); undo = f.restore;
    await assert.rejects(geminiOrchestratorTurn({ ...BASE, starter: true, ...CTX }), /503/);
  });
});

describe('the proxy answers raw REST, and the loop must not be able to tell', () => {
  test('a function call in candidates[].parts runs the tool and feeds the result back', async () => {
    // the SDK exposes r.functionCalls; the proxy does not. this normalization is the difference
    // between the starter orchestrator having tools and silently having none.
    const ran: Array<Record<string, unknown>> = [];
    const tool: OrchTool = {
      name: 'list_tasks',
      description: 'list the board',
      schema: { state: z.string().describe('which column') },
      run: async (input) => { ran.push(input); return 'two tasks'; },
    };
    const f = stubFetch([
      { body: restCall('list_tasks', { state: 'todo' }) },
      { body: restText('you have two tasks') },
    ]);
    undo = f.restore;

    const out = await geminiOrchestratorTurn({ ...BASE, tools: [tool], starter: true, ...CTX });
    assert.equal(out, 'you have two tasks');
    assert.deepEqual(ran, [{ state: 'todo' }], 'the tool must actually run');

    // the second request carries the tool result back to the model
    const second = JSON.parse(String(f.calls[1]?.init.body));
    const parts = second.contents.at(-1).parts;
    assert.equal(parts[0].functionResponse.name, 'list_tasks');
    assert.equal(parts[0].functionResponse.response.result, 'two tasks');
  });

  test('a tool that throws is reported to the model instead of killing the turn', async () => {
    const tool: OrchTool = {
      name: 'list_tasks', description: 'list the board', schema: {},
      run: async () => { throw new Error('board unreachable'); },
    };
    const f = stubFetch([
      { body: restCall('list_tasks', {}) },
      { body: restText('I could not read the board') },
    ]);
    undo = f.restore;
    const out = await geminiOrchestratorTurn({ ...BASE, tools: [tool], starter: true, ...CTX });
    assert.equal(out, 'I could not read the board');
    const second = JSON.parse(String(f.calls[1]?.init.body));
    assert.match(second.contents.at(-1).parts[0].functionResponse.response.result, /board unreachable/);
  });

  test('an empty answer stands down rather than posting a placeholder', async () => {
    const f = stubFetch([{ body: restText('   ') }]); undo = f.restore;
    const out = await geminiOrchestratorTurn({ ...BASE, starter: true, ...CTX });
    assert.equal(out, '', 'ORCH_EMPTY_TURN — say nothing rather than say nothing loudly');
  });
});

describe('zodShapeToGemini — the schema the house model is handed', () => {
  const Type = { STRING: 'STRING', NUMBER: 'NUMBER', BOOLEAN: 'BOOLEAN', ARRAY: 'ARRAY', OBJECT: 'OBJECT' };
  test('an array of objects nests: draft_posts read as items STRING and the model answered fragments ten times', () => {
    const shape = {
      posts: z.array(z.object({
        platform: z.enum(['x', 'linkedin']).describe('the network'),
        body: z.string().min(1).describe('the caption'),
        imageBrief: z.string().optional(),
        beats: z.array(z.string()).optional(),
      })).min(1).describe('one entry per post'),
      dryRun: z.boolean().optional(),
      count: z.number().default(3),
    };
    const out = zodShapeToGemini(shape, Type as never);
    assert.deepEqual(out, {
      type: 'OBJECT',
      properties: {
        posts: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              platform: { type: 'STRING', enum: ['x', 'linkedin'], description: 'the network' },
              body: { type: 'STRING', description: 'the caption' },
              imageBrief: { type: 'STRING' },
              beats: { type: 'ARRAY', items: { type: 'STRING' } },
            },
            required: ['platform', 'body'],
          },
          description: 'one entry per post',
        },
        dryRun: { type: 'BOOLEAN' },
        count: { type: 'NUMBER' },
      },
      required: ['posts'],
    });
  });
  test('a no-arg tool omits parameters, and an optional array of objects unwraps its items too', () => {
    assert.equal(zodShapeToGemini({}, Type as never), undefined);
    const out = zodShapeToGemini({ rows: z.array(z.object({ a: z.string() }).optional()) }, Type as never);
    assert.deepEqual(out.properties.rows.items, { type: 'OBJECT', properties: { a: { type: 'STRING' } }, required: ['a'] });
  });
});
