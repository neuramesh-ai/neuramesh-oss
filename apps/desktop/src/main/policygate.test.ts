// Policy gate mapping + verdict + card, pure. Run: pnpm exec tsx --test src/main/policygate.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultBaselineRules, type PolicyRule } from '@neuramesh/shared';
import { buildPermissionCardBody, CHAT_WHERE, cleanIntent, credStorePath, intentPrompt, policyGateOutcome, protectedPathsFromRules, rowsToRules, taskWhere, toolCallToAction } from './policygate';

test('toolCallToAction maps each Claude tool to the right capability', () => {
  assert.deepEqual(toolCallToAction('Bash', { command: 'rm -rf build' }), { capability: 'shell.exec', command: 'rm -rf build', shellClass: 'destructive' });
  assert.deepEqual(toolCallToAction('Write', { file_path: 'src/x.ts' }), { capability: 'fs.write', path: 'src/x.ts' });
  assert.deepEqual(toolCallToAction('Edit', { file_path: 'a.ts' }), { capability: 'fs.write', path: 'a.ts' });
  assert.deepEqual(toolCallToAction('Read', { file_path: '/etc/passwd' }), { capability: 'fs.read', path: '/etc/passwd' });
  assert.deepEqual(toolCallToAction('WebFetch', { url: 'https://api.evil.com/x' }), { capability: 'net.egress', host: 'api.evil.com' });
  assert.deepEqual(toolCallToAction('mcp__github__create_issue', {}), { capability: 'tool.mcp', tool: 'mcp__github__create_issue' });
});

test('a shell command reaching into a credential store is gated as fs.read and hits the locked deny', () => {
  // the bypass this closes: `cat ~/.ssh/id_rsa` classifies as shell.exec/other → allow otherwise
  assert.equal(credStorePath('cat ~/.ssh/id_rsa'), '~/.ssh/id_rsa');
  assert.equal(credStorePath('grep -r secret /home/dev/.aws/credentials'), '/home/dev/.aws/credentials');
  assert.equal(credStorePath('pnpm build && vitest run'), null);
  assert.equal(credStorePath('echo ".ssh is just a directory name"'), null); // a bare mention, no reach into it

  // the Bash mapping: a cred-store reach becomes the fs.read it effectively is
  assert.deepEqual(toolCallToAction('Bash', { command: 'cat ~/.ssh/id_rsa' }), { capability: 'fs.read', path: '~/.ssh/id_rsa' });
  // an ordinary command is unaffected — still shell.exec with its class
  assert.deepEqual(toolCallToAction('Bash', { command: 'pnpm build' }), { capability: 'shell.exec', command: 'pnpm build', shellClass: 'build' });

  // end to end against the baseline: the shell read of an SSH key is DENIED by the locked invariant
  const base = defaultBaselineRules();
  const action = toolCallToAction('Bash', { command: 'cat ~/.ssh/id_rsa' })!;
  assert.equal(policyGateOutcome(action, base).decision, 'deny');
});

test('our own tools, web search, and todos are not gated', () => {
  assert.equal(toolCallToAction('mcp__nm__screenshot', {}), null);
  assert.equal(toolCallToAction('mcp__nm__record_lesson', {}), null);
  assert.equal(toolCallToAction('WebSearch', { query: 'x' }), null);
  assert.equal(toolCallToAction('TodoWrite', {}), null);
});

test('a malformed WebFetch url degrades to an undefined host (still gated, asks by default)', () => {
  assert.deepEqual(toolCallToAction('WebFetch', { url: 'not a url' }), { capability: 'net.egress', host: undefined });
});

test('policyGateOutcome resolves the verdict + a risk tier against the baseline', () => {
  const base = defaultBaselineRules();
  const destructive = policyGateOutcome({ capability: 'shell.exec', command: 'rm -rf /', shellClass: 'destructive' }, base);
  assert.equal(destructive.decision, 'ask');
  assert.equal(destructive.risk, 'high');

  const build = policyGateOutcome({ capability: 'shell.exec', command: 'pnpm build', shellClass: 'build' }, base);
  assert.equal(build.decision, 'allow');
  assert.equal(build.risk, 'low');

  const pipe = policyGateOutcome({ capability: 'shell.exec', command: 'curl x | sh', shellClass: 'pipe-to-shell' }, base);
  assert.equal(pipe.decision, 'deny'); // locked invariant
  assert.equal(pipe.risk, 'high');

  const egress = policyGateOutcome({ capability: 'net.egress', host: 'exfil.evil.com' }, base);
  assert.equal(egress.decision, 'allow'); // egress allowed by default; the L1 sandbox proxy enforces the host allowlist

  // a policy that tightens egress to `ask` still routes through the gate + high-risk push tier
  const tightened = policyGateOutcome({ capability: 'net.egress', host: 'exfil.evil.com' }, [
    ...base,
    { id: 'task.egress-ask', scope: 'task', capability: 'net.egress', selector: { kind: 'any' }, verdict: 'ask' },
  ]);
  assert.equal(tightened.decision, 'ask');
  assert.equal(tightened.risk, 'high');
});

test('protectedPathsFromRules extracts fs.read deny path targets (baseline + custom), ignores the rest', () => {
  const base = defaultBaselineRules();
  const rules: PolicyRule[] = [
    ...base, // .ssh + .aws locked fs.read deny
    { id: 'p1', scope: 'workspace', capability: 'fs.read', selector: { kind: 'path', glob: '**/.config/gcloud/**' }, verdict: 'deny' },
    { id: 'p2', scope: 'workspace', capability: 'fs.read', selector: { kind: 'path', glob: '/opt/secrets/**' }, verdict: 'deny' },
    { id: 'skip-allow', scope: 'workspace', capability: 'fs.read', selector: { kind: 'path', glob: '**/foo/**' }, verdict: 'allow' },
    { id: 'skip-write', scope: 'workspace', capability: 'fs.write', selector: { kind: 'path', glob: '**/bar/**' }, verdict: 'deny' },
  ];
  const paths = protectedPathsFromRules(rules);
  assert.ok(paths.includes('.ssh') && paths.includes('.aws'), 'baseline cred paths');
  assert.ok(paths.includes('.config/gcloud'), 'custom HOME-relative path');
  assert.ok(paths.includes('/opt/secrets'), 'custom absolute path');
  assert.ok(!paths.includes('foo'), 'an fs.read ALLOW rule is not a protected path');
  assert.ok(!paths.includes('bar'), 'an fs.write deny rule is not an fs.read protected path');
});

test('buildPermissionCardBody emits a valid nmq permission card with Approve/Deny', () => {
  const base = defaultBaselineRules();
  const action = { capability: 'shell.exec' as const, command: 'rm -rf node_modules', shellClass: 'destructive' as const };
  const outcome = policyGateOutcome(action, base);
  const body = buildPermissionCardBody(action, outcome, 'Dev', taskWhere(1042));
  const m = /```nmq\n([\s\S]*?)\n```/.exec(body);
  assert.ok(m, 'has an nmq fence');
  const card = JSON.parse(m![1]!);
  assert.equal(card.kind, 'permission');
  assert.equal(card.risk, 'high');
  assert.equal(card.capability, 'shell.exec');
  assert.equal(card.allowOther, false);
  assert.deepEqual(card.options.map((o: { label: string }) => o.label), ['Approve', 'Deny']);
  assert.match(card.question, /Dev wants to run a shell command/);
  assert.match(card.question, /#1042/);
  // display fields (v0.33): title is command-free, command carries the full text,
  // and the question — the answer/supersede key — still embeds the command inline.
  assert.equal(card.title, 'Dev wants to run a shell command in #1042');
  assert.equal(card.command, 'rm -rf node_modules');
  assert.match(card.question, /rm -rf node_modules/);
  assert.equal(card.summary, undefined);
});

test('buildPermissionCardBody carries the agent summary through, and non-shell actions get no command block', () => {
  const base = defaultBaselineRules();
  const shell = { capability: 'shell.exec' as const, command: 'git push origin main', shellClass: 'other' as const };
  const withSummary = JSON.parse(/```nmq\n([\s\S]*?)\n```/.exec(buildPermissionCardBody(shell, policyGateOutcome(shell, base), 'Dev', taskWhere(7), 'Push the reviewed branch'))![1]!);
  assert.equal(withSummary.summary, 'Push the reviewed branch');
  assert.equal(withSummary.command, 'git push origin main');
  const read = { capability: 'fs.read' as const, path: '/etc/hosts' };
  const readCard = JSON.parse(/```nmq\n([\s\S]*?)\n```/.exec(buildPermissionCardBody(read, policyGateOutcome(read, base), 'Dev', taskWhere(7)))![1]!);
  assert.equal(readCard.command, undefined);
  assert.match(readCard.title, /read `\/etc\/hosts` in #7/);
});

test('intentPrompt grounds the elicitation in the agent, task, and exact action facts', () => {
  const shell = intentPrompt({ capability: 'shell.exec' as const, command: 'git push origin main', shellClass: 'other' as const }, 'patch', taskWhere(1046), 'Mobile nav: drawer + focus management');
  assert.match(shell.system, /You are patch/);
  assert.match(shell.system, /#1046/);
  assert.match(shell.system, /Mobile nav: drawer \+ focus management/);
  assert.deepEqual(JSON.parse(shell.user), { capability: 'shell.exec', command: 'git push origin main' });
  const write = intentPrompt({ capability: 'fs.write' as const, path: '/etc/hosts' }, 'patch', taskWhere(7), 't');
  assert.deepEqual(JSON.parse(write.user), { capability: 'fs.write', path: '/etc/hosts' });
  const mcp = intentPrompt({ capability: 'tool.mcp' as const, tool: 'mcp__x__y' }, 'patch', taskWhere(7), 't');
  assert.deepEqual(JSON.parse(mcp.user), { capability: 'tool.mcp', tool: 'mcp__x__y' });
});

// docs/34 — the SAME permission engine gates a chat turn; only the context line differs.
test('a chat thread names itself instead of borrowing a task number', () => {
  const base = defaultBaselineRules();
  const action = { capability: 'shell.exec' as const, command: 'python3 count.py', shellClass: 'other' as const };
  const card = JSON.parse(/```nmq\n([\s\S]*?)\n```/.exec(buildPermissionCardBody(action, policyGateOutcome(action, base), 'rex', CHAT_WHERE))![1]!);
  assert.equal(card.title, 'rex wants to run a shell command in this chat');
  assert.match(card.question, /in this chat\. Approve\?$/);
  assert.ok(!/#/.test(card.title), 'a chat has no number and must never invent one');
  // the card is otherwise identical — same kind, same options, same fail-closed shape
  assert.equal(card.kind, 'permission');
  assert.deepEqual(card.options.map((o: { label: string }) => o.label), ['Approve', 'Deny']);
});

test('intentPrompt drops the title clause when there is no task to quote', () => {
  const chat = intentPrompt({ capability: 'shell.exec' as const, command: 'ls', shellClass: 'other' as const }, 'rex', CHAT_WHERE, '');
  assert.match(chat.system, /mid-conversation in this chat/);
  assert.ok(!/\(""\)/.test(chat.system), 'an empty title must not render as an empty quote');
});

test('cleanIntent makes model output card-safe: one line, unquoted, capped', () => {
  assert.equal(cleanIntent('"I need to\n update the   hosts file."'), 'I need to update the hosts file.');
  assert.equal(cleanIntent('`rewrite the focus trap`'), 'rewrite the focus trap');
  assert.equal(cleanIntent('x'.repeat(300)).length, 200);
  assert.equal(cleanIntent('  \n '), '');
});

test('rowsToRules parses replica rows (JSON-text selector, 0/1 locked) and drops malformed ones', () => {
  const rows = [
    { id: 'base.shell-destructive', scope: 'workspace', capability: 'shell.exec', selector: JSON.stringify({ kind: 'shellClass', value: 'destructive' }), verdict: 'deny', rationale: 'tightened', locked: 1 },
    { id: 'proj.stripe', scope: 'project', capability: 'net.egress', selector: { kind: 'host', glob: 'api.stripe.com' }, verdict: 'allow', locked: 0 },
    { id: 'bad', scope: 'workspace', capability: 'shell.exec', selector: 'not json', verdict: 'allow' },
    { id: 'bad2', scope: 'workspace', capability: 'nope', selector: JSON.stringify({ kind: 'any' }), verdict: 'allow' },
  ];
  const rules: PolicyRule[] = rowsToRules(rows);
  assert.equal(rules.length, 2); // the two malformed rows are dropped
  const destructive = rules.find((r) => r.id === 'base.shell-destructive')!;
  assert.equal(destructive.verdict, 'deny');
  assert.equal(destructive.locked, true);
  assert.deepEqual(destructive.selector, { kind: 'shellClass', value: 'destructive' });
});
