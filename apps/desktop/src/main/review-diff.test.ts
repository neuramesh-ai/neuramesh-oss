// renderer review/diff.ts (track A2) — the review cockpit's diff parser, previously untested.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDiffFiles, baseName, DIFF_BADGE } from '../renderer/src/review/diff';

const DIFF = `diff --git a/src/a.ts b/src/a.ts
index 111..222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,2 +1,3 @@
 keep
-gone
+added
+also added
diff --git a/src/new.ts b/src/new.ts
new file mode 100644
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1 @@
+hello
diff --git a/src/old.ts b/src/old.ts
deleted file mode 100644
--- a/src/old.ts
+++ /dev/null
@@ -1 +0,0 @@
-bye
`;

test('a multi-file diff splits per file, with the change kind each header states', () => {
  const files = parseDiffFiles(DIFF);
  assert.deepEqual(files.map((f) => f.path), ['src/a.ts', 'src/new.ts', 'src/old.ts']);
  assert.deepEqual(files.map((f) => f.change), ['modified', 'added', 'deleted']);
});

test('add/del counts exclude the +++/--- file-meta lines', () => {
  const [mod, added, deleted] = parseDiffFiles(DIFF);
  assert.deepEqual([mod!.adds, mod!.dels], [2, 1], '+++ b/… and --- a/… must not be counted as changes');
  assert.deepEqual([added!.adds, added!.dels], [1, 0]);
  assert.deepEqual([deleted!.adds, deleted!.dels], [0, 1]);
});

test('a deleted file keeps its OLD path — +++ is /dev/null, so the a/ side names it', () => {
  const [, , deleted] = parseDiffFiles(DIFF);
  assert.equal(deleted!.path, 'src/old.ts');
});

test('non-diff text yields nothing rather than a bogus file', () => {
  assert.deepEqual(parseDiffFiles(''), []);
  assert.deepEqual(parseDiffFiles('just a message from the agent'), []);
});

test('baseName and the badge letters', () => {
  assert.equal(baseName('a/b/c.ts'), 'c.ts');
  assert.equal(baseName('top.ts'), 'top.ts');
  assert.deepEqual(['added', 'deleted', 'modified'].map((c) => DIFF_BADGE(c as 'added')), ['A', 'D', 'M']);
});
