# The workspace export

`GET /v1/workspaces/:id/export` gives a workspace owner one archive of the workspace. The request
carries the owner's human bearer. A member who is not the owner gets `403`. An agent gets `403`.
The route is exempt from the hosted write gate ([docs/07](07-billing-and-plans.md)), so a Free
workspace exports at any time. Unit U7 imports this format when a local workspace moves to Cloud.

The types are in `packages/shared/src/export.ts`. The writer is `packages/control-api/src/export.ts`.

## The archive

One `tar.gz` (ustar, gzip). The server streams it: one table is in memory at a time, never the
whole archive. Entries, in this order:

| Entry | Content |
|---|---|
| `manifest.json` | `{ format: "neuramesh-export", version: 1, workspace: { id, name, slug }, exportedAt, counts }` |
| `projects.jsonl` | one project per line |
| `channels.jsonl` | the rooms, with `project_id` |
| `repos.jsonl` | linked repositories, without `local_path` |
| `project_repos.jsonl` | the project to repo links |
| `agents.jsonl` | the crew, without `machine_id` |
| `agent_channels.jsonl` | which agent reads which room (the ACL) |
| `threads.jsonl` | every session, chat or task, without `machine_id` |
| `tasks.jsonl` | the board, with `work_plan`, `ship_plan`, `definition_of_done` |
| `messages.jsonl` | every message, without `embedding` and `fts` |
| `artifacts.jsonl` | artifact metadata with `inline_content` (the small file or the thumbnail) |
| `memory_blocks.jsonl` | the channel summaries and project briefs |
| `facts.jsonl` | facts and lessons, without `embedding` and `fts` |

`counts` in the manifest has one number per table, in the same order. Each number equals the line
count of that table's file. A table with no rows is an empty file.

## A row

A row is the database row: snake_case column names, ids as uuid strings, timestamps as ISO 8601
strings, `jsonb` columns as objects. Every row carries `id`. Every row carries `workspace_id`,
except the two join tables (`project_repos`, `agent_channels`), which reach the workspace through
`project_id` and `agent_id`.

Ids relate the way the schema relates them, and the order of the files is the dependency order:

- `channels.project_id` names a project. `tasks.project_id` and `artifacts.project_id` too.
- `tasks.channel_id`, `threads.channel_id`, `messages.channel_id`, `facts.channel_id`,
  `memory_blocks.channel_id` name a channel.
- `threads.task_id` and `messages.task_id` name a task. `tasks.origin_thread_id` names the
  thread a unit was born in. `tasks.parent_task_id` names a parent task (a subtask).
- `messages.thread_id` names a thread. `threads.root_message_id` and `messages.reply_to` name a
  message.
- `artifacts.message_id` names the message an attachment rides. `artifacts.task_id` names a task.
- `tasks.repo_id` names a repo. `project_repos` links a project to a repo.
- `agent_channels.agent_id` names an agent. `agent_channels.channel_id` names a channel.
- `tasks.creator_id`, `tasks.assignee_id`, `messages.author_id`, `artifacts.created_by` name a
  human or an agent, with the `*_kind` column beside each.

An importer that reads the files in order and inserts as it goes sees every target before the row
that points at it. An importer that changes ids must change every column above together.

## What is never in the export

- Credentials, provider keys, and connector secrets.
- Machine rows, machine tokens, sync tokens, and desktop sign-in sessions.
- Members, invitations, devices, emails, and the credit ledger.
- Files on a cloud machine or a laptop. Only `inline_content` travels. Staged attachment bytes and
  the `cache/` berths stay where they are.
- `embedding` and `fts` (rebuilt by the importer), `machine_id` (agents, threads), and
  `repos.local_path`.

The table list in `EXPORT_TABLES` is the allowlist. A table that is not in the list is not read.

## Import

`POST /v1/workspaces/:id/import/batches` lands an export inside an existing Pro workspace. `:id`
is the TARGET. The request carries the owner's human bearer. A member who is not the owner gets
`403 NOT_PERMITTED`, and so does an agent. The target must be on the `cloud` plan, else
`402 PLAN_LIMIT` with "This workspace needs Pro. Get Pro to move a workspace into it." The route
does not exist on the local stack (`NM_LOCAL`), which answers `404`. The route is never gated by
the hosted write gate, because a `cloud` target is never gated.

The types are in `packages/shared/src/export.ts` (`ImportBatch`, `ImportBatchResult`,
`ImportBatchError`). The client half is `packages/shared/src/import.ts` (`parseExport`,
`planBatches`, `rewriteTaskRefs`). The server half is `packages/control-api/src/import.ts` (the
route, the body schema, the storage gate) and `import-batch.ts` (one batch, one transaction).

### The client's job

The client reads the archive with `parseExport`, then calls `planBatches(export, { targetWorkspaceId,
importId, mint })`. `planBatches` is pure. It:

- mints a NEW id for every row with `mint(oldId)`, and re-points every column in `EXPORT_REFS`
  to the new ids, including the `kind:id` form of `threads.created_by`,
- sets `workspace_id` on every row to the target,
- drops the `EXPORT_STRIPPED` columns if the archive still has them,
- removes the late keys (below) from the rows and plans a link pass for them,
- fills batches under `IMPORT_BATCH_MAX_BYTES` less `IMPORT_ENVELOPE_BYTES` (4 MB less 64 KB),
  in `EXPORT_TABLES` order, then the link passes, and marks the final batch `last`,
- lists rows over the cap on their own, and rows that name one, in `tooLarge`. They stay where
  they are. `totalBytes` counts the rows the batches carry.

A `mint` that is a pure function of `importId` and the old id (a uuid v5, for example) makes a
retry plan the same batches without a stored map.

The driver then sends the batches in order, one request each, and keeps three maps from the
responses: `idMap`, `numberMap`, `slugMap`. Before it sends a batch it re-points the rows with
`idMap` (`repoint` from shared), rewrites `#123` in message bodies with
`rewriteTaskRefs(body, numberMap)`, and echoes the whole `idMap` on the body. The desktop may
rewrite other text with the same function (task titles, descriptions, the definition of done).

### The body

```
{ importId: uuid, seq: number, table: ExportTable, rows: object[],
  first?: { manifest: ExportManifest, totalBytes: number }, links?: true,
  idMap?: { [importedId]: existingId }, last?: true }
```

A body over 4 MB is refused `413 IMPORT_TOO_LARGE`. A body that is not in this shape, a table
outside `EXPORT_TABLES`, or an `idMap` value that is not a uuid is refused `400 IMPORT_FORMAT`.
`machines`, credentials, tokens and every other table are outside `EXPORT_TABLES`, so they can
never be sent. The server does not check `seq`. It echoes it. Order is enforced by data.

### The opening batch

`first` rides `seq: 0` alone, with no rows. The server checks `totalBytes` against the plan's
storage allocation (`planDiskGb`, 50 GB on `cloud`) less the bytes the target's exportable rows
hold today, and refuses `402 PLAN_LIMIT` with "Not enough storage on this plan." before anything
is written. The `200` and the `402` both carry `storage: { allocationBytes, usedBytes, totalBytes }`.
The opening batch writes nothing, so a sheet can send it once to show the numbers and once more to
start the move.

### The row pass

Every row's `workspace_id` must equal `:id`, else `400 IMPORT_WORKSPACE` and nothing is written.
The two join tables carry no `workspace_id`. Their parents are checked in the target instead.

Every `id` is the client's. A row whose id already exists in the table is skipped. That is a
replay. Inserts are `on conflict (id) do nothing`, and the two join tables skip on any unique key,
because their natural key is the pair. The response counts `written` and `skipped`. A replayed
batch writes 0 and answers `200` with the same maps.

The server writes the columns in `IMPORT_COLUMNS` less the late keys and `IMPORT_UNWRITTEN`.
Nothing else lands. `machine_id`, `local_path`, `embedding` and `fts` are not in the list, and
`threads.schedule_id` stays null because a schedule is not in the export.

Order is enforced by data. For every column in `EXPORT_REFS` that names a table, the server
checks the named row is in the TARGET workspace already, or in this batch for a same-table key.
A parent that is missing refuses the batch with `409 IMPORT_ORDER` and `{ rowId, column, missing }`
for the first row that names it. The batch writes nothing. A parent in another workspace counts
as missing.

Three things only the target knows, so the server decides them and answers with the map:

1. **Agents merge by name.** An imported agent whose `name` is already in the target's crew
   (`agents(workspace_id, name)`) is not inserted. `idMap[importedId] = existingId`. The agents
   that are inserted arrive `offline`, with no machine. **Repos merge the same way**, by
   `(provider, org_name, name)`, because the same repository linked twice is one repo.
   A later row that still carries a mapped id, in any `EXPORT_REFS` column, is re-pointed by the
   server from the echoed `idMap` too.
2. **Tasks are renumbered.** `tasks.number` is unique per workspace. The server takes the next
   numbers from the target's counter in the order the rows arrive, and answers
   `numberMap[oldNumber] = newNumber`. A replayed tasks batch answers the numbers the rows hold.
   `tasks.branch` keeps the old number, because that is the branch on the remote.
3. **Slugs.** `projects.slug` is unique per workspace and `channels.slug` per project. A taken
   slug gets `-2`, then `-3`, and the response says so in `slugMap[rowId] = slug`. An imported
   project is never the default: the target has one, and `is_default` is set false on write.

### The link pass

Three keys point at rows that land LATER in `EXPORT_TABLES` order, and the schema's foreign keys
are real: `threads.task_id` (tasks), `threads.root_message_id` (messages), and
`facts.superseded_by` (a newer fact). The row pass leaves them null. After every table has landed,
the client sends one or more batches with `links: true` per table in `LINK_TABLES` (`threads`,
then `facts`). Each row carries `id`, `workspace_id` and the table's late keys only. The server
checks that the rows exist in the target and that the named rows exist in the target
(`409 IMPORT_ORDER` otherwise), then updates the keys. A row already linked so is `skipped`, so a
replayed link pass writes 0.

### The response

```
{ ok: true, seq, written, skipped, idMap?, numberMap?, slugMap?, storage? }
```

Errors carry `{ error, code }` plus `rowId`, `column` and `missing` on `IMPORT_ORDER`, and
`storage` on the opening batch's `PLAN_LIMIT`.

| Status | Code | When |
|---|---|---|
| 400 | `IMPORT_FORMAT` | the body is not in the shape above, or names a table outside `EXPORT_TABLES` |
| 400 | `IMPORT_WORKSPACE` | a row's `workspace_id` is not the target |
| 402 | `PLAN_LIMIT` | the target is not on `cloud`, or the opening batch is over the storage left |
| 403 | `NOT_PERMITTED` | the caller is not the target's owner |
| 404 | `NOT_FOUND` | the id is not a uuid, or the stack is local |
| 409 | `IMPORT_ORDER` | a row names a parent that is not in the target yet |
| 413 | `IMPORT_TOO_LARGE` | the body is over 4 MB |

### The desktop driver

`apps/desktop/src/main/move/` is the client. `driver.ts` is pure around an injected `fetch`, an emit
and a clock. `planMove` reads the local export, plans the batches under `mint.ts` (a uuid v5 of
`importId:oldId` under one fixed namespace, so a retry mints the same ids), rewrites the local
human's id to the cloud user's in every human column (`actors.ts`), and sends the opening batch.
`runMove` streams the rest in order, re-points every ref with the maps so far, rewrites `#12` in
`messages.body` (and in a task's title, description and definition of done once earlier task
batches answered), echoes the `idMap`, and emits one push per batch.

Two files sit beside the local replica (`files.ts`). `move-<sourceWs>.json` holds the progress:
`{ importId, targetWorkspaceId, nextSeq, idMap, numberMap, slugMap }`, written after every batch,
so a cancel or a failure resumes from `nextSeq` with the same `importId`. A progress file for
another target does not resume. `moved.json` is the marker the last batch writes:
`{ importId, movedAt, target, counts, totalBytes, numberMap }`. A local workspace with a marker
refuses a second move, and the This Mac card reads it. Local rows are never deleted.

### What the import leaves as it is

- A human's id (`tasks.creator_id`, `messages.author_id`, `created_by` with kind `human`) travels
  unchanged. Users are not rows in the export. A driver that knows the local user's cloud id
  rewrites these before it sends.
- `agents.card` keeps the card the source published. The target republishes it on the next
  register.
- `artifacts.storage_path` names a path on the machine that staged the bytes. Only
  `inline_content` travels.
