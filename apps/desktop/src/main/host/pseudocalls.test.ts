import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stripPseudoToolCalls } from './pseudocalls';

const TOOLS = ['set_thread_title', 'create_task', 'add_backlog_item'];

// the live reply, verbatim shape (2026-09-17, Starter lane, routine "Starter lane check")
const LIVE = '```\nset_thread_title(title="Routine Starter Lane Check", description="Checking open tasks and room status.")\n```\n\nOpen tasks: eight.\nNewest task title: dependency audits.';

test('a fenced narrated call to an offered tool is dropped, the answer stays', () => {
  const r = stripPseudoToolCalls(LIVE, TOOLS);
  assert.equal(r.stripped, 1);
  assert.equal(r.text, 'Open tasks: eight.\nNewest task title: dependency audits.');
});

test('a bare narrated call on its own line is dropped too, with either prefix the bridges use', () => {
  const r = stripPseudoToolCalls('nm.create_task(title="x")\nDone.\nmcp__nm__add_backlog_item(title="y");', TOOLS);
  assert.equal(r.stripped, 2);
  assert.equal(r.text, 'Done.');
});

test('prose that mentions a tool, a fence with real content, and unknown names all stay untouched', () => {
  for (const t of [
    'I used set_thread_title to name this thread.',
    '```ts\nconst x = set_thread_title("a");\nreturn x;\n```',
    'frobnicate(title="x")',
    '```nms\n["Consolidate the duplicates", "Add missing requirements"]\n```',
  ]) {
    const r = stripPseudoToolCalls(t, TOOLS);
    assert.equal(r.stripped, 0, t);
    assert.equal(r.text, t);
  }
});

test('no tools offered, or no text: nothing happens', () => {
  assert.deepEqual(stripPseudoToolCalls(LIVE, []), { text: LIVE, stripped: 0 });
  assert.deepEqual(stripPseudoToolCalls('', TOOLS), { text: '', stripped: 0 });
});

test('a reply that was ONLY a narrated call empties out, so the caller stands down instead of posting noise', () => {
  const r = stripPseudoToolCalls('```\nset_thread_title(title="Only this")\n```', TOOLS);
  assert.equal(r.stripped, 1);
  assert.equal(r.text, '');
});
