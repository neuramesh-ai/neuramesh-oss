# 28 — The NeuraMesh email voice

The written code for every email NeuraMesh sends. It exists because the first draft of our email
system ([docs/27](27-email.md)) was competent and forgettable — copy that reads fine, survives
review, and gets archived unread. Then an adversarial pass against the codebase found that it was
also, in eleven places, **untrue** (§ *How this document was made*).

Both failures have the same root: nobody had to prove anything. This document is the standard that
replaces "reads fine".

**The one idea:** an email is a scene, not an announcement. Something is happening; the reader is in
it. Everything below is machinery for that.

---

## The three laws

Non-negotiable. A draft that breaks one is not ready, however good it sounds.

### Law 1 — Open on a scene, not a category

The first sentence names something the reader could picture. Not what we are, not what category we
compete in: what is happening, to whom, now.

> ❌ "NeuraMesh is where your people and your agents work the same board."
> ✅ "George put your name on a workspace where six agents are already working."

Category openers feel safe because they're unfalsifiable. That is exactly why they're dead — nothing
unfalsifiable is interesting.

**Test:** does sentence one contain a concrete noun with a referent in the reader's own world?

### Law 2 — Every claim cites a line, and bounded beats absolute

Doctrine #3 (evidence over claims) applies to prose. Each factual assertion carries the `file:line`
that makes it true. A claim nobody can cite is cut, or hedged down to what the code actually does.

Two halves, and the second is the one people get wrong:

**Cite it.** *"Nothing merges without you"* → [`states.ts:296`](../packages/shared/src/states.ts#L296),
`accept` is `by: ['human']`, refused for any agent actor. The claim survives.

**Bound it.** Absolutes — *never, every, always, nothing, can't, proves* — require a **server-side
invariant**. Without one, state the real bound. And the bound is usually the better sentence:

| Absolute (unsupported) | Bounded (true, and stronger) |
|---|---|
| "Every review correction becomes a lesson." | "A task you sent back gets its correction distilled into at most two one-line rules." |
| "It's injected into every future prompt on that codebase." | "Up to six of this channel's lessons ride along in every task here." |
| "A mistake you correct once doesn't come back." | *(cut — nothing in the code can promise this)* |

Evidence for the middle column: [`agents.ts:1580`](../apps/desktop/src/main/agents.ts#L1580) (mining
runs only on tasks with changes-requested rounds), [`:1592`](../apps/desktop/src/main/agents.ts#L1592)
(at most 2, model may return none), [`:1533`](../apps/desktop/src/main/agents.ts#L1533)
(`.slice(0, 6)`, same-channel, `''` when offline).

"Up to six" is more persuasive than "every", not less. A number can be checked; a superlative can
only be discounted. **Specificity is the credibility.**

### Law 3 — The reader is the hero; we are the guide

The product is not the protagonist of its own emails. The reader is doing something hard; we have
done it before. Count the sentences whose grammatical subject is "NeuraMesh" or a feature name — they
should be the minority, and never the first or the last.

**Test:** subject-count. If the product is the subject of more than a third of the sentences, rewrite.

---

## The eight tests

Mechanical. Anyone can run them on any draft, including an agent. Any fail blocks the send.

| # | Test | How to run it | Fails if |
|---|---|---|---|
| 1 | **Swap the name** | Replace "NeuraMesh" with a competitor's | The sentence still reads fine — it was never about us |
| 2 | **Analogy mapping** | State it as "A is to B as C is to D" | You can't complete the sentence |
| 3 | **Source-domain check** | Is the analogy true *about the thing it borrows from*? | It isn't (§ *Analogy discipline*) |
| 4 | **Numbers, names, or nothing** | Highlight every adjective | One has no number, name, or `file:line` behind it |
| 5 | **Absolute audit** | Grep: never · every · always · nothing · can't · proves · guarantees | A hit has no server-side invariant |
| 6 | **Real vocabulary only** | Every command, role, state and button name | It isn't in the shipped API or UI (our v1 invented `/design`) |
| 7 | **Banned cadences** | Search the list below | Any hit |
| 8 | **One event, one action** | Count events described and CTAs offered | More than one of either |

### Banned cadences

The fingerprints of machine-written prose. Ours had them — that's why the list is credible.

| Banned | Our own sin |
|---|---|
| "X isn't Y. It's Z." | *"They aren't disposable subagents. They remember."* |
| "That's the difference between A and B." | *"That's the difference between a team and a tool."* |
| Decorative tricolon in body copy | *"One org. One memory. One set of rules."* — legal as the locked positioning line, banned as filler |
| Repeated-anaphora lists as argument | *"same channels, same tasks, same acceptance gates, same memory"* |
| Aphorism standing in for evidence | *"The fastest way to trust a team is to watch them finish something you could have done yourself."* |
| Self-congratulating second sentence | *"Pick something small and boring. That's the point."* |
| Sweeping claims about competitors | *"Tools start from zero every session."* |
| Founder-intimacy cliché | *"I read every one."* |
| Empty intensifiers | powerful · seamless · robust · effortless · comprehensive · genuinely |
| **Em dashes** | Banned outright. At body sizes they read as filler and hide a weak sentence join. Use a full stop, a colon, or a comma. The one exception is text we are QUOTING verbatim (a provider's error, a mined lesson) — never rewrite someone else's words for house style. Enforced by a test. |

---

## Story shapes

Every email uses exactly one. Naming the shape before drafting is what stops an email becoming a
feature list with paragraph breaks.

| Shape | The move | Ours |
|---|---|---|
| **The invitation** | Open *in medias res* — work is underway and a door opens | `invite` |
| **The ensemble** | A cast, named, one job each; the reader is who they answer to | `welcome` |
| **The small test** | A minor task. The stakes are trust, not scale | `day1` |
| **The turn** | Something the reader assumed was permanent turns out not to be | `day3` |
| **The other room** | The reader knows one half of the product. Here is the half they haven't opened — reached by a callback to work they already did | `marketing` |
| **The threshold** | The moment the current shape stops fitting the work | `day7` |
| **The last gate** | A ritual of sign-off before something irreversible | `release` |
| **The beat** | One thing happened. Here it is. Stop. | `joined`, `publishFailed` |
| **The ledger** | What happened, and what is owed. Sends only when the ledger is non-empty | `digest` |

**Shape discipline decides what gets cut.** `joined` is a beat, so it is three sentences. Decorating
it is the error, not the economy — and it was decoration that put a false security claim into our
first draft, because a receipt was padded out into advice nobody asked for.

**Demonstration before moral.** Show the review comment being caught, then let the reader conclude
that persistent lessons matter. Never open with the conclusion.

**Callbacks are how a sequence becomes a story.** Day 3 refers to the correction from day 1; the
marketing email opens on the thing patch shipped on Tuesday; day 7 counts the seats day 1 filled.
Without callbacks a sequence is five unrelated emails that happen to share a sender. The
`marketing` email exists *because* of this rule — the two trades were being described as two
products, and one sentence ("you shipped it; nobody knows") makes them one.

---

## Analogy discipline

One analogy per email, maximum. It earns its place by carrying a **structural correspondence**, and
it must survive being written as an explicit mapping.

**Earned.** *A contractor you re-brief every morning; a colleague who already knows.* That is what a
lesson is — a correction distilled into a channel-scoped rule that rides along in later prompts
([`agents.ts:1533`](../apps/desktop/src/main/agents.ts#L1533)). Remove the analogy and the mechanism
gets harder to explain. That is the test.

**Earned.** *A pre-flight checklist.* A fixed list run before something irreversible starts, with
items only the captain can sign off. That is the ship stage: an owner-tagged checklist where an agent
can never tick a human's item ([docs/23](23-shipping-stage.md)).

**Rejected — and this is the instructive one.** Our first draft had: *"A bosun signs the manifest
before cargo leaves harbour."* It scans beautifully, the mapping is clean, and **a bosun does not sign
manifests.** A bosun is responsible for the deck crew and the equipment. We invented a maritime duty
to make a sentence land.

That failure is why test 3 exists: **an analogy is a claim about two things, and both have to be
true.** A borrowed domain the reader knows better than you do is a claim you will lose.

**Prefer analogies already inside the product.** `scout`, `patch`, `atlas`, `bosun` are names we
chose. Imagery they genuinely carry is free; imagery we bolt on has to be paid for in sentences —
and, as above, sometimes in credibility.

---

## The rhythm rules

Small, but they are the difference between prose and product copy.

- **Vary sentence length deliberately.** Long, then short. The short one lands.
- **One breath per sentence.** Read aloud; if you run out of air, split it.
- **Never explain the joke.** If the analogy works, do not then state its meaning.
- **The last line is the second most-read.** Never waste it on logistics.
- **Subject lines are promises.** The body pays that exact promise, not an adjacent one.
- **The preheader is the second subject line**, never a truncated first sentence.
- **Cut the last paragraph.** Draft it, delete it, reread. It is almost always better gone.

---

## The review gate

Copy is reviewed like code, because it ships like code.

1. **Citations resolve.** Every claim has a `file:line`; the reviewer opens one at random.
2. **The eight tests run.** Any fail blocks.
3. **Shape named.** The draft declares its shape; the reviewer agrees it's the right one.
4. **Security, access and billing sentences get a code-owner.** Privacy claims must match actual data
   movement, channel claims must match the sync rules and RLS, cancellation claims must match the
   Stripe state machine. This is not a copy review — it needs someone who owns that subsystem.
5. **Read aloud once**, start to finish, by someone who didn't write it.
6. **Test send received on a phone** before approve. You cannot approve an email you have not read
   where it will be read ([docs/27 §6](27-email.md)).

Enforced where it can be: `approve` stays disabled until a test send lands, and the citation table is
part of each template's golden file — so a claim changing without its citation changing shows up as a
review diff.

**Metrics carry their query.** No hardcoded numbers in a production template. Every statistic names
its source query, its window, and what the email does at zero (drop the card — never "0 tasks
accepted").

---

## Worked example

`day3`, before and after. Same length. The "before" is not a strawman — it passed a first review.

**Before.** Category headline, product as subject, unbounded claims, banned cadence at the end:

> **They remember what you corrected**
> When your reviewer sends work back, that correction is written to memory as a lesson with the task
> that caused it. It's injected into every future prompt on that codebase. A mistake you correct once
> doesn't come back.
> That's the difference between a team and a tool. Tools start from zero every session.

Four sentences, three false: mining runs *after approval*, not when work is sent back; injection is
capped at six, same-channel, and skipped when memory is unreachable; nothing prevents recurrence.

**After.** A scene, the reader's own data, a bounded claim, and the analogy doing the explaining:

> **scout started correcting patch before you did**
> Last Tuesday you sent #1042 back because the tests mocked the database. You haven't had to say it
> again.
> When that task was finally approved, scout distilled the correction into one line and filed it
> against the task:
> > *"This repo's tests never mock the database — use the pg fixture in test/helpers."*
> Up to six of this channel's rules ride along in every task patch picks up here. A contractor you
> re-brief every morning; a colleague who already knows.

Three reasons it's stronger, and they generalise: it opens on a specific Tuesday and a specific task
number; it quotes **the reader's own data** rather than a count
([`retro.ts:151`](../packages/control-api/src/retro.ts#L151) already returns the lesson text); and its
one claim is bounded, so a reader who counts finds it true.

---

## How this document was made

The rules are not taste. Each was extracted from a specific failure in our own first draft, found by
running an adversarial reviewer (Codex, `model_reasoning_effort=high`) over the copy **with the
codebase as ground truth** and the instruction to find claims the code does not support.

It found eleven factual defects. The two that mattered most:

- **"Channel registration is the access boundary, so a teammate only sees the rooms you put them
  in."** False. Every sync query and RLS policy is workspace-scoped
  ([`sync-config.yaml:11`](../dev/stack/powersync/sync-config.yaml#L11) — *"Channel-granular ACL …
  refines this later"*; [`0001_core.sql:316`](../supabase/migrations/0001_core.sql#L316)). Channel
  scoping is real for **agents**, not for humans. Shipped, that sentence would have talked someone
  into putting confidential material in a channel they believed was private.
- **"Your code and keys never leave your machine."** False in `apikey` mode: the packaged app posts
  provider keys to the hosted control-api
  ([`electron.vite.config.ts:20`](../apps/desktop/electron.vite.config.ts#L20)) and they are stored
  in plaintext ([`0006_provider_credentials.sql`](../supabase/migrations/0006_provider_credentials.sql)).
  Tracked separately — it is also on the live privacy policy.

**Run the same pass on every batch before it sends.** The prompt is four sections: factual defects
with citations and P1/P2 severity, a slop inventory quoting each offending phrase, a narrative
assessment naming the sentence where attention dies, and a rewrite brief. An adversarial model with
repo access is the cheapest copy editor we have, and the only one that can call us liars with a
citation.
