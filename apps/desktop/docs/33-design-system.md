
- **The projects tree, and the one door** (2026-08-07, the nav round — `mockups/nav-threads-and-needs-you.html`) —
  the rail's Recents became **collapsible project groups**: header = chevron · name · live pulse ·
  ONE accent dot when any thread inside holds an ask, plus two hover controls — `#` (the project's
  channel filter popover, where **＋ New channel…** now lives) and `＋` (a chat pre-scoped to that
  project). Rows keep the recents anatomy (dial · `#num` · title · age · `⎇ branch` line) and an
  ask rides the row's OWN dial as an accent pulse (a chat's hollow dot fills) — **attention is
  color, never a numeral** (George, round 2), and every signal reads the one `needsyou.ts` truth.
  Caps: 3 rows per group with ask rows pinned in; collapse/filter/expand are machine-local.
  **Home is retired**: ＋ New chat is the nav's one verb and wears the **primary pill**
  (accent + accent-ink — supersedes the 2026-08-03 quiet-row ruling), opening the chat home with
  the composer focused; the channels head retired with it (destinations follow the active
  project). The home's needs-you queue renders as **rows, not cards** (`.nyrow`: kind chip ·
  one-line summary · #room + age · hover ✕) — a row is a DOOR; answering happens in the thread,
  which keeps exactly one answering surface. And the invariant that closed the round's two live
  bugs: **every door to a conversation calls `goConversation`** — state change + tab 0 fronted +
  composer focused; a nav click may never act invisibly beneath a non-conversation tab. Hooks in
  `App()` end at the boot gate — a hook below a conditional return is the Rules-of-Hooks crash
  the harness caught the day the tree landed.
