// Every scope bar reads its narrowing from the shared registry, never from local state.
//
// This exists because the failure mode is invisible and has now happened TWICE:
//   · Originally — Tasks and Skills remembered their filter because App() happened to hold the
//     state, while Whiteboards, Automations and Calendar forgot theirs because each declared its
//     own `useState`. Same product, two behaviours, decided by where a line was written.
//   · Then again, by the fix's own author: the state-ownership round moved Memory's room picker
//     into its surface as a plain `useState`, making it the one narrowing in the app that reset
//     on every visit — reintroducing the split one commit after removing it.
//
// Nothing about that is visible in review. Both times it took typing into a filter, navigating
// away and coming back to see it, which is why the rule now lives in a test instead of a habit
// (CLAUDE.md §4: enforced, not prompted).
//
// A source-text check: this suite runs under node with no renderer. It cannot prove the wiring
// WORKS — the preview probe does that — but it does catch a surface declaring its own scope
// state, which is exactly how both regressions happened.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { walkSources } from './srcscan';

const RENDERER = join(import.meta.dirname, '..', 'renderer', 'src');

/** a file that renders a scope control is a file that must not own its own narrowing */
const RENDERS_SCOPE = /<ScopeBar\b|<ScopePill\b/;

/** `const [projectId, setProjectId] = useState(...)` and friends — the shape of the bug.
 *  Bare `q` is deliberately NOT here: it is too common a name, and matching it flagged App's
 *  project-switcher popover, whose search box SHOULD reset when the popover closes. The three
 *  id fields are unambiguous, and both real regressions were id-shaped (`projectId`/`channelId`
 *  in the view files, `memRoomId` in the surface). */
const OWNS_SCOPE_STATE = /const \[\s*\w*(?:[Pp]rojectId|[Cc]hannelId|[Rr]oomId)\s*,\s*set\w+\s*\]\s*=\s*useState/;

/** the control's own definition renders the thing; it is not a surface that uses one */
const IS_THE_CONTROL = /ui\/ScopeBar\.tsx$/;

test('a surface with a scope control never declares its own scope state', () => {
  const offenders: string[] = [];
  for (const file of walkSources(RENDERER)) {
    if (/\.test\.tsx?$/.test(file) || IS_THE_CONTROL.test(file)) continue;
    const src = readFileSync(file, 'utf8');
    if (!RENDERS_SCOPE.test(src)) continue;
    const m = OWNS_SCOPE_STATE.exec(src);
    if (m) offenders.push(`${file.split('/').slice(-2).join('/')} → ${m[0].trim()}`);
  }
  assert.deepEqual(offenders, [],
    'these render a scope control but hold their own narrowing, so it resets on navigation '
    + 'while every other destination remembers — route it through shell/useScopeMemory instead');
});

test('the scope registry is what those surfaces actually import', () => {
  const users = walkSources(RENDERER)
    .filter((f) => !/\.test\.tsx?$/.test(f) && !IS_THE_CONTROL.test(f))
    .filter((f) => RENDERS_SCOPE.test(readFileSync(f, 'utf8')));
  // An assertion over an empty set passes while proving nothing — the trap this round kept
  // finding. Five surfaces render a scope control today; fewer means the scan stopped matching.
  assert.ok(users.length >= 4, `found only ${users.length} scope-bar surfaces — the pattern stopped matching, not the surfaces`);
  for (const f of users) {
    const src = readFileSync(f, 'utf8');
    const wired = /useScopeMemory|ScopeProps|scope\.(q|projectId|channelId)|setScope\(/.test(src);
    assert.ok(wired, `${f.split('/').slice(-2).join('/')} renders a scope control but never touches the registry`);
  }
});
