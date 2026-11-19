#!/usr/bin/env node
// the name of a commit and of a pull request (George, 2026-11-14).
//
//   node scripts/commit-name.mjs "fix(boards): open the hq sign-in from the door"
//   node scripts/commit-name.mjs --file .git/COMMIT_EDITMSG     # the commit-msg hook
//
// a name follows Conventional Commits: type(scope): subject. a pull request is squashed into one
// commit that takes its title, so the title is the name that main records. this file is the one
// rule: the commit-msg hook, the pull request check and scripts/pr-land.sh all run it.
import { readFileSync } from 'node:fs';

/** what a change is. `!` after the type or the scope marks a change that breaks a contract */
export const TYPES = ['feat', 'fix', 'docs', 'refactor', 'perf', 'test', 'build', 'ci', 'chore', 'revert'];
export const MAX = 100;
const FORMAT = 'type(scope): subject';
const EXAMPLE = 'fix(boards): open the hq sign-in from the door';

/** names that git writes, and the title that the desktop app gives the pull request of a task */
const EXEMPT = [/^Merge /, /^Revert "/, /^(fixup|squash|amend)! /, /^#\d+ \S/];

/** the first line of a message, less the pull request number that a squash merge adds */
export function nameOf(text) {
  return String(text ?? '').split('\n')[0].trim().replace(/ \(#\d+\)$/, '');
}

/** { ok: true } or { ok: false, reason } for one name */
export function check(text) {
  const name = nameOf(text);
  if (!name) return { ok: false, reason: 'The name is empty.' };
  if (EXEMPT.some((r) => r.test(name))) return { ok: true };
  const m = /^([A-Za-z]+)(?:\(([^()]*)\))?(!)?: (.*)$/.exec(name);
  if (!m) return { ok: false, reason: `Write the name as ${FORMAT}. The scope is optional.` };
  const [, type, scope, , subject] = m;
  if (!TYPES.includes(type)) return { ok: false, reason: `"${type}" is not a type. Use one of: ${TYPES.join(', ')}.` };
  if (scope !== undefined && !/^[a-z0-9][a-z0-9./-]*$/.test(scope)) {
    return { ok: false, reason: 'Write the scope with lowercase letters, digits, dots, slashes and hyphens.' };
  }
  if (!subject || subject !== subject.trim()) return { ok: false, reason: 'Put one space after the colon, then the subject.' };
  // a name in capitals (NM_BOARDS_URL, CLAUDE.md) can start a subject. an ordinary word cannot
  if (/^[A-Z][a-z]/.test(subject)) return { ok: false, reason: 'Start the subject with a lowercase letter.' };
  if (/[.!?]$/.test(subject)) return { ok: false, reason: 'Do not end the subject with a period.' };
  if (name.length > MAX) return { ok: false, reason: `The name has ${name.length} characters. The limit is ${MAX}.` };
  return { ok: true };
}

function main() {
  const args = process.argv.slice(2);
  let text;
  if (args[0] === '--file') {
    // git removes the comment lines of a message after this hook, so skip them here
    try { text = readFileSync(args[1], 'utf8').split('\n').find((line) => line.trim() && !line.startsWith('#')) ?? ''; }
    catch (e) { console.error(`commit-name: cannot read ${args[1]}: ${e instanceof Error ? e.message : String(e)}`); process.exit(2); }
  } else text = args.join(' ');
  const result = check(text);
  if (result.ok) return;
  console.error(`commit-name: "${nameOf(text)}" is not a conventional name.`);
  console.error(`  ${result.reason}`);
  console.error(`  Format:  ${FORMAT}`);
  console.error(`  Types:   ${TYPES.join(', ')}`);
  console.error(`  Example: ${EXAMPLE}`);
  process.exit(1);
}

if (process.argv[1] && process.argv[1].endsWith('commit-name.mjs')) main();
