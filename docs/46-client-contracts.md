# 46 · Client contracts: what an installed desktop needs from the server

**Status:** live 2026-09-26, Phase 0 of the plan to decouple the desktop from the cloud clients. **Code:** `contracts/desktop/<version>.json` (one contract per desktop), `packages/control-api/src/client-contracts/` (the reader and the check), `packages/shared/src/desktop-floor.ts` (the supported versions and the floor), `scripts/contract-snapshot.mjs` (the writer).

A person installs a desktop build and keeps it for weeks. The backend ships on every merge. So every merge must keep what an installed desktop sends and reads, or that desktop breaks in silence. This page names what the server keeps, for how long, and how CI holds it to that.

## The rules

1. The supported desktops are the newest published desktop and the one before it. Today they are v0.150.0 and v0.149.0. A desktop that is bumped but not published is a candidate: the server keeps what it uses too, because it becomes the newest supported desktop when it is published.
2. A contract change adds. It never removes or renames something that a supported desktop uses.
3. A removal waits for a floor. The API announces `minDesktopVersion`, and an older desktop shows its update card. The floor is soft: it never blocks.
4. CI replays the command shapes and the client schema of the supported desktops against the new server and sync rules.

## The contract set

| Contract | Source | The snapshot keeps | A break |
|---|---|---|---|
| Commands | `CommandSchema` in `packages/control-api/src/commands.ts`, with the human commands from `packages/shared` | each command type, and each field: its kind, required or not, nullable or not, enum and literal values, length and size bounds, string formats | a command or a field that is gone, a field that became required, a new required field, a value that is gone, a narrower bound, a new format, a changed type |
| HTTP routes | the Hono app that `createApp` builds | the method and the path of each route. Middleware is not a route, and `/internal/` and `/webhooks/` are server to server: no desktop calls them | a route that is gone |
| Client schema | `TABLE_COLUMNS` in `packages/client-core/src/schema.ts`, the one schema that every client opens | each table and its column names | a table or a column that is gone |
| Sync rules | `dev/stack/powersync/sync-config.yaml` | each table the rules serve, with its columns, or `*` for `select *` | a table the rules no longer serve, a column that a listed rule drops (only `messages` lists columns today), a `select *` rule that now lists columns |
| Relay | `packages/relay/src/protocol.ts` | the frame types (`FrameType` and the edge messages) and the lanes (`ChannelLane`) | a frame type or a lane that is gone |
| Agent contracts | `defaults/agents/*.yaml` | the file names | a file that is gone |

Additions always pass: a new command, an optional field, a new value, a wider bound, a new route, table, column, lane or file.

One constant names the file of the client schema: `CLIENT_SCHEMA_FILE` in `packages/control-api/src/client-contracts/snapshot.ts`. The reader takes either form, `TABLE_COLUMNS` or a PowerSync `AppSchema`, so a move of the schema changes that one line. The schema moved from `apps/desktop/src/main/sync` into `packages/client-core` in #629. At v0.149.0 and v0.150.0, the `TABLE_COLUMNS` of client-core was a copy that a test held equal to the desktop's schema, so the seeds read the same through either file.

### What the check cannot see

- A refinement (`.refine()`) or a preprocess step is a function, so the snapshot cannot see it narrow a field. Review a new one by eye.
- A migration that drops a column. A `select *` rule serves what the table holds, so the snapshot sees the rule and not the column. The client schema check still catches a column that leaves the client schema.
- The bodies of `/v1/messages`, `/v1/artifacts` and `/v1/whiteboards`. Their schemas are private to `app.ts`. The routes are in the set, and the bodies are not.

## How it works

- **The corpus.** `contracts/desktop/<version>.json` holds the contract of each desktop. The version-bump PR writes it with `scripts/contract-snapshot.mjs`.
- **The supported list.** `SUPPORTED_DESKTOP_VERSIONS` in `packages/shared/src/desktop-floor.ts` names the two newest published desktops, newest first. Only the release page knows what is published, so a person keeps the list. `MIN_DESKTOP_VERSION` is the older of the two. `packages/shared/test/desktop-floor.test.ts` checks that the list names two versions, newest first, and that each one has a snapshot.
- **The check.** `packages/control-api/test/desktop-contracts.test.ts` reads the current tree the same way. It holds the tree to each supported desktop, and to each snapshot newer than the newest supported one: the candidate of a bump. A failure names the desktop version, the contract item and the rule, for example `v0.150.0 · command task.offer: the field checklist is gone (rule 2)`. The check also fails when a supported version, or the version in `apps/desktop/package.json`, has no snapshot. Its planted cases prove first that it can fail. An older snapshot stays in the folder, and the check does not hold the tree to it.
- **The line on the card.** `/.well-known/nm-config` and `/v1/me` return `minDesktopVersion`. The desktop reads it from its Cloud connection (`apps/desktop/src/main/floor.ts`). Below the floor, the updater looks for the new version at once, and the update card adds one line: "This version is too old for the cloud. Update the app to continue." Nothing blocks. The desktop does not read the floor of the local stack, which runs the app's own version, or of a server that someone runs themselves.

## Run it

```bash
pnpm --filter @neuramesh/control-api test -- desktop-contracts   # the check, and a snapshot for each version it needs
pnpm --filter @neuramesh/shared test -- desktop-floor            # the supported list and the floor
node scripts/contract-snapshot.mjs                               # write the contract of this checkout
node scripts/contract-snapshot.mjs --ref v0.150.0 --force        # write it again from a tag's own code
node scripts/contract-snapshot.mjs --root ../v0.150.0 --force     # the same, from a checkout of the tag
```

`--ref` extracts the files it reads with `git archive` into a temporary folder and links the installed dependencies of this checkout in. It refuses when the resolved dependency versions in `pnpm-lock.yaml` changed since the tag. Then check the tag out in a folder of its own, install it, and pass that folder with `--root`. The script never writes over a file without `--force`, because the contract of a published desktop does not change.

## When each part moves

Two PRs of the release lane ([docs/11 §2](11-releases.md#2--desktop-release)) touch this page:

1. **The version-bump PR adds the snapshot.** Run `node scripts/contract-snapshot.mjs` after the last rebase onto `main`, so that the file matches the commit the tag names, and commit `contracts/desktop/<new version>.json`. If `main` moves after that, run it again with `--force`. Leave `SUPPORTED_DESKTOP_VERSIONS` as it is. From this PR on, the new snapshot is a candidate, and the check holds every tree to it and to both supported desktops.
2. **The ledger-header PR after the publish moves the supported list.** It names the new version as the newest published desktop in the ledger header. In the same PR, set `SUPPORTED_DESKTOP_VERSIONS` to the new version and the one before it. `MIN_DESKTOP_VERSION` follows, so the floor moves up when this PR deploys. The floor then names a published desktop, and a desktop below it can update to a build that exists.

A forgotten move is safe. The check still holds the tree to the candidate, and the floor stays one version lower. Two bumps with no publish between them give two candidates, and the check holds the tree to both.

## Remove something

A snapshot records what the server offers at a version, because that is what the tree can show. So an item stays in each new snapshot until you retire it.

1. Stop the use in the desktop. In the same PR, add the item to `RETIRED` in `packages/control-api/src/client-contracts/retired.ts`, in the words that a break uses: `command task.offer`, `command task.offer field checklist`, `route GET /v1/example`, `client schema table whiteboards`, `client schema column tasks.work_plan`, `sync rule for whiteboards`, `sync rule column messages.pinned`, `relay lane terminal`, `relay frame hello`, `agent contract worker.yaml`.
2. The next version bump leaves the item out of its snapshot. So does each bump after it.
3. When the second desktop without the item is published, its ledger-header PR moves the supported list. Then no snapshot that the check holds has the item. The server may drop it, and the line leaves `RETIRED`.

A narrower field is a removal too. Add a new field instead, or retire the field and narrow it after two published desktops. The review checks each `RETIRED` line: a desktop that still uses a retired item breaks in silence two releases later.
