// Reading X rides the room's X CONNECTOR — ONE credential, one row in Connections.
//
// The live failure this pins: a routine fired "X engagement research for @joinflowe" into a
// room whose Connections panel showed X as ✓ connected. Four research legs fanned out with
// WebSearch/WebFetch only, hit x.com's 402 login wall, and came back with follower-count
// proxies labelled "high reach". The connector was real — nothing read it.
//
// The first fix asked each user to paste their own X app's Bearer Token, which is fine for a
// developer and impossible for a customer, and left TWO "X" rows in Connections for one
// capability. Now the Connect button's own token does both: its scopes already include
// `tweet.read` (connectors.ts X_SCOPES), X's recent-search accepts OAuth 2.0 user context, and
// the read happens server-side so the sealed token never leaves the API process.
//
// Run from apps/desktop:
//   pnpm exec tsx --test src/main/xresearch.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mcpServersFor, mcpKeyPresence } from './mkmcp';
import { xResearchNote, xPublishConnectedFor } from './agents';

// ── the capability is the CONNECTOR, and nothing else offers it ──────────────────────────
test('the marketing MCP layer has no X provider at all — one X credential, not two', () => {
  // a stale `x` toggle/key from the retired BYOK round must not resurrect a second path
  assert.equal('x' in mcpServersFor({ posthog: true } as never, { posthog: 'k' } as never), false);
  assert.equal('x' in mcpKeyPresence({}), false);
});

// ── the prompt: say which capability exists, never let "connected" imply neither ──────────
test('a connected X account means READABLE — the note names the tool and warns it is metered', () => {
  const note = xResearchNote(true);
  assert.match(note, /search_x/);
  assert.doesNotMatch(note, /NOT AVAILABLE/);
  assert.match(note, /metered/);
  // WebFetch/WebSearch are the wrong tool for X even when they exist on the turn
  assert.match(note, /Do NOT answer X questions with WebFetch or WebSearch/);
  // and it must never send someone hunting for a developer app
  assert.doesNotMatch(note, /[Bb]earer|developer app|API key/);
});

test('no connected account → SILENT, because the refusal is enforced by the tool, not prompted', () => {
  // search_x still exists on that turn: the agent calls it, gets the 409, and the tool result
  // dictates the answer ("say so plainly… do NOT estimate engagement numbers"). A prompt arm
  // saying the same thing would be a second, weaker copy of an enforced rule — and a room that
  // never touches X should pay nothing for this.
  assert.equal(xResearchNote(false), '');
});

// ── whether a connector serves this ROOM (project-scoped, 0106) ───────────────────────────
const dbOf = (rows: Array<{ provider: string }>, capture?: { sql?: string; params?: unknown[] }) => ({
  getAll: async (sql: string, params?: unknown[]) => {
    if (capture) { capture.sql = sql; capture.params = params; }
    return rows as never[];
  },
});

test('an X connector on the room’s project counts; the query is project-scoped and X-only', async () => {
  const cap: { sql?: string; params?: unknown[] } = {};
  const ch = { id: 'c1', workspace_id: 'w1' };
  assert.equal(await xPublishConnectedFor(dbOf([{ provider: 'x' }], cap), ch), true);
  assert.match(cap.sql!, /provider = 'x'/);
  assert.match(cap.sql!, /project_id/); // NOT channel-keyed — that reported "none" in every
  assert.match(cap.sql!, /status = 'connected'/); // room but the one where OAuth happened
  assert.deepEqual(cap.params, ['w1', 'c1']);
});

test('no rows → false, and a replica read that throws degrades to false rather than the turn', async () => {
  const ch = { id: 'c1', workspace_id: 'w1' };
  assert.equal(await xPublishConnectedFor(dbOf([]), ch), false);
  const boom = { getAll: async () => { throw new Error('replica not ready'); } };
  assert.equal(await xPublishConnectedFor(boom, ch), false);
});
