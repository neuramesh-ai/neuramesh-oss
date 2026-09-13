-- Dev DEMO seed (idempotent): a live-looking workspace for exercising the mobile
-- companion end to end — a machine + roster of agents, tasks across every human
-- gate (design_review / plan_review / done / blocked), and a #dev thread carrying
-- an nmq question card plus a design mockup artifact. Runs on top of dev-seed.sql
-- (workspace acme + #general/#dev). Re-runnable: fixed UUIDs + upserts, and the
-- demo messages/artifacts are cleared and re-inserted each run.
\set ON_ERROR_STOP on

\set ws   '''a0000000-0000-0000-0000-00000000000a'''
\set dev  '''c0000000-0000-0000-0000-00000000000b'''
\set proj '''6846f002-39f1-45ad-affb-6aacbcda194b'''
\set human '''00000000-0000-0000-0000-000000000001'''
\set mach '''11110000-0000-0000-0000-000000000001'''
\set rex  '''aaaa0000-0000-0000-0000-000000000001'''
\set iris '''aaaa0000-0000-0000-0000-000000000002'''
\set atlas '''aaaa0000-0000-0000-0000-000000000003'''
\set nova '''aaaa0000-0000-0000-0000-000000000004'''
\set sentinel '''aaaa0000-0000-0000-0000-000000000005'''
\set prod '''6846f002-39f1-45ad-affb-6aacbcda194b'''
\set growth '''22220000-0000-0000-0000-000000000001'''
\set growthchan '''c0000000-0000-0000-0000-00000000000c'''

-- Two projects so the Home project switcher has something to switch between: rename
-- the workspace default to "Product" (holds #dev/#general) and add "Growth" (#growth).
update projects set name = 'Product' where id = :prod::uuid;
insert into projects (id, workspace_id, name, slug, is_default)
values (:growth::uuid, :ws::uuid, 'Growth', 'growth', false)
on conflict (id) do update set name = excluded.name;
insert into channels (id, workspace_id, slug, topic, project_id)
values (:growthchan::uuid, :ws::uuid, 'growth', 'Marketing & growth', :growth::uuid)
on conflict (id) do update set project_id = excluded.project_id, topic = excluded.topic;

-- a couple of messages in #growth so the switched-to project isn't empty
delete from messages where id in ('88880000-0000-0000-0000-000000000007','88880000-0000-0000-0000-000000000008');
insert into messages (id, workspace_id, channel_id, task_id, author_kind, author_id, body, created_at) values
  ('88880000-0000-0000-0000-000000000007'::uuid, :ws::uuid, :growthchan::uuid, null, 'human', :human::uuid,
   $$How's the landing page refresh coming along?$$, now() - interval '2 hours'),
  ('88880000-0000-0000-0000-000000000008'::uuid, :ws::uuid, :growthchan::uuid, null, 'agent', :rex::uuid,
   $$Draft hero copy is in review with **nova** — I'll ping you when it's ready to accept.$$, now() - interval '105 minutes');

-- one machine, online now (presence = last_seen_at within ~90s)
insert into machines (id, workspace_id, owner_user_id, name, platform, daemon_version, last_seen_at)
values (:mach::uuid, :ws::uuid, :human::uuid, 'george-mbp', 'darwin', '0.15.0', now())
on conflict (id) do update set last_seen_at = now(), daemon_version = excluded.daemon_version;

-- roster: orchestrator, designer, architect, developer, reviewer
insert into agents (id, workspace_id, machine_id, name, role, model, runtime, emoji, status, model_source) values
  (:rex::uuid,      :ws::uuid, :mach::uuid, 'rex',      'orchestrator', 'claude-opus-4-8', 'claude-code', '🦂', 'online',   'pack'),
  (:iris::uuid,     :ws::uuid, :mach::uuid, 'iris',     'designer',     'claude-fable-5',  'claude-code', '🦋', 'thinking', 'pack'),
  (:atlas::uuid,    :ws::uuid, :mach::uuid, 'atlas',    'architect',    'claude-opus-4-8', 'claude-code', '🗺️', 'working',  'pack'),
  (:nova::uuid,     :ws::uuid, :mach::uuid, 'nova',     'developer',    'claude-fable-5',  'claude-code', '⚡', 'working',  'pack'),
  (:sentinel::uuid, :ws::uuid, :mach::uuid, 'sentinel', 'reviewer',     'claude-opus-4-8', 'claude-code', '🛡️', 'online',   'pack')
on conflict (workspace_id, name) do update set
  machine_id = excluded.machine_id, role = excluded.role, model = excluded.model,
  runtime = excluded.runtime, emoji = excluded.emoji, status = excluded.status;

-- tasks across the board (one per interesting state). numbers unique per workspace.
insert into tasks (id, workspace_id, channel_id, project_id, number, title, description, state,
                   creator_kind, creator_id, assignee_kind, assignee_id, definition_of_done,
                   branch, pr_url, pr_number, submitted_sha, requirements_confirmed, artifact_count,
                   blocked_from, created_at, updated_at) values
  ('77770000-0000-0000-0000-000000000001'::uuid, :ws::uuid, :dev::uuid, :proj::uuid, 1,
   'Dark-mode toggle in Settings', 'Add an appearance control so users can pin dark/light or follow the OS.',
   'design_review', 'human', :human::uuid, 'agent', :iris::uuid,
   'Settings shows an Appearance section; manual pin overrides OS; both themes verified.',
   'nm/1-dark-mode-toggle', '', null, null, true, 1, null, now() - interval '3 hours', now() - interval '20 minutes'),

  ('77770000-0000-0000-0000-000000000002'::uuid, :ws::uuid, :dev::uuid, :proj::uuid, 2,
   'Push notifications backend', 'Device-token table + fan-out on human-gate transitions and question cards.',
   'plan_review', 'human', :human::uuid, 'agent', :atlas::uuid,
   'Migration adds nm_device_tokens; POST/DELETE /v1/devices; fan-out deduped; tests green.',
   'nm/2-push-backend', '', null, null, true, 0, null, now() - interval '5 hours', now() - interval '1 hour'),

  ('77770000-0000-0000-0000-000000000003'::uuid, :ws::uuid, :dev::uuid, :proj::uuid, 3,
   'Fix thread scroll jank on long threads', 'FlashList re-renders the whole list on each new message; memoize rows.',
   'done', 'human', :human::uuid, 'agent', :nova::uuid,
   '60fps on a 500-message thread; stable keys; no full-list re-render on append.',
   'nm/3-thread-scroll-jank', 'https://github.com/gad-systems/neuramesh/pull/142', 142,
   '9a3f1c20e4b7d5a6f8c9012345678901abcdef12', true, 2, null, now() - interval '1 day', now() - interval '10 minutes'),

  ('77770000-0000-0000-0000-000000000004'::uuid, :ws::uuid, :dev::uuid, :proj::uuid, 4,
   'Upgrade op-sqlite to 15.x', 'PowerSync native extension needs >=0.4.10; current pin is too old for sync.',
   'blocked', 'human', :human::uuid, 'agent', :nova::uuid,
   'op-sqlite 15.x builds on iOS; PowerSync connects; sync verified on a real thread.',
   'nm/4-op-sqlite-15', '', null, null, true, 0, 'in_progress', now() - interval '2 days', now() - interval '2 hours'),

  ('77770000-0000-0000-0000-000000000005'::uuid, :ws::uuid, :dev::uuid, :proj::uuid, 5,
   'Composer attachments', 'Let a message carry images/files; local bytes first, upload on send.',
   'in_progress', 'human', :human::uuid, 'agent', :nova::uuid,
   'Attach up to 4 images or files; renders in-thread; agent ingests them.',
   'nm/5-composer-attachments', '', null, null, true, 0, null, now() - interval '6 hours', now() - interval '30 minutes'),

  ('77770000-0000-0000-0000-000000000006'::uuid, :ws::uuid, :dev::uuid, :proj::uuid, 6,
   'Thread search', 'Full-text search across a channel''s messages from the composer bar.',
   'todo', 'human', :human::uuid, null, null,
   'Search returns ranked hits; tapping one scrolls to the message.',
   'nm/6-thread-search', '', null, null, false, 0, null, now() - interval '4 hours', now() - interval '4 hours'),

  ('77770000-0000-0000-0000-000000000007'::uuid, :ws::uuid, :dev::uuid, :proj::uuid, 7,
   'Offline command queue', 'Queue board commands (not just messages) while offline; replay on reconnect.',
   'backlog', 'human', :human::uuid, null, null,
   '', 'nm/7-offline-cmd-queue', '', null, null, false, 0, null, now() - interval '1 day', now() - interval '1 day')
on conflict (id) do update set state = excluded.state, updated_at = excluded.updated_at,
  assignee_kind = excluded.assignee_kind, assignee_id = excluded.assignee_id,
  pr_url = excluded.pr_url, pr_number = excluded.pr_number, submitted_sha = excluded.submitted_sha,
  branch = excluded.branch, blocked_from = excluded.blocked_from, artifact_count = excluded.artifact_count;

-- clear + re-seed demo messages/artifacts (fixed IDs so re-runs are clean)
delete from messages where id in (
  '88880000-0000-0000-0000-000000000001','88880000-0000-0000-0000-000000000002','88880000-0000-0000-0000-000000000003',
  '88880000-0000-0000-0000-000000000004','88880000-0000-0000-0000-000000000005','88880000-0000-0000-0000-000000000006');
delete from artifacts where id = '99990000-0000-0000-0000-000000000001';

-- #dev main thread (task_id null): a human prompt, an orchestrator reply, an nmq card
insert into messages (id, workspace_id, channel_id, task_id, author_kind, author_id, body, created_at) values
  ('88880000-0000-0000-0000-000000000001'::uuid, :ws::uuid, :dev::uuid, null, 'human', :human::uuid,
   $$Morning team — where are we on the settings redesign?$$, now() - interval '40 minutes'),
  ('88880000-0000-0000-0000-000000000002'::uuid, :ws::uuid, :dev::uuid, null, 'agent', :rex::uuid,
   $$Morning! Triaging now. Dark-mode is the headline — I'm routing it to **iris** for design first, then atlas plans it.$$, now() - interval '38 minutes'),
  ('88880000-0000-0000-0000-000000000003'::uuid, :ws::uuid, :dev::uuid, null, 'agent', :rex::uuid,
   $$One call I need from you before iris starts:

```nmq
{"question":"How should dark-mode behave by default?","options":[{"label":"Follow the OS","description":"Auto-switch with system appearance"},{"label":"Manual toggle","description":"A switch in Settings that ignores the OS"},{"label":"Both","description":"Follow OS, but a manual pin can override it"}],"allowOther":true}
```$$, now() - interval '35 minutes');

-- task #1 (design_review) thread: iris posts the mockup
insert into messages (id, workspace_id, channel_id, task_id, author_kind, author_id, body, created_at) values
  ('88880000-0000-0000-0000-000000000004'::uuid, :ws::uuid, :dev::uuid, '77770000-0000-0000-0000-000000000001'::uuid,
   'agent', :iris::uuid,
   $$First pass on the Appearance settings — two-section layout (Appearance + Notifications), pinned control at the top. Mockup attached for review.$$,
   now() - interval '22 minutes');

-- design mockup artifact on task #1 (self-contained HTML → WebView in the design screen)
insert into artifacts (id, workspace_id, channel_id, task_id, message_id, kind, name, mime, inline_content, promoted, created_by_kind, created_by, created_at)
values ('99990000-0000-0000-0000-000000000001'::uuid, :ws::uuid, :dev::uuid,
  '77770000-0000-0000-0000-000000000001'::uuid, '88880000-0000-0000-0000-000000000004'::uuid,
  'design', 'Appearance settings — v1', 'text/html',
  $$<!doctype html><meta name=viewport content="width=device-width,initial-scale=1">
<style>
  :root{--bg:#faf6ef;--card:#fffdf9;--ink:#2b2620;--muted:#8a8072;--line:#ece4d6;--accent:#ec5a32}
  *{box-sizing:border-box;font-family:-apple-system,system-ui,sans-serif}
  body{margin:0;background:var(--bg);color:var(--ink);padding:20px}
  h1{font-size:19px;margin:4px 0 16px}
  .sec{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:20px 0 8px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:14px;overflow:hidden}
  .row{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid var(--line)}
  .row:last-child{border-bottom:0}
  .seg{display:flex;background:#f0e9dc;border-radius:9px;padding:3px}
  .seg span{font-size:13px;padding:6px 12px;border-radius:7px;color:var(--muted)}
  .seg span.on{background:var(--accent);color:#fff}
  .sw{width:44px;height:27px;border-radius:14px;background:var(--accent);position:relative}
  .sw::after{content:"";position:absolute;top:3px;right:3px;width:21px;height:21px;border-radius:50%;background:#fff}
  .lbl{font-size:15px}.hint{font-size:12px;color:var(--muted);margin-top:2px}
</style>
<h1>Settings</h1>
<div class=sec>Appearance</div>
<div class=card>
  <div class=row><div><div class=lbl>Theme</div><div class=hint>Follow OS, or pin one</div></div>
    <div class=seg><span>Light</span><span class=on>Dark</span><span>Auto</span></div></div>
  <div class=row><div><div class=lbl>Reduce motion</div><div class=hint>Softer transitions</div></div><div class=sw></div></div>
</div>
<div class=sec>Notifications</div>
<div class=card>
  <div class=row><div class=lbl>Question cards</div><div class=sw></div></div>
  <div class=row><div class=lbl>Ready to accept</div><div class=sw></div></div>
</div>$$,
  false, 'agent', :iris::uuid, now() - interval '22 minutes');

-- task #3 (done) thread: developer + reviewer sign-off
insert into messages (id, workspace_id, channel_id, task_id, author_kind, author_id, body, created_at) values
  ('88880000-0000-0000-0000-000000000005'::uuid, :ws::uuid, :dev::uuid, '77770000-0000-0000-0000-000000000003'::uuid,
   'agent', :nova::uuid,
   $$Fixed. The jank was FlashList re-rendering every row on each append — memoized the row + stable keys. PR #142 up, CI green. Ready to accept.$$,
   now() - interval '15 minutes'),
  ('88880000-0000-0000-0000-000000000006'::uuid, :ws::uuid, :dev::uuid, '77770000-0000-0000-0000-000000000003'::uuid,
   'agent', :sentinel::uuid,
   $$Reviewed — diff is tight, CI green, matches the Definition of Done. Approving; over to you to accept.$$,
   now() - interval '10 minutes');

-- task #2 (plan_review) thread: architect posts the plan, referencing other tasks by
-- number (#1, #3) so task links can be exercised (PR "#142" stays plain — no such task).
delete from messages where id = '88880000-0000-0000-0000-000000000009';
insert into messages (id, workspace_id, channel_id, task_id, author_kind, author_id, body, created_at) values
  ('88880000-0000-0000-0000-000000000009'::uuid, :ws::uuid, :dev::uuid, '77770000-0000-0000-0000-000000000002'::uuid,
   'agent', :atlas::uuid,
   $$Plan is up for review. It reuses the Settings surface from #1 and mirrors the memoization approach nova used in #3. No blockers — ready when you are.$$,
   now() - interval '48 minutes');

select 'demo seeded: 1 machine, 5 agents, 7 tasks, 7 messages, 1 design artifact' as result;

-- W3 mobile artifact-viewer fixtures: a markdown plan (doc) on the plan_review task and a diff
-- on the done task, so the Artifacts section + viewer have real content to render on mobile.
delete from artifacts where id in ('99990000-0000-0000-0000-000000000002','99990000-0000-0000-0000-000000000003');
insert into artifacts (id, workspace_id, channel_id, task_id, kind, name, mime, inline_content, promoted, created_by_kind, created_by, created_at) values
  ('99990000-0000-0000-0000-000000000002'::uuid, :ws::uuid, :dev::uuid, '77770000-0000-0000-0000-000000000002'::uuid,
   'doc', 'implementation-plan-v1.md', 'text/markdown', $md$# Implementation plan — root-cause the daily brief

The brief always recommends **desk mobility** regardless of day. This is an
investigate-first root-cause pass, **not** another surface patch.

## Approach

1. **Reproduce** across 7 synthetic days, capturing each day's input.
2. Trace the pipeline: `day input → pool → selection`.
3. Fix the confirmed cause and add a coverage regression test.

## Definition of Done

- [ ] Root cause identified with evidence (why the prior two fixes didn't hold)
- [ ] Fix lands with a failing-now → green test
- [ ] `brief.generate(day)` varies appropriately across the week

> [!IMPORTANT]
> The distribution model is still undefined — needs the owner's call before build.

## Files

| File | Change |
| --- | --- |
| `brief/select.ts` | fix the day-independent pool query |
| `brief/select.test.ts` | add the 7-day regression |

See also [the architecture doc](https://neuramesh.app).
$md$, false, 'agent', :atlas::uuid, now()),
  ('99990000-0000-0000-0000-000000000003'::uuid, :ws::uuid, :dev::uuid, '77770000-0000-0000-0000-000000000003'::uuid,
   'diff', 'remove-crisis-eval.diff', 'text/x-diff', $diff$diff --git a/.github/workflows/crisis-eval-nightly.yml b/.github/workflows/crisis-eval-nightly.yml
deleted file mode 100644
--- a/.github/workflows/crisis-eval-nightly.yml
+++ /dev/null
@@ -1,7 +0,0 @@
-name: crisis-eval-nightly
-on:
-  schedule:
-    - cron: '0 3 * * *'
-jobs:
-  eval:
-    runs-on: ubuntu-latest
$diff$, false, 'agent', :atlas::uuid, now());
