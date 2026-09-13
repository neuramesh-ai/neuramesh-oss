# Seat recommendation from suite v1.1 (2026-09-08)

Measured at commit `ee7195f1`: 13 models, 5 roles, nothing skipped. Numbers below are the quality
score out of 100 for that role. Support seats (sales, curator) and curated seats (designer,
shipper, marketer) are not decided by the bench and are listed after the table.

## Working seats

| Pack | Orchestrator | Architect | Developer + worker | Reviewer |
|---|---|---|---|---|
| Ultracode | GPT-5.6 Sol 98 | GPT-6 Astra 98 | Claude Sonnet 5 100 | GPT-6 Astra 100 |
| Balanced | Claude Sonnet 5 95 | Gemini 3.8 Flash 87 | Claude Sonnet 5 100 | Gemini 3.8 Flash 90 |
| Fast | Gemini 3.8 Flash 96 · 5.4s | Gemini 3.8 Flash 87 · 15s | Claude Sonnet 5 100 · 11.8s | Gemini 3.8 Flash 90 · 2.5s |
| Claude Core | Claude Sonnet 5 95 | **Claude Fable 5.1 78 (directed)** | Claude Sonnet 5 100 | Claude Fable 5.1 98 |
| OpenAI Core | GPT-5.6 Sol 98 | GPT-6 Astra 98 | GPT-5.6 Terra 100 | GPT-6 Astra 100 |
| Gemini Core | Gemini 3.8 Flash 96 | Gemini 3.8 Flash 87 | Gemini 3.1 Pro 100 | Gemini 3.1 Pro 96 |

## Directed seats, not measured

Two seats are founder decisions and are marked as such in the catalog, the way the 2026-07-10
flagship reseat was:

- **Claude Sonnet 5 on the orchestrator seat of Claude Core and Balanced**, plus the server
  register-time default. The measurement supports it (95, statistically level with the leaders, at
  $0.014 and 7.7s) but the decision came first.
- **Claude Fable 5.1 on the Claude Core architect seat** (George, 2026-09-08), against a measured
  Sonnet 5 at 88 versus Fable 5.1 at 78, and against a cost of $0.41 per plan versus $0.05 and 111
  seconds versus 45. Re-run the suite to confirm or revert.

## What the numbers say to be careful about

**Planning splits by family, not by tier.** Every Anthropic model sits at the bottom (Sonnet 5 88,
Fable 5.1 78, Opus 5 60, Haiku 56) while OpenAI and Gemini sit at the top (Astra 98, GPT-5.4 mini
97, Gemini 3.8 Flash 87). Anthropic candidates are judged by Sol and Gemini 3.8 Flash, and the
Anthropic plans are also the longest and slowest, so this may be a judge preference for shorter,
more structured plans rather than a quality gap. It is the one role where a hand-check of a few
plans would be worth more than another run. Until then, no seat rests on a low Anthropic planning
score alone.

**Coding no longer separates the field.** Seven models scored exactly 100%. The seat is decided by
cost and latency, which is a fine tiebreak and a poor measurement. This is the argument for the
private repo-derived fixtures parked in `docs/design/model-benchmarks-v2-2026-09`.

**GPT-5.4 mini won research, planning and orchestration.** The founder rule keeps mini and lite
tiers off working seats, so it holds none, and it keeps its support seats. It is the strongest
argument against that rule that the bench has produced, and it is recorded here rather than acted
on.

**Gemini 3.8 Flash's 48% on coding is about our seam, not the model.** It answers the worker prompt
with a malformed tool call when no tools are offered, and 13 of 25 samples returned nothing. In
production the Gemini worker runs through `agy` with real tools. The row carries the count so the
number reads honestly, and no developer seat rests on it.

**One preview exception can retire.** Gemini 3.8 Flash beats the 3.1 Pro preview on planning (87
versus 84) at less than half the cost and half the latency, so the Gemini architect seat no longer
needs the GA-defaults exception. The Gemini developer seat still does: 3.1 Pro is the only Gemini
model that reached 100% on coding.
