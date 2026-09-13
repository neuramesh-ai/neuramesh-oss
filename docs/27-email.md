# 27 — Email (invites, lifecycle, broadcasts)

> **Status 2026-07-23 — phases 1, 2 and 4 are BUILT and verified against real delivery.**
> Migrations `0091_email` + `0092_workspace_invites`; `mail.ts` (Resend), `onauth.ts`,
> `lifecycle.ts`; templates in `packages/shared/src/email/`; `pnpm mail:preview`.
> Evidence: a real invite (Resend `c301c133`) and welcome (`5192d37a`) delivered; the seat cap
> refusing a 4th invite with 402; a verified-email claim turning a fresh Clerk identity into a
> member; an unverified one claiming nothing. **Not built:** broadcasts (§6), the Resend
> webhook, and the three marketing emails (§5b) — the marketing ones are blocked on the
> `connectors.provider` CHECK.

NeuraMesh has never sent an email. Not one — no welcome, no invite, no announcement. The consequence
is visible in the product: the "invite a teammate" flow asks an admin to type a password for someone
else and then tells them to *"share their credentials securely."* This document fixes the invite,
then builds the outbound-email spine it needed all along.

Sender: **`hello@notifications.neuramesh.app`** (Resend). Rendered previews of every live template: `pnpm mail:preview`. **How the copy has to read: [docs/28](28-email-voice.md)**
— the voice code, and the gate every draft passes before it sends.

Litmus (doctrine #1): every email here either **unblocks the loop for a second human** (invite,
teammate-joined) or **gets a new user to their first accepted task** (welcome, day 1/3/7). The
broadcast lane exists because shipping features nobody hears about is the same as not shipping them.

---

## 1. The invite is broken twice

The screenshot George hit — `/v1/commands failed 502: auth user creation failed (401)` — is the
shallow half. There are three distinct defects stacked on top of each other.

### 1a. The 401 (why it fails today)

[`pgstore.ts:395`](../packages/control-api/src/pgstore.ts#L395) `createAuthUser` POSTs to the
**Supabase** admin API with `SUPABASE_SERVICE_ROLE_KEY`. Production returns **401** — the key is
absent, stale, or rejected (Supabase's legacy JWT service-role keys are superseded by the
`sb_secret_…` format, and a rotated project key fails exactly like this). The invite then throws
`INVITE_FAILED` → 502.

### 1b. The error message hides the reason

```ts
throw new DomainError('INVITE_FAILED', body.msg ?? body.error_description ?? `auth user creation failed (${res.status})`);
```

Supabase returns `{"message": "Invalid API key", "hint": …}`. The code reads `msg` and
`error_description` — **neither exists** — so it falls through to the generic string. The server
*was told* what was wrong and threw the information away. That's why George is staring at a bare
`(401)`.

### 1c. The flow is architecturally dead (the real bug)

**Auth is Clerk.** Even with a perfectly valid service-role key, this invite cannot work:

1. `inviteMember` creates a **Supabase** auth user + password, mirrors it into `nm_users` with
   `clerk_user_id = <uuid-as-text>`, and inserts `workspace_members` for that uuid.
2. The invitee is emailed nothing. (Nothing sends mail. The UI's own note — *"share their
   credentials securely"* — admits it.)
3. When they eventually sign up, they sign up **through Clerk**. `resolveClerkUser` deliberately
   does *not* merge by email ("that would clobber their sub") → they get a **fresh `nm_users` row
   with a different uuid**.
4. That new uuid has **no membership**. The invite row points at a ghost identity.

And the password is a *Supabase* password, which Clerk will never accept. So the flow fails; if it
didn't fail it would silently produce a member who can't get in.

### 1d. The fix — pending invitations, claimed by verified email

Delete the auth-user creation from the invite path entirely. An invite becomes a **row + an email**,
and identity is resolved when the person actually authenticates.

```
workspace_invites
  id · workspace_id · email (lower) · role · token_hash · invited_by
  status (pending|accepted|revoked) · expires_at · accepted_at · accepted_user_id · created_at
  unique (workspace_id, lower(email)) where status = 'pending'
```

- **`workspace.invite`** loses `password`, gains optional `note`. It writes the row and sends the
  invite email. Free plans may now invite, capped at **3 members per workspace** (§1e).
- **Surfaced on authenticate, joined on ACCEPT** (revised 2026-08-07, migration 0113 — see §1f).
  Sign-in reports every `pending` invite whose email matches — **only if Clerk reports that address
  as verified**, or the invite becomes an account-takeover primitive. It no longer creates the
  membership; `workspace.accept_invite` does.
- **The link is convenience, not authority.** `/join?token=…` prefills the sign-up email and gives
  the invitee something to click. It never grants membership by itself.
- Members tab lists **pending** invites with revoke + resend (1/hour). The password field disappears.

**Why claim-on-auth rather than token-only:** the token path breaks on the single most common real
behaviour — the invitee ignores the email, signs up from the website a week later, and lands in an
empty workspace wondering where the team went. Matching on the verified email makes the invite
idempotent against every arrival order. Doctrine #4: the invariant belongs in the join, not in a
"remember to click the link" instruction.

**`ensureAuthUser` / `createAuthUser` stay** — account *deletion* still needs the Supabase admin API
(`pgstore.ts:290`) — but nothing in the invite path calls them again.

### 1f. Revision — an invitation is ANSWERED (0113, 2026-08-07)

Claim-on-authenticate was right about *identity* and wrong about *consent*. Two failures fell out
of it, both found by asking what happens to someone who is already a member somewhere:

1. **An already-signed-in person never got the invite at all.** The claim only ran on a sign-in
   event, and the desktop's token refresh (`/auth/clerk/token`) does not go through
   `onAuthArrival`. Nothing polled. The invitation sat pending for its 14 days and expired.
2. **One accepted invite could wedge an account forever.** Joining was automatic and there was no
   `workspace.leave`, so a stray invitation permanently bound you to someone else's workspace —
   and `deleteAccount` refuses while any membership stands.

So membership now comes from **`workspace.accept_invite` and nowhere else**:

- `status` gains `'declined'` (0113). It leaves the `status='pending'` predicate the partial unique
  index is built on, so **declining frees the address** and a re-invite is a normal act.
- Accept **re-reads the caller's primary email from Clerk and requires `verified`** rather than
  trusting the copy `nm_users` cached at sign-in. The invite id travels through an inbox and a URL:
  it identifies the invitation, never the invitee.
- The seat cap is re-counted **at accept** (it already was at claim) — an invite can sit for 14 days
  while the room fills.
- `GET /v1/invites/mine` resolves the address **server-side** from the caller's identity; taking an
  email from the request would let anyone enumerate someone else's invitations. The desktop polls it
  on boot and on window focus, which is what finally reaches case (1).
- The inviter's **`joined`** email moves from sign-in to accept — that is when the membership exists.
- `workspace.leave` and `workspace.remove_member` exist, with the owner refused on both. This is what
  makes the two long-standing dead-end messages true: workspace deletion and account deletion each
  told you to "leave first" while naming an action the product did not have.

**The trap this creates, and its guard:** an invited *newcomer* now arrives with zero memberships —
which is exactly the signal onboarding keys on. Without a check the wizard walks someone invited to
a running team into creating their own empty workspace. Boot resolves pending invitations *before*
deciding onboarding, and the join screen renders in the wizard's place
(`InvitedFirstRun`; evidence: `docs/evidence/workspace-switching/07-first-run-invited-*.png`).

Multi-workspace membership was always representable — `workspace_members` is PK
`(workspace_id, user_id)` and the sync rules have always been plural. What was missing was on the
client; see the switcher, the boot pick and the replica-wipe rule in
`mockups/workspace-switching.html` and `apps/desktop/src/main/wsident.ts`.

> **Open question (§8, Q1):** whether to also repair the Supabase service-role key in Vercel. After
> this change nothing in the invite path needs it, but `deleteAuthUser` still does, so a stale key
> means account deletion is failing silently too. Worth checking as its own item.

### 1e. Free plans get 3 seats (decided 2026-07-23)

> **Superseded 2026-09-03 (George): Individual is ONE seat.** The plans are now **Individual** (`free`) and
> **Team** (`cloud`), and an Individual workspace cannot invite at all — the invitation is the upgrade
> door, and on Team every member gets a cloud machine of their own
> ([member-machines](design/member-machines-2026-09/plan.md)). `FREE_SEAT_CAP` is 1; the accept-time
> re-count below still holds. The rest of this section is the 2026-07-23 reasoning, kept as history.

Free was single-human: `workspace.invite` threw `PLAN_LIMIT` outright. That walls off the strongest
viral loop the product has — the moment a solo user wants to show a teammate is the moment they'd
sell it for us. Free now invites, capped at **3 members per workspace**.

Three is deliberate: it lines the free tier up with itself. **3 projects · 3 members · 1 machine.**
One number to remember, one sentence in the pricing page, and the cap bites exactly when a real team
forms rather than when a second person looks.

```ts
// handler.ts, replacing the flat PLAN_LIMIT throw
if ((await store.workspacePlan(cmd.workspace)) === 'free') {
  const used = await store.workspaceSeatsUsed(cmd.workspace); // members + PENDING invites
  if (used >= FREE_SEAT_CAP) throw new DomainError('PLAN_LIMIT', `Free workspaces include ${FREE_SEAT_CAP} members. Upgrade to Cloud to add your whole team.`);
}
```

**`workspaceSeatsUsed` counts members *and* unexpired pending invites — that's the whole trick.**
Counting members alone lets a free workspace issue ten invites while sitting at 1/3 and wake up with
eleven members when they all accept. The cap has to be impossible to exceed, not merely checked at
the wrong moment (doctrine #4). Revoking an invite or an expiry returns the seat.

Two consequences to get right:

- **The claim path re-checks.** An invite can sit pending for 14 days while the workspace fills up.
  `resolveClerkUser`'s claim step re-counts before creating membership; over-cap invites stay pending
  and surface as "this workspace is full" rather than silently granting a 4th seat.
- **Downgrade is not eviction.** A Cloud workspace with 8 members that cancels does **not** lose 5
  people. Existing membership is grandfathered; the cap only gates *new* invites. Deleting a paying
  customer's teammates because a card expired would be the worst possible failure mode.

The `day7` upgrade email changes with this: Cloud's teammate pitch is no longer "invite anyone at
all" but "past your third". It should name the seats they're already using.

---

## 2. Transport — `mail.ts`

One module, same shape as [`billing.ts`](../packages/control-api/src/billing.ts) and
[`analytics.ts`](../packages/control-api/src/analytics.ts): **env-gated, absent key → hard no-op**, so
OSS/local/CI/`echo` mode never send mail.

```
RESEND_API_KEY        absent → mailEnabled() === false, every send is a logged no-op
NM_MAIL_FROM          default: NeuraMesh <hello@notifications.neuramesh.app>
NM_MAIL_REPLY_TO      optional — replies should reach a human
NM_APP_URL            default https://neuramesh.app — every link in every template
NM_MAIL_SECRET        HMAC key for unsubscribe + invite tokens
NM_MAIL_DRY_RUN=1     render + log + persist, never hand to Resend (staging, load tests)
NM_MAIL_ALLOWLIST     comma-separated addresses; anything else is skipped (pre-launch safety)
```

**Raw `fetch`, no SDK.** Resend's send API is a single POST. `build:vercel` externalizes every
dependency by name in an esbuild flag list — adding a package means touching the bundle config, and
the only thing we'd gain is a wrapper around one HTTP call. `clerk.ts` sets the precedent (245 lines
of Backend-API integration, zero deps).

`NM_MAIL_ALLOWLIST` is the seatbelt: it is on until the first real broadcast is signed off, so a
mistake during development lands in our own inbox rather than the user list.

---

## 3. The outbox — one table, exactly-once by construction

Every email — transactional, lifecycle, broadcast — is a row **before** it is a send.

```
emails
  id · workspace_id? · user_id? · to_email · template · kind (transactional|lifecycle|broadcast)
  subject · status (queued|sent|failed|skipped) · provider_id · error · payload jsonb
  dedupe_key  UNIQUE   · scheduled_at · sent_at · created_at
```

The **unique index on `dedupe_key` is the whole safety model.** Not a guard, not a cron that
remembers — a constraint. `welcome:<user_id>` · `nudge_d3:<user_id>` · `invite:<invite_id>` ·
`broadcast:<id>:<user_id>`. A double-fired cron, a redeploy mid-batch, two hosts racing: the second
insert is a duplicate-key error, which is the *correct* outcome, not an incident.

This is the ship-stage lesson repeated — a counter/constraint beats a timestamp comparison — and it
is why the queue is durable rather than a `setTimeout`.

`emails` is **not** in the PowerSync publication. It's operator data; the desktop reads it (if ever)
through an endpoint.

### Preferences & suppression

```sql
alter table nm_users add column unsubscribed_at timestamptz;
alter table nm_users add column email_bounced_at timestamptz;   -- hard bounce or complaint
```

- **Transactional** (invite, teammate-joined) ignores opt-out. It's a direct consequence of an action
  a human took, and suppressing it breaks the product.
- **Lifecycle + broadcast** respect `unsubscribed_at` and `email_bounced_at`, both applied **in the
  selector query** — never in the template, never in a prompt.
- **One lifecycle email per user per 48h**, also in the query.
- Unsubscribe = `GET /u/:uid.:sig` (HMAC, no login required, one click) + `List-Unsubscribe` and
  `List-Unsubscribe-Post: List-Unsubscribe=One-Click` headers. Gmail and Yahoo require one-click
  unsubscribe for bulk senders; we do it from the first email rather than the first complaint.

### `POST /webhooks/resend`

Svix-signature-verified, sitting beside the Stripe webhook above the `/v1` guard.
`email.sent|delivered|bounced|complained` → update the row; **hard bounce or complaint sets
`email_bounced_at`** and, for complaints, `unsubscribed_at`. Reputation on a young sending domain is
the scarce asset; a complained-about address must never receive a second message.

---

## 4. Templates — `packages/shared/src/email/`

Pure functions, `props → { subject, preheader, html, text }`. In `shared` so the control-api renders
them to send and the preview harness renders them to look at — one definition, never a drifting copy.

**No React Email, no MJML.** Email HTML is table-based with inlined styles no matter what generates
it; a `layout()` wrapper plus ~8 block helpers (`h1`, `p`, `button`, `card`, `kv`, `step`, `rule`,
`small`) is roughly 200 lines and matches the repo's low-dependency idiom. The working prototype of
exactly this API is the `<script>` block in `pnpm mail:preview` — it
lifts into `shared` almost verbatim.

**Golden-file test per template.** `subject`, `preheader` and the rendered HTML snapshot to
`test/__golden__/`. A copy change then shows up as a reviewable diff instead of an invisible one.
This is the only mechanism that makes "the reviewer gates on the Definition of Done" mean anything
for prose.

### Design constraints

| Constraint | Decision |
|---|---|
| Width | `max-width: 560px`, single column. **Never a px `width`** on the shell table — a fixed width feeds the parent's min-content width, defeats `max-width`, and renders 560px wide inside a 390px phone. Outlook gets a `<!--[if mso]-->` fixed wrapper. *(Caught in the mockup; see §7.)* |
| Fonts | `'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial`. No webfonts — most clients strip them. |
| Colour | The web app's Quiet Graphite tokens, monochrome, **one accent slot**. |
| Dark mode | `color-scheme: light dark` + `@media (prefers-color-scheme: dark)` with `!important` class overrides. Verified in both, per doctrine #10. |
| Images | **Zero remote images.** The wordmark is a rounded table cell + text. Nothing to block, nothing to break offline, no tracking-pixel look. |
| Buttons | Bulletproof — VML `<v:roundrect>` for the Word engine, `<a>` for everyone else. |
| Preheader | Explicit per template, hidden-div + zero-width padding. It's the second subject line. |

**On the accent slot:** the templates are monochrome with a single `accent` token, so the pending
identity reset (`neuramesh-repositioning-triad`, ember-red/oxblood) changes **two constants** and
re-renders. Nothing else in the email system knows what colour the brand is.

---

## 5. The emails

Copy drafts for all seven are rendered in `pnpm mail:preview` — light
and dark, desktop and mobile, each with its trigger, dedupe key, and suppression rules on screen.

### Transactional

| Template | Trigger | Notes |
|---|---|---|
| **`invite`** | `workspace.invite` | Replaces "share their credentials securely." Token link + verified-email claim. 14-day expiry. |
| **`joined`** | a pending invite is claimed | To the inviter. Closes the loop — **and tells them the new member can see the entire workspace**, which is the truth and which nothing in the product currently says out loud (§7). |
| **`publishFailed`** | a content item lands on `failed` | A scheduled post didn't go out. **This email is the failure's only surface** — see §5b. |

### Onboarding sequence (free plan; "up to 3 after the welcome")

| Template | When | Sent only if | Purpose |
|---|---|---|---|
| **`welcome`** | t+0, immediate | always (unless an invite was just claimed — they get a workspace, not a solo tour) | Install → meet Rex → press Accept. Starts the activation clock. |
| **`day1`** | t+1d | no task has left `todo` | "Pick something small and boring." Three copy-paste first tasks. |
| **`day3`** | t+3d | ≥1 lesson recorded (shipped variant) | Two variants, one dedupe key: **shipped** quotes a real lesson from their own workspace; **stalled** offers a hand. |
| **`marketing`** | on `channel.set_kind → marketing`, else t+5d | first trigger wins | The second trade. One dedupe key, two triggers — eager users get it the moment they open a marketing room, everyone else on day 5. |
| **`day7`** | t+7d | `workspaces.plan = 'free'` | The Cloud pitch: teammates, unlimited projects, every machine, recurring schedules. Last of the sequence. |

`welcome` sends **inline** on `resolveClerkUser created:true` — the one place every sign-up path
(web, in-app, OAuth) converges. The first email should land while the tab is still open; everything
else is queued for the cron.

The day-3 stat row is real numbers, and [`retro.ts`](../packages/control-api/src/retro.ts) already
computes all three: accepted tasks (`:60`), reviews (`:91`), lessons (`:141`). Better still,
`learnedRows` (`:151`) returns **the lesson text itself** — so the email can quote the rule the
reader's own reviewer wrote instead of printing a count. That is the single strongest sentence in the
sequence and it costs one existing query.

**If a count is zero the card is dropped entirely** — never "0 tasks accepted." An honest email
doesn't rub in a lack of progress. Every stat names its window.

### Recurring

**`digest`** — weekly, Monday 09:00, to humans in a marketing channel. Published / waiting / failed
for the week. **Sends only when the ledger is non-empty**: a weekly email that reports nothing
teaches people to ignore it.

### Broadcast

**`release`** — feature announcements. Audience selectors: `all` · `plan:free` · `plan:cloud` ·
`active_30d` · `dormant_14d`.

---

## 5b. The marketing trade needed its own emails — and exposed two gaps

Every draft above told the **build** story: rex, patch, scout, a pull request, an Accept. That is one
half of the product. A channel has a `kind` ([`0079`](../supabase/migrations/0079_channel_kind.sql));
flip it to `marketing` and the room becomes Feed · Calendar · Library, **plume 🦚** seeds in as the
marketer ([`seed.ts:130-152`](../apps/desktop/src/main/seed.ts)), and the work becomes content items
on a calendar instead of tasks on a board.

Writing for it surfaced two things the product does not currently do — which is why two of these
three emails are load-bearing rather than nice-to-have:

- **A failed publish is invisible.** `markContentFailed` writes `status='failed'` and `last_error`
  ([`connectors.ts:439`](../packages/control-api/src/connectors.ts)). `last_error` is in the synced
  client-core schema ([`schema.ts:54`](../packages/client-core/src/schema.ts)) — and
  `grep last_error apps/desktop/src/renderer/src/App.tsx` returns **nothing**. A scheduled post can
  fail on an expired token and no human ever finds out. `publishFailed` is the only surface that
  failure has. *(The app should show it too — flagged separately.)*
- **Content approval gets no push.** `push.ts` fires on task gates — `done`, `design_review`,
  `plan_review`, `ship_review`, `blocked`. Content approval is not a task state, so drafts can sit
  for a week with nothing asking. That's what the weekly `digest` is for.

**What's free here matters for the copy.** `marketing.setup` is human-only and explicitly **free on
every plan** ([`0080`](../supabase/migrations/0080_channel_marketing.sql)); `content.create` /
`approve` carry no plan gate. Only `schedule.create` is Cloud
([`handler.ts:947`](../packages/control-api/src/handler.ts)). So the marketing trade is fully usable
on free — a *recurring cadence* is the paywall, not the work. The `marketing` email says exactly that.

**One deliberate omission: no social network is named.** `connectors.provider` is still
`check (provider in ('x'))` ([`0086`](../supabase/migrations/0086_connectors.sql), never altered)
while `connectors.ts` ships posters for four. Copy must not promise a LinkedIn connection that raises
a check violation. Tracked separately.

Note also that plume is **not** seeded at onboarding — only on a kind-flip — so the `welcome` email
correctly lists six agents and no marketer. An email naming plume on day 0 would describe an agent
the reader does not have.

---

## 6. Broadcast workflow — it's a content item

**We already built this.** [`content_items`](../supabase/migrations/0084_content_items.sql) has
`platform` including `'email'`, a `draft → scheduled → published | failed` lifecycle, a HUMAN_ONLY
approve, an owner-tagged audit trail, and a cron that publishes what's due. Announcements are a
marketing content item that happens to go to an audience instead of a social account.

Building a second parallel campaign system would be exactly the scope creep doctrine #9 forbids.

```
marketer drafts (task in the marketing room)
   → preview renders inline in the thread, like a design mockup
   → TEST SEND to the approver's own inbox        ← mandatory
   → human approves (HUMAN_ONLY, the approve_design guard)
   → scheduled_at → cron fans out in batches
   → one `emails` row per recipient → receipt back to the thread
```

Two hard gates — **both to be built**; today `content.approve` is human-only but there is no email
poster in [`connectors.ts`](../packages/control-api/src/connectors.ts), so "no agent can send mail"
is currently true only because nothing can:

1. **Approve is HUMAN_ONLY.** No agent sends mail to real users, by construction. Same guard as
   `approve_design` and `approve_ship_plan`.
2. **Approve stays disabled until a test send has landed.** You cannot approve an email you have not
   received. This is the email equivalent of artifact-less submit being impossible.
3. **The copy gate runs.** The eight tests in [docs/28](28-email-voice.md), plus an adversarial pass
   over the batch. Security, access and billing sentences need a code-owner, not a copy reviewer.

Fan-out reuses the ship-stage claim pattern: a batch is claimed by an atomic counter CAS, so two
hosts never double-send. The `dedupe_key` unique index is the backstop underneath that.

### The documented human workflow

Announcing a feature, end to end:

1. Ship the feature. The release notes exist (`## Deploy notes`, the tag, the published draft).
2. In the marketing room: *"announce the ship stage to everyone on free"*.
3. The marketer drafts subject + preheader + body from the release notes and the shipped diff.
4. Preview in-thread. Test-send. Read it on a phone.
5. Approve → schedule. Tuesday–Thursday, 09:00 in the recipient's timezone if we have one, else UTC.
6. The thread gets the receipt: sent / bounced / complained, with the audience count.

---

## 7. What the review found

Two rendering bugs, caught before any of this was written into `shared`:

- **The 560px overflow.** Every template rendered 560px wide inside a 390px viewport — clipped
  mid-word on a phone. Cause: a px `width` on the shell table feeds the parent table's min-content
  width, so `max-width:100%` never clamps. Fix: `max-width` only, plus an MSO-conditional fixed
  wrapper for Outlook. Verified: all 7 templates now report `scrollWidth === clientWidth === 390`.
- **A frozen `max-width` transition** on the preview harness, invisible except in exactly the
  situation you use it (checking a mobile render in a non-rendering tab) — the
  `preview-pane-raf-trap` lesson, again.

Then an **adversarial copy review** (Codex at `high` effort, with the repo as ground truth and
instructions to find claims the code doesn't support) found **eleven factual defects** in copy that
had already passed a read-through. The method and the full rule set live in
[docs/28](28-email-voice.md); the two that matter beyond email:

- **[P1] "Channel registration is the access boundary, so a teammate only sees the rooms you put them
  in."** False. Every sync query and RLS policy is workspace-scoped
  ([`sync-config.yaml:11`](../dev/stack/powersync/sync-config.yaml) — *"Channel-granular ACL …
  refines this later"*; [`0001_core.sql:316`](../supabase/migrations/0001_core.sql)). Channel scoping
  is real for **agents**, not humans — I'd read CLAUDE.md's ACL line as applying to both. Shipped,
  that sentence talks someone into putting confidential material in a channel they believe is
  private. It is now inverted into the most useful sentence in the `joined` email.
- **[P1] "Your code and keys never leave your machine."** False in `apikey` mode. The packaged app
  posts provider keys to the hosted control-api
  ([`electron.vite.config.ts:20`](../apps/desktop/electron.vite.config.ts)) and `setCredential`
  stores them in plaintext ([`0006_provider_credentials.sql`](../supabase/migrations/0006_provider_credentials.sql)
  — `token text not null`, no encryption). Subscription auth stores nothing, so the claim holds for
  BYOS only. **This is also live on the privacy policy** ([`App.tsx:1240`](../apps/web/src/App.tsx))
  and three marketing surfaces — tracked separately, needs George.

Nine others were ordinary but expensive: a four-agent roster when the product seeds six, a `/design`
command that doesn't exist, "Accept merges it" when the ship path merges via `execute_ship`, a
pull-request guarantee that repo-less tasks break, "cancel in two clicks, flips back the same day"
when it's Stripe's hosted portal running to period end, and four unbounded memory claims.

None of these would fail a test. All of them would have shipped.

---

## 8. Open questions for George

1. **Supabase service-role key** — after this change the invite path stops using it, but
   `deleteAuthUser` (account deletion) still does. Should I check/repair it in Vercel as a separate
   item, or is Supabase auth fully retired and that path deletable too?
2. **Seat cap semantics.** §1e reads "3 users" as **3 members total** (owner + 2), symmetric with 3
   projects / 1 machine. If you meant 3 *invitees* (4 total), it's a one-constant change —
   `FREE_SEAT_CAP` and the copy in `day7`.
3. **Reply-to.** No inbound path exists, so *"reply and it reaches me"* has been **cut from every
   template** — it was the warmest line in the sequence and it was a lie. Restoring it needs a real
   inbox: set `NM_MAIL_REPLY_TO` to a monitored address, or wire replies to the board. Your call
   which, but the copy stays cut until one exists.
4. **Day-3 variants.** Two variants (shipped / stalled) is my recommendation. One generic email is
   less work and meaningfully worse.
5. **The sequence is now four, not three.** You asked for up to 3 post-signup emails on free; adding
   `marketing` makes it day 1 · day 3 · day 5 · day 7. I kept it because its primary trigger is
   *behavioural* (opening a marketing room), so for most people it isn't a fourth scheduled email at
   all — the day-5 fallback is what tips it over. Say the word and the fallback goes, leaving it
   purely behaviour-triggered and the scheduled sequence back at three.
6. **Sending domain warm-up.** `notifications.neuramesh.app` has no reputation. The first broadcast
   to the full list from a cold domain is the fastest way into spam folders. Recommend: transactional
   + lifecycle only for the first ~2 weeks, then broadcast in ascending batches.

---

## 9. Phasing

Vertical slices, each independently shippable (doctrine #8).

| Phase | Contents | Deploy notes |
|---|---|---|
| **✅ 1 — Invite repair** | `workspace_invites` migration · `workspace.invite` without password · **free 3-seat cap counting members + pending invites** · claim-on-verified-email in `resolveClerkUser` · `/join` route · Members-tab rewrite (pending list, revoke, resend) · `mail.ts` + `emails` table · `invite` + `joined` templates | `RESEND_API_KEY`, `NM_MAIL_FROM`, `NM_MAIL_SECRET`, `NM_APP_URL` in Vercel; DNS (SPF/DKIM/DMARC) verified in Resend **before** deploy |
| **✅ 2 — Onboarding** | `welcome` inline on first auth · `day1/day3/day7` · `lifecycleDue()` selector (pure, unit-tested) · `/internal/emails-due` cron · unsubscribe route + headers | New cron entry in `vercel.json`; `CRON_SECRET` already exists |
| **2b — Marketing** (not built) | `publishFailed` off the publish pass (the only surface that failure has) · `marketing` on kind-flip + day-5 fallback · weekly `digest`, non-empty only | Ships after the connectors `CHECK` widening, or the copy can't name a network |
| **3 — Broadcasts** (not built) | `platform='email'` content items · audience selectors · in-thread preview + mandatory test send · batched fan-out · `/webhooks/resend` | Resend webhook endpoint + signing secret per environment |
| **✅ 4 — Harness** | `pnpm mail:preview` renders all 9 shipped templates to `.nm-evidence/email/` · golden-file tests **including the claim→citation table**, so a claim changing without its citation is a review diff | none |

**Evidence for done** (doctrine #3): a real invite delivered to a real address and claimed by a Clerk
sign-up that never touched the link; **a free workspace at 3/3 refusing a 4th invite, and 4 pending
invites on a 1-member free workspace refusing the 4th at issue time rather than at acceptance**; the
outbox showing one row per send with provider ids; a duplicate-key rejection proving exactly-once;
screenshots of all templates in both themes at both widths; a test send opened on a phone; **and a
clean adversarial copy pass — every claim cited, no P1s** ([docs/28](28-email-voice.md)).

Phase 1 is the one George is blocked on. It can ship alone.
