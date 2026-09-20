// The top dock's account menu is the ONE way back out of the top dock (the dock segment lives
// in it and nowhere else in that mode), and it renders INSIDE the nav panel, under the faces
// wrapper v0.76 added. `.navfaces` clips (the two side-dock faces cross-fade under it), so the
// menu that hangs below the row was cut at the panel's edge and a person who docked to the top
// could not dock back (George, live, 2026-09-20). The same two boxes also turned the top dock's
// row-wrap into a column and hid its context strip.
//
// A source-text check, not a DOM one: this suite runs under node with no layout engine. It
// pins the two halves of the constraint — the clip still exists, and the top dock still opts
// its wrappers out of it — so a refactor of either side re-reads the other.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync(join(import.meta.dirname, '../tokens.css'), 'utf8');
const app = readFileSync(join(import.meta.dirname, '../App.tsx'), 'utf8');

test('the top dock renders the account menu inside the nav panel', () => {
  // the premise: were the menu portalled out (the scope menu's route), the rule below would be
  // about layout only and this file should say so
  assert.match(app, /\{acctOpen && navPos === 'top' && \(\s*<AccountMenu/);
  assert.match(app, /\{navPos === 'top' && <div className="navfoot">\{accountBlock\}<\/div>\}/);
});

test('the faces wrapper clips, and the top dock opts out of the boxes that clip', () => {
  assert.match(css, /\.navfaces \{[^}]*overflow: hidden;/);
  assert.match(css, /\.navpanel\[data-pos="top"\] \.navfaces, \.navpanel\[data-pos="top"\] \.navface\.rooms \{ display: contents; \}/);
});

test('the top dock still lets its popovers hang below the row', () => {
  // the panel itself has always been open for exactly this menu; the wrappers were the leak
  assert.match(css, /\.navpanel\[data-pos="top"\] \{[^}]*overflow: visible;/);
  assert.match(css, /\.navpanel\[data-pos="top"\] \.navacct \.acctmenu \{[^}]*top: calc\(100% \+ 9px\);/);
});
