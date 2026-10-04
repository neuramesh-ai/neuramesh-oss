// the coding thread's GitHub gate (PR #694 review). Its mount ask is quiet: a connected answer opened the session,
// the machine refused, and the gate mounted again without end (findings 9 and 16). The quiet gate then left a dead
// end: a connected answer the person did not start here drew the grant face, and its one door went to GitHub for
// nothing (the replica lag after a pick, a short token failure, a grant from another surface, a reload). That
// answer has its own face now, and its one door opens the session once per click. The second round: the gate with no
// repository had no door at all (finding 5), and a mounted gate never heard of a grant on another surface (finding 7).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { createElement as h, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { githubConnectedMarker, needDecisionQuestion, parseNeed } from '@neuramesh/shared';
import { answersResolver } from '../answers';
import type { GitHubGrant } from '../settings/GitHubStep';
import { connectedSigns, GitHubGateFace } from './GitHubGate';

const grant = (over: Partial<GitHubGrant>): GitHubGrant => ({
  phase: 'idle', repos: null, hint: null, pick: null, setPick: () => {}, note: null, connected: null,
  ask: async () => false, grant: async () => {}, connect: async () => {}, ...over,
});
const gate = { channelId: 'c-1', room: 'dev', repoName: 'flowe-mobile', folder: true };
const draw = (props: Parameters<typeof GitHubGateFace>[0]) => renderToStaticMarkup(h(GitHubGateFace, props));

/** the elements a face draws, depth first: a face holds no hooks, so it runs as a plain function */
function* walk(node: ReactNode): Generator<ReactElement<Record<string, unknown>>> {
  if (Array.isArray(node)) { for (const n of node) yield* walk(n as ReactNode); return; }
  if (!node || typeof node !== 'object' || !('props' in node)) return;
  const el = node as ReactElement<Record<string, unknown>>;
  yield el;
  yield* walk(el.props.children as ReactNode);
}

test('a connected answer the person did not start here gets its own face, with one door', () => {
  const html = draw({ ...gate, g: grant({ connected: 'acme/flowe-mobile' }), onConnected: () => {} });
  assert.match(html, /<h2 class="hgateh">GitHub is connected<\/h2>/);
  assert.match(html, /<button[^>]*>Start the session<\/button>/);
  assert.doesNotMatch(html, /Connect GitHub|waits for GitHub/);
});

test('the door opens the session once per click, and nothing else does', () => {
  let opened = 0;
  const face = GitHubGateFace({ ...gate, g: grant({ connected: '' }), onConnected: () => { opened += 1; } });
  const doors = [...walk(face)].filter((el) => el.type === 'button');
  assert.equal(doors.length, 1);
  assert.equal(opened, 0);
  (doors[0]!.props.onClick as () => void)();
  assert.equal(opened, 1);
});

test('with no repository yet, the connected face keeps its door: it reads the room\'s repositories again', () => {
  let read = 0;
  const face = GitHubGateFace({ ...gate, repoName: null, folder: false, g: grant({ connected: 'acme/app' }), onConnected: () => { read += 1; } });
  const doors = [...walk(face)].filter((el) => el.type === 'button');
  assert.equal(doors.length, 1);
  (doors[0]!.props.onClick as () => void)();
  assert.equal(read, 1);
});

test('the wait on GitHub and the grant keep their faces', () => {
  assert.match(draw({ ...gate, g: grant({ phase: 'waiting', connected: 'acme/app' }), onConnected: () => {} }), /Finish on GitHub/);
  assert.match(draw({ ...gate, g: grant({}), onConnected: () => {} }), /Connect GitHub to code here/);
});

test('the gate is quiet: its mount ask never opens the session (GitHubStep answerFinishes)', () => {
  const src = readFileSync(join(import.meta.dirname, 'GitHubGate.tsx'), 'utf8');
  assert.match(src, /useGitHubGrant\([^;]*\{ quiet: true \}\)/);
});

// the GitHub card rex posted before the thread turned to code hides while the session waits, so the gate reads its row
const card = (id: string) => ({ id, author_kind: 'agent', body: 'I need to read the code.\n\n```nmneed\n{"channel":"c-1","ask":"Fix the build","why":"The app cannot read acme/app.","connect":["github"]}\n```' });
const asked = needDecisionQuestion(parseNeed(card('m-1').body)!)!;
const row = (status: string, answer: string | null) => ({ message_id: 'm-1', question: asked, status, answer });

test('the signs: the card\'s row the resume answered, and each connected divider', () => {
  const rows = [card('m-1'), { id: 'm-2', author_kind: 'agent', body: 'I open a code session on acme/app.' }];
  assert.equal(connectedSigns(rows, answersResolver(rows, [])), '');
  assert.equal(connectedSigns(rows, answersResolver(rows, [row('answered', 'Connected acme/app')])), 'm-1');
  const divider = [...rows, { id: 'm-3', author_kind: 'human', body: githubConnectedMarker('acme/app') }];
  assert.equal(connectedSigns(divider, answersResolver(divider, [row('answered', 'Connected acme/app')])), 'm-1 m-3');
});

test('a dismissed row or another answer is no sign', () => {
  const rows = [card('m-1')];
  assert.equal(connectedSigns(rows, answersResolver(rows, [row('dismissed', null)])), '');
  assert.equal(connectedSigns(rows, answersResolver(rows, [row('answered', 'Not now')])), '');
});

test('the gate asks again when a sign moves, never at mount: the quiet ask draws the connected face, not the session', () => {
  const src = readFileSync(join(import.meta.dirname, 'GitHubGate.tsx'), 'utf8');
  assert.match(src, /const signs = useContext\(GitHubSigns\);/);
  assert.match(src, /const was = useRef\(signs\);/);
  assert.match(src, /useEffect\(\(\) => \{ if \(was\.current === signs\) return; was\.current = signs; void ask\(\); \}, \[signs, ask\]\);/);
});
