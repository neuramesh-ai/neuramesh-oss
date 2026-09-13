// Ship-stage diff scanner (shipscan.ts): the pure detection half the shipper flow
// runs before drafting a release plan. Run from apps/desktop:
// pnpm exec tsx --test src/main/shipscan.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanDiff, scanNote } from './shipscan';

const diff = (body: string) => body.replace(/^\n/, '');

test('a new migration is detected as a migration finding', () => {
  const s = scanDiff(diff(`
diff --git a/supabase/migrations/0071_widgets.sql b/supabase/migrations/0071_widgets.sql
new file mode 100644
--- /dev/null
+++ b/supabase/migrations/0071_widgets.sql
@@ -0,0 +1,2 @@
+create table widgets (id uuid primary key);
`));
  assert.equal(s.findings.length, 1);
  assert.equal(s.findings[0]!.kind, 'migration');
  assert.match(s.findings[0]!.detail, /new migration: supabase\/migrations\/0071_widgets\.sql/);
  assert.equal(s.riskHint, 'medium');
});

test('an added env reference is flagged; baked/local vars are ignored', () => {
  const s = scanDiff(diff(`
diff --git a/packages/control-api/src/app.ts b/packages/control-api/src/app.ts
--- a/packages/control-api/src/app.ts
+++ b/packages/control-api/src/app.ts
@@ -1,3 +1,5 @@
+const feed = process.env.NM_UPDATE_FEED ?? '';
+const mode = process.env['NODE_ENV'];
 const keep = process.env.EXISTING_ONLY_IN_CONTEXT;
-const gone = process.env.REMOVED_VAR;
`));
  assert.equal(s.findings.length, 1);
  assert.equal(s.findings[0]!.kind, 'env');
  assert.match(s.findings[0]!.detail, /NM_UPDATE_FEED/);
});

test('powersync config + a second manual edge raises the risk hint to high', () => {
  const s = scanDiff(diff(`
diff --git a/dev/stack/powersync/sync-config.yaml b/dev/stack/powersync/sync-config.yaml
--- a/dev/stack/powersync/sync-config.yaml
+++ b/dev/stack/powersync/sync-config.yaml
@@ -1,2 +1,3 @@
+      - select * from widgets where workspace_id in (select workspace_id from my_workspaces)
diff --git a/packages/control-api/src/app.ts b/packages/control-api/src/app.ts
--- a/packages/control-api/src/app.ts
+++ b/packages/control-api/src/app.ts
@@ -1,1 +1,2 @@
+const key = process.env.STRIPE_WEBHOOK_SECRET;
`));
  assert.deepEqual(s.findings.map((f) => f.kind).sort(), ['env', 'powersync']);
  assert.equal(s.riskHint, 'high');
});

test('desktop version bump and dependency additions are distinct findings', () => {
  const s = scanDiff(diff(`
diff --git a/apps/desktop/package.json b/apps/desktop/package.json
--- a/apps/desktop/package.json
+++ b/apps/desktop/package.json
@@ -1,4 +1,5 @@
+  "version": "0.34.0",
+    "left-pad": "^1.3.0",
diff --git a/.github/workflows/release.yml b/.github/workflows/release.yml
--- a/.github/workflows/release.yml
+++ b/.github/workflows/release.yml
@@ -1,1 +1,2 @@
+      - run: echo publish
`));
  const kinds = s.findings.map((f) => f.kind).sort();
  assert.deepEqual(kinds, ['dependency', 'desktop_version', 'workflow']);
});

test('a clean diff scans clean, riskHint low, and the note says so', () => {
  const s = scanDiff(diff(`
diff --git a/apps/desktop/src/renderer/src/App.tsx b/apps/desktop/src/renderer/src/App.tsx
--- a/apps/desktop/src/renderer/src/App.tsx
+++ b/apps/desktop/src/renderer/src/App.tsx
@@ -10,6 +10,7 @@
+  <div className="newthing" />
`));
  assert.equal(s.findings.length, 0);
  assert.equal(s.riskHint, 'low');
  assert.match(scanNote(s), /clean/);
});

test('duplicate findings collapse (same env var referenced twice)', () => {
  const s = scanDiff(diff(`
diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1,1 +1,3 @@
+const a = process.env.NM_UPDATE_FEED;
+const b = process.env.NM_UPDATE_FEED;
`));
  assert.equal(s.findings.length, 1);
});
