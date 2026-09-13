import assert from 'node:assert/strict';
import { test } from 'node:test';
import { claudeDesignCliCommand, claudeDesignNeedsAuthorization, claudeDesignProjectWatch, claudeDesignWorkspace } from './claudedesign';

test('Claude Design opens in the task workspace instead of the user home', () => {
  const cwd = claudeDesignWorkspace(1005, null, { home: '/home/dev', exists: () => false });
  assert.equal(cwd, '/home/dev/.neuramesh/cache/design/nm-1005');
  assert.equal(claudeDesignCliCommand('/opt/Claude Code/bin/claude'), "'/opt/Claude Code/bin/claude'");
});

test('a linked repo or existing design clone is preferred for Claude context', () => {
  const linked = claudeDesignWorkspace(1005, '/work/acme marketing', {
    home: '/home/dev',
    exists: (path) => path === '/work/acme marketing',
  });
  assert.equal(linked, '/work/acme marketing');

  const cloned = claudeDesignWorkspace(1005, null, {
    home: '/home/dev',
    exists: (path) => path.endsWith('/nm-1005/repo'),
  });
  assert.equal(cloned, '/home/dev/.neuramesh/cache/design/nm-1005/repo');
});

test('integrated terminal command safely quotes the Claude binary path', () => {
  const command = claudeDesignCliCommand('/home/o\'connor/Claude Code/bin/claude');
  assert.equal(command, `'/home/o'"'"'connor/Claude Code/bin/claude'`);
});

test('Claude Design consent is recognized as recoverable instead of a missing-mockup failure', () => {
  assert.equal(claudeDesignNeedsAuthorization(
    "I need Claude Design access to proceed, but it isn't granted yet. Authorization is pending on your side.",
  ), true);
  assert.equal(claudeDesignNeedsAuthorization(
    'Run /design consent, then retry the Claude Design tools.',
  ), true);
  assert.equal(claudeDesignNeedsAuthorization(
    'Created the Claude Design project and exported landing-page.html.',
  ), false);
  assert.equal(claudeDesignNeedsAuthorization(
    'The design run produced no mockup files.',
  ), false);
});

// The #1034 regression, replayed from agent-logs rows 2979–2982. The model called
// list_projects (NOT create_project), and the old blind scan harvested the first id in
// that listing — a project the task had nothing to do with — sliced in half by the
// 160-char summary cap on the way out. Provenance, not pattern-matching.
test('a list_projects result never becomes the task project (#1034)', () => {
  const w = claudeDesignProjectWatch();
  const listing = '[{"id":"9c0ce167-0db6-4c46-858f-2c8f7f8c61c6","name":"neuramesh","url":"https://claude.ai/design/p/9c0ce167-0db6-4c46-858f-2c8f7f8c61c6"},{"id":"e031e8ed-7d85-454a-b1d4-ccb1d1059b52","name":"Acme Robotics"}]';
  assert.equal(w.observe({ phase: 'call', summary: 'mcp__claude-design__list_projects', toolUseId: 'tu_1' }), null);
  assert.equal(w.observe({ phase: 'result', summary: `→ ${listing.slice(0, 160)}`, detail: listing, toolUseId: 'tu_1' }), null);
  assert.equal(w.url, null);
});

test('only the create_project call\'s OWN result names the project', () => {
  const w = claudeDesignProjectWatch();
  const made = '{"id":"11111111-2222-3333-4444-555555555555","url":"https://claude.ai/design/p/11111111-2222-3333-4444-555555555555"}';
  w.observe({ phase: 'call', summary: 'mcp__claude-design__list_projects', toolUseId: 'tu_1' });
  w.observe({ phase: 'result', summary: 'listing', detail: '[{"url":"https://claude.ai/design/p/99999999-9999-9999-9999-999999999999"}]', toolUseId: 'tu_1' });
  w.observe({ phase: 'call', summary: 'mcp__claude-design__create_project', toolUseId: 'tu_2' });
  const found = w.observe({ phase: 'result', summary: '→ {"id":"1111', detail: made, toolUseId: 'tu_2' });
  assert.equal(found, 'https://claude.ai/design/p/11111111-2222-3333-4444-555555555555');
  assert.equal(w.url, found);
});

test('the URL is read from detail, never the truncated summary', () => {
  const w = claudeDesignProjectWatch();
  const full = '{"url":"https://claude.ai/design/p/abcdef12-3456-7890-abcd-ef1234567890"}';
  w.observe({ phase: 'call', summary: 'mcp__claude-design__create_project', toolUseId: 'tu_1' });
  // summary is cut mid-uuid exactly as drainQuery's slice(0,160) does
  const found = w.observe({ phase: 'result', summary: '→ {"url":"https://claude.ai/design/p/abcdef12-3456-7890-abcd-ef', detail: full, toolUseId: 'tu_1' });
  assert.equal(found, 'https://claude.ai/design/p/abcdef12-3456-7890-abcd-ef1234567890');
});

test('prose in the model summary is not provenance', () => {
  const w = claudeDesignProjectWatch();
  // a turn message, not a tool result — no toolUseId correlation, so it is ignored
  assert.equal(w.observe({ summary: 'Done! The project is at https://claude.ai/design/p/deadbeef-0000-1111-2222-333344445555' }), null);
  assert.equal(w.url, null);
});
