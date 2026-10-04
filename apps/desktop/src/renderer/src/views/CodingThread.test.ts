// the coding thread hands each card in its rows the card's decision row (PR #694 review). rex posts the GitHub card,
// then opens a code session on the same ask, so the card sits above the root. Drawn with no answers, it never read
// its row: a grant from another surface left it on 'Waits for GitHub', and after the App lost access an answered card
// waited again and promised a resume that no grant gives. The view loads a CSS module, which the node runner cannot,
// so this reads its source, as engineering/layout.test.ts does.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const src = readFileSync(join(import.meta.dirname, 'CodingThread.tsx'), 'utf8');

test('the coding thread builds the cards\' answers from its rows and the room\'s decision rows', () => {
  assert.match(src, /decisions: AnswerDecisionRow\[\];/);
  assert.match(src, /answersResolver\(rows, decisions\)/);
});

test('each row hands its card the answers, above the transcript and below it', () => {
  assert.match(src, /<Md text=\{m\.body\.replace\(MARKER_RE, ''\)\.trim\(\)\} answers=\{answers\(m\.id\)\} \/>/);
  assert.equal(src.match(/<ThreadRows [^>]*answers=\{answersFor\}/g)?.length, 2);
});

// the second round. The gate with no repository had no door (finding 5): the room's repositories are a one-shot read
// per room in App, so a repository attached after that read never reached the thread, and the session never opened.
test('the gate with no repository has a door: a pick or Start the session reads the room\'s repositories again', () => {
  assert.match(src, /onReposChanged: \(\) => void;/);
  assert.match(src, /<GitHubGate [^>]*onConnected=\{onReposChanged\} \/>/);
  const app = readFileSync(join(import.meta.dirname, '..', 'App.tsx'), 'utf8');
  assert.match(app, /<CodingThread [\s\S]*?onReposChanged=\{\(\) => \{ if \(current && nm\) void nm\.channelMeta\(current\.id\)\.then\(\(r\) => setMeta\(\{ projects: r\?\.projects \?\? \[\], repos: r\?\.repos \?\? \[\], reposAll: r\?\.reposAll \?\? \[\] \}\)\)/);
});

// a grant on another surface answers the hidden card's row and posts a divider, and the gate never heard of it (finding 7)
test('the gate seat hears the thread\'s signs that GitHub connected', () => {
  assert.match(src, /const signs = useMemo\(\(\) => connectedSigns\(rows, answersFor\), \[rows, answersFor\]\);/);
  assert.match(src, /<GitHubSigns\.Provider value=\{signs\}>/);
});

// the card hid only behind the stored wait, so a room with no repository drew the card above the gate's own door, and a
// stale wait hid a live approval. The card hides exactly when the seat holds the GitHub gate, and an approval ranks first.
test('the card hides exactly when the seat holds the GitHub gate', () => {
  assert.match(src, /const seatAsksGitHub = active \? active\.blockedOn === 'github' && !active\.pendingApproval : !repoRow && !codeSession;/);
  assert.match(src, /<ThreadRows rows=\{prelude\} [^>]*hideNeeds=\{seatAsksGitHub\} \/>/);
  assert.match(src, /\{active && act \? \([\s\S]*?\) : !repoRow && !codeSession \? \(/);
  const gate = readFileSync(join(import.meta.dirname, '..', 'thread', 'CodingGate.tsx'), 'utf8');
  const approval = gate.indexOf('if (session.pendingApproval) return <ApprovalCard');
  assert.ok(approval > 0 && approval < gate.indexOf("if (session.blockedOn === 'github') return <GitHubGate"));
});

// with no session open, nothing drew the root: the gate said "the session starts with your message" under no message
test('the person\'s own first message stays in view until a session draws it', () => {
  assert.match(src, /const opened = !!active;/);
  assert.match(src, /const prelude = useMemo\(\(\) => rows\.filter\(\(m\) => \(m\.id !== root\?\.id \|\| !opened\) && !parseTaskUnitRef\(m\.body\)\), \[rows, root\?\.id, opened\]\);/);
});
