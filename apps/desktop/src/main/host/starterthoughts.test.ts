// the starter brain's thoughts in codex's shape (host/starterthoughts.ts): what the live bubble's
// Thoughts block reads, and the cap that keeps every update small.
// Run from apps/desktop: node --import tsx --test src/main/host/starterthoughts.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STARTER_THOUGHTS_CAP, replyText, starterThoughts } from './starterthoughts';
import { thoughtStep } from '../runtime/codexsdk';

test('nothing yet reads as undefined, so an update with no thoughts adds no key', () => {
  const th = starterThoughts();
  assert.equal(th.text(), undefined);
  th.round();
  th.thought('   ');
  assert.equal(th.text(), undefined, 'whitespace alone opens no section');
});

test('codex\'s shape: the summary grows in its own section, each step is its own, and a new round opens a new summary', () => {
  const th = starterThoughts();
  th.thought('**Reading');
  th.thought(' the tree**\n');
  assert.equal(th.text(), '**Reading the tree**\n');
  th.step('list_repo_files', { path: 'src/storage' });
  th.step('read_repo_file', { path: 'src/storage/\n  adapter.ts', ref: 'main' });
  th.round();
  th.thought('\nFound it.');
  th.round();
  th.thought('Next round.');
  assert.equal(th.text(), [
    '**Reading the tree**',
    '› lists the repository files · src/storage',
    '› reads a repository file · src/storage/ adapter.ts',
    'Found it.',
    'Next round.',
  ].join('\n\n'));
});

// the review of round 2 (2026-10-05): a step printed the tool's name ("› create_task · …"), and the
// homepage clip shows rex's thoughts. it reads the run card's words now, and an unknown tool its words
test('a step reads exactly as codex\'s thoughtStep reads the same call, in words and never a tool name', () => {
  const args = { query: 'x'.repeat(300), limit: 5 };
  const th = starterThoughts();
  th.step('search_x', args);
  th.step('list_tasks', {});
  th.step('get_board', undefined);
  th.step('create_task', { title: 'Add an annual price toggle', kind: 'feature' });
  assert.equal(th.text(), [
    thoughtStep({ type: 'mcp_tool_call', tool: 'search_x', arguments: args }),
    '› checks the board',
    '› get board',
    '› creates the task · Add an annual price toggle',
  ].join('\n\n'));
  assert.doesNotMatch(th.text()!, /_/);
  assert.equal(thoughtStep({ type: 'command_execution', command: 'pnpm  test --run' }), '› runs pnpm test --run');
  assert.equal(thoughtStep({ type: 'web_search', query: 'annual pricing' }), '› searches the web · annual pricing');
});

test('the cap holds at 8000: past it, one … section, and the thoughts stop growing', () => {
  assert.equal(STARTER_THOUGHTS_CAP, 8000);
  const th = starterThoughts();
  const chunk = 'a'.repeat(99) + ' ';
  for (let i = 0; i < 79; i++) th.thought(chunk);
  const before = th.text()!;
  assert.equal(before.length, 7900);
  th.thought(chunk); // 8000: still fits
  assert.equal(th.text()!.length, 8000);
  th.thought('b'); // 8001: past the cap
  const capped = th.text()!;
  assert.equal(capped, `${before}${chunk}`.trimEnd() + '\n\n…');
  assert.ok(capped.length <= STARTER_THOUGHTS_CAP + '\n\n…'.length);
  th.thought('more words');
  th.step('list_tasks', { state: 'todo' });
  th.round();
  th.thought('a new round');
  assert.equal(th.text(), capped, 'nothing grows past the cap');
  assert.equal(capped.split('\n\n').filter((s) => s === '…').length, 1);
});

test('a step that would pass the cap ends the thoughts the same way', () => {
  const th = starterThoughts(40);
  th.thought('a'.repeat(30));
  th.step('list_repo_files', { path: 'src/storage' });
  assert.equal(th.text(), `${'a'.repeat(30)}\n\n…`);
});

test('the reply is every part the model did not mark as a thought', () => {
  const r = { candidates: [{ content: { parts: [{ text: 'Weighing it.', thought: true }, { text: 'Two ' }, { functionCall: { name: 'x' } } as never, { text: 'tasks.' }, null] } }] };
  assert.equal(replyText(r), 'Two tasks.');
  assert.equal(replyText({}), '');
  assert.equal(replyText(null), '');
});
