# 31 — Replies: a thread hangs off a message (spec + build notes)

> **Status:** BUILT (2026-07-26). Hover any room message → **Reply** → a thread rooted at that
> message. The message stays in the feed and grows **“3 replies · last 4m ago”**; the answers live
> in the thread. Prototype: `mockups/home-feed-flow.html` step 8.

## 1. What was there

`startReply` built a real reply context **only when the message belonged to a task** — the
“replying in #1042” chip. On a plain room message it did `setDraft("@name ")` and nothing else:
no thread, no link back. In a busy room your answer and the thing it answered drift apart, and
nothing records that they were ever related.

## 2. The shape

Slack's, because it is the one people already know:

- The root is **referenced, not moved** (`threads.root_message_id`). Setting the root's own
  `thread_id` would pull it out of the feed — the opposite of what the affordance promises.
- The root **stays in the feed** and grows a footer that opens the thread.
- The **replies do not** appear in the feed. They previously would have: the feed filtered on
  `task_id is null`, so a chat thread's messages showed inline AND in the sheet. With a footer
  counting them, that duplication becomes visible nonsense — so the feed now shows channel-root
  messages plus thread **roots**, and hides replies. `thread_mode='off'` (docs/20) still widens
  the feed to everything, unchanged.
- Replying to a message that already has a thread **joins it** rather than forking a second one.
- A message already in a task thread keeps today's behaviour — the composer arms with a pill.
- **Every thread has a root.** A thread born from a message that names none is rooted at *that
  message* — the Home composer's send opens the conversation, so it is the root. This is enforced
  in `postMessage` (both stores), not in the composer, so desktop, mobile and an agent posting via
  the API are all correct by construction. It matters because the feed shows a thread's root and
  hides its replies: a **rootless thread swallows its own opening message**, and the room you just
  posted into shows no trace of it. The `0098` backfill applies the same rule to history.
- A thread's reply **count excludes its root**. A Home-born root carries the thread's `thread_id`
  (it is both opener and member), so a naive count reports one reply too many on every such thread.

## 3. Why no new command

A thread is already born by the first message carrying an unknown `threadId` (`postMessage`, in the
same transaction). Reply reuses that: the renderer mints the id, sends with `rootMessageId`, and the
birth records the root. **No new command, no new endpoint** — and if you arm a reply and never send,
no thread is created, which is correct.

The root rides to the server as a **local-only column** on the client's `messages` table, mapped in
`uploadData`. That keeps the offline-queue property (write locally, upload later) instead of
side-stepping PowerSync with a direct POST. The server keeps the root on `threads`, never on a
message, so sync never sends it back down.

## 4. Honest limits

The footer says **“3 replies · last 4m ago”**, and marks itself fresh when the newest reply landed
after your last read of the room. It does **not** say “2 new”, because the grouped watch returns a
count and a max time, not per-reply times — and per-thread read state does not exist yet.
`summarizeReplies()` in shared already computes an exact unread count and is tested; the moment
per-thread reads land, the footer can use it without new phrasing.

## 5. Change surface

| File | Change |
| --- | --- |
| `supabase/migrations/0098_thread_root_message.sql` | `threads.root_message_id` + **backfill** (each existing thread's earliest message) + index |
| [packages/shared/src/replies.ts](../packages/shared/src/replies.ts) + [test](../packages/shared/test/replies.test.ts) | `replyFooter`, `shortAgo`, `summarizeReplies`, `replyPreview` + 11 tests |
| [control-api](../packages/control-api/src) `app.ts` / `store.ts` / `pgstore.ts` + [test](../packages/control-api/test/replies.test.ts) | `rootMessageId` on a message post, recorded at thread birth, both stores + 4 tests |
| [sync.ts](../apps/desktop/src/main/sync.ts) | feed query hides replies / keeps roots · `nm:watch-reply-counts` · root fields on the thread watch · local-only `root_message_id` + upload mapping |
| [App.tsx](../apps/desktop/src/renderer/src/App.tsx) | `startReply` rewrite, reply routing in `send`, the footer, the composer pill, the pinned root · **`ChannelIntro` no longer blanks the room when `history` hasn't loaded** |
| [tokens.css](../apps/desktop/src/renderer/src/tokens.css) | `.replyfoot`, `.rpill`, `.rootmsg` (both themes) |
| [preview/mock-nm.ts](../apps/desktop/src/renderer/preview/mock-nm.ts) | reply fixtures + the missing `channelHistory`/`channelPeople` bridge methods |

## 6. Deploy notes

- **Migration `0098`** auto-applies on the prod deploy. It **backfills** `root_message_id` for every
  existing thread — without it, each existing thread's opening message would vanish from its feed
  the moment the new filter ships.
- **PowerSync: none.** `threads` syncs as `select *`, so the new column rides the existing rule.
- Backend before desktop, as always.

## 7. Amended 2026-07-29 — the thread is the main surface, and the root anchors a session row

The reply machinery is **unchanged**, all of it: the root is referenced not moved
(`threads.root_message_id`), a thread is still born by the first message carrying an unknown
`threadId` in the same transaction, there is still **no new command and no new endpoint**, the root
still rides as a local-only column mapped in `uploadData`, replying to a threaded message still
**joins** it, and a thread's reply count still excludes its root. What changes is the surface the
thread opens on — [docs/35](35-sessions-shell.md), the sessions shell, approved 2026-07-29.

**A thread opens as the MAIN surface, not a sheet.** §2's shape is Slack's, and so was the sheet;
the sheet is what §2's own reader could not find their conversation in. Opening a thread now replaces
the room's list and a back crumb returns — the reading posture, not an overlay that takes the
conversation with it when you close it.

**"The root stays in the feed" now reads: the root anchors the session row.** With the feed retired
(docs/32 §13) a thread is not previewed *inside* a stream; it **is** a row in the room's session
list, and that row's title and snippet come from the same root this doc made mandatory. The
consequences map one for one:

| §2's clause | what it means now |
| --- | --- |
| the root stays in the feed and grows a footer | the root **titles the row**; the footer's count and freshness become the row's meta |
| the replies do not appear in the feed | there is no plane for them to leak onto — a reply is inside its session, by construction |
| `thread_mode='off'` still widens the feed to everything, unchanged | retired with the feed; docs/20 is absorbed |

**The rootless-thread rule gets more load-bearing, not less.** §2 records the bug it exists to
prevent: *"a rootless thread swallows its own opening message"*, so the room you just posted into
shows no trace of it. Under the sessions shell a rootless thread has **no row at all** — it would not
appear in its room, on Home, in the rail, or in the overlay. The enforcement is in the right place
(`postMessage`, both stores, so desktop, mobile and an agent posting via the API are correct by
construction) and the `0098` backfill still covers history. Do not move it into a composer.

§4's honest limit stands: per-thread read state still does not exist, so a session row says what the
footer said — a count and a freshness mark, not "2 new". `summarizeReplies()` is still tested and
still waiting.

Deploy notes: none of their own. No migration, no PowerSync work, no new column — docs/35 is a shell
change.
