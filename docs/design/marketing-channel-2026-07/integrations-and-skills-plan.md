# Marketing integrations & skills — research + plan (for review)

> **Status: PROPOSAL (2026-07-21)** — George's round-7 ask: stop building every connector from
> scratch; find what exists (MCP servers + agent skills) for X, Instagram, Facebook, Slack,
> Google Ads, PostHog, Vercel; weigh integrate-vs-build; and give marketing rooms a default
> skill pack the way #build rooms get theirs — so the docs stay grounded, never vibes.

## 1. What the research found (July 2026)

The timing is good: in the last ~4 months every platform we care about shipped an **official
MCP server**. The "build each connector ourselves" era is largely over for read/research;
publishing is where custody still matters.

| Platform | Official server | Access model | Write? | Notes |
|---|---|---|---|---|
| **X (Twitter)** | HOSTED `api.x.com/mcp` (Jun 30, 2026) | bearer = read-only; OAuth2 PKCE = writes | ✅ | 200+ endpoints; rides the paid X API tiers (pay-per-use) |
| **Meta (FB + IG ads)** | Ads AI Connectors (open beta): MCP + CLI | one-click OAuth | ✅ full R/W on ad accounts | ads-focused; organic IG posting still via Graph API |
| **Google Ads** | `googleads/google-ads-mcp` (Apr 28, 2026) | self-run stdio; dev token + GCP + OAuth | ❌ read-only | 2 tools (GAQL `search`); the classic dev-token gate remains |
| **PostHog** | `mcp.posthog.com` + `PostHog/mcp` | user API key | ✅ (flags/insights) | analytics, flags, experiments, error tracking — the grounding goldmine |
| **Vercel** | official MCP (+ `@vercel/mcp-adapter`) | user token | ✅ | deploys/projects context; also hosts third-party MCPs |
| **Slack** | official server (with GitHub/Notion/Stripe cohort) | workspace OAuth | ✅ | community listening + digest posting |
| **TikTok** | official Ads MCP shipped | OAuth | ✅ | bonus — same wave as Meta |
| **LinkedIn** | ❌ none | — | — | the one real gap; aggregators only |

**Aggregators** (one integration → thousands of tools):

| Platform | Shape | Pricing signal | Trade |
|---|---|---|---|
| **Composio** | proxy MCP (per-call passthrough) | ~$229/mo per 2M tool calls; SOC2/ISO, SSO | mature catalog, an extra cloud in the data path |
| **Pipedream** | workflow MCP, 2,700+ apps / 10k tools | free ≤10 flows, then ~$5/flow/mo | acquired by Workday (Nov 2025) — enterprise-solid, roadmap risk |
| **Zapier MCP** | hosted, 10k+ pre-built actions | Zapier plans | easiest, least control; fine for long-tail ops |

**Skills ecosystem** (Claude Agent Skills, the format we already ship in packs):
- **Corey Haines' open-source marketing-skills** — ~30 skills across diagnostics / optimization /
  reporting (CRO, copywriting, SEO, analytics, growth). The strongest seed corpus.
- **Anthropic's Brand Guidelines reference skill** — applying brand colors/typography/standards
  downstream; pairs perfectly with our `samples/` shape contract.
- Head of Content, campaign-launcher-oss, and 11+ public collections — a real ecosystem to
  curate from rather than author from zero.

## 2. Integrate vs build — the honest comparison

| Dimension | Build ourselves (status quo: X connector) | Official platform MCPs | Aggregator MCP |
|---|---|---|---|
| **Data path** | our control-api holds sealed tokens (George-approved custody for publish) | user's creds → platform, direct; runs LOCAL from the daemon — strongest BYOS story | user's creds + traffic through a third cloud — weakens "local-first" pitch |
| **Cost to us** | dev time per platform (X took a full slice: OAuth, seal, refresh, poster, cron) | ~zero build; config + fencing only | subscription/per-call on top of platform costs |
| **Maintenance** | ours forever (API churn, e.g. X pricing shifts) | the platform's team | the aggregator's |
| **Coverage** | one platform per slice | everything above except LinkedIn | everything incl. LinkedIn |
| **Custody of "publish"** | OURS — the approve-gate + cron is structural | write tools exist; must be FENCED in agent runs | same, plus a middleman |
| **ToS/reliability** | our responsibility | first-party = safest | aggregator ToS churn risk |

**Conclusion:** research/read = official MCPs, run locally with the user's own creds (this is
BYOS extended to marketing, our best story). Publishing = keep OURS — `content.approve` +
server-side sealed-token cron stays the single write path, and MCP write tools are
**disallowed in agent runs** (the same `disallowedTools` fence the research turn already
uses), so agents-draft-humans-publish holds by construction even with write-capable servers
configured. Aggregators = opt-in escape hatch for the LinkedIn-shaped long tail only, with
the data path disclosed in the connect UI.

## 3. The plan (phased, each phase shippable)

### P1 — Marketing skill pack + local MCP attach (no new connectors built)
1. **`marketing-core` bundled skill pack**, seeded to `kind='marketing'` rooms exactly like the
   build packs (the existing `gen-skill-seed → SKILL_SEED → boot backfill` path; backend-only
   change by design). Contents, curated + licensed from the ecosystem and our own lessons:
   - `brand-research` — the research METHODOLOGY: fetch the site page-by-page, **fetch linked
     CSS/JS bundles to extract real design tokens** (closes the "SPA returns a shell → hexes
     unknown" gap from the live run), pricing-page verification rules, unknown-over-invented.
   - `doc-shapes` — the four sample outlines (mirrors `samples/`, so the contract ships to
     users, not just our repo).
   - `content-calendar`, `competitor-scan`, `post-quality` — distilled from the Corey Haines
     pack (diagnostics/optimization/reporting) where the license allows, attributed.
2. **Per-channel MCP attach for marketer runs**: marketing-kind rooms may register MCP servers
   (PostHog first — analytics-grounded docs and weekly reports; Vercel + Slack next). Runs
   local from the daemon with the user's creds; read tools only via the fence. The plumbing
   seam already exists (`orchmcp.ts`, per-run MCP config in the claude-code runtime).

### P2 — Official platform servers for the paid-focus areas
- **X hosted MCP** for research/timeline/engagement context in drafting runs (bearer,
  read-only). Publishing stays on our sealed connector — no change to the approve gate.

  **SHIPPED 2026-08-09 — but NOT as XMCP.** The plumbing for the hosted server had been here
  since P1 and never attached anywhere except the one-time marketing bootstrap, so a live
  routine ("X engagement research for @joinflowe") fanned four legs with WebSearch/WebFetch
  only, hit x.com's 402 login wall, and filed follower-count proxies labelled "high reach" —
  while the room showed X as ✓ connected.

  The first fix wired XMCP properly and added a machine-local bearer for it. That worked and
  was still wrong: **users do not have X developer apps.** It also put TWO "X" rows in the
  Connections list for one capability, which is exactly how it read. Both were retired the
  same day. What shipped instead:
  - **Reading rides the X CONNECTOR the user already made.** `X_SCOPES` has always requested
    `tweet.read users.read`; X's recent-search accepts OAuth 2.0 user context. `xSearchRecent()`
    in `connectors.ts` is the read half of `xPoster` — same refresh-once-on-401, same
    rotate-and-persist contract.
  - **`GET /v1/x/search`** unseals server-side and returns JSON. The token never leaves the API
    process, the same custody rule publishing keeps; the desktop only ever sees results.
  - **`search_x`** on every agent registry (orchestrator, worker/leg, chat). Not MCP — an `nm`
    tool calling our own API, so codex/agy runtimes get it too, which the MCP path could not do.
  - Metrics are **null** when X omits them, never zero-filled: a zero reads as measured.

  Cost: these reads bill OUR X app (pay-per-use since Feb 2026, ~$0.005/post read), which is the
  price of one-click. Bounded per call (10–25 results, an agent tool call, never a poll); a
  per-workspace budget is the open follow-up.

  X's XMCP is gone from `mkmcp.ts` entirely — that module now serves PostHog/Meta/TikTok only.

- **Meta Ads Connectors + Google Ads read-only MCP** behind the `ads` focus pill: media-buying
  context for strategy docs and (later) campaign report schedules. Google's dev-token gate
  means this is a "bring your existing Ads API access" feature, stated plainly in the UI.

### P3 — Long-tail escape hatch (decision deferred)
- One aggregator (lean Composio for posture, or Zapier for reach) as an OPT-IN workspace
  connector for LinkedIn-etc., clearly labeled with its data path. Not default. Revisit when
  a user actually asks for LinkedIn.

## 4. Open questions for George
1. P1 scope OK to build next (skill pack + PostHog MCP attach), or plan-only until the current
   marketing v1 ships?
2. Comfort level with the aggregator escape hatch existing at all, given the local-first pitch?
3. Should the X hosted MCP eventually REPLACE our sealed X connector for publishing too
   (their OAuth, our approve-gate UI), or keep custody as-is? (Recommend: keep ours — the
   approve-gate cron is the product.)

## Sources
- [X launches an official MCP server](https://startupfortune.com/x-launches-an-official-mcp-server-and-every-social-platform-will-need-to-follow/) · [XMCP guide](https://opentweet.io/blog/xmcp-x-official-mcp-server-guide) · [X MCP directory guide](https://mcp.directory/blog/x-twitter-mcp-server)
- [Meta Ads AI Connectors (MCP + CLI)](https://commonthreadco.com/blogs/coachs-corner/meta-ai-mcp-cli-ads-connectors-ecommerce) · [Meta/Google/TikTok official Ads MCPs](https://www.digitalapplied.com/blog/official-ads-mcp-servers-meta-google-tiktok-2026-playbook)
- [Google Ads official MCP repo](https://github.com/googleads/google-ads-mcp) · [Google Ads MCP docs](https://developers.google.com/google-ads/api/docs/developer-toolkit/mcp-server) · [MCP vs API analysis](https://www.scalekit.com/blog/google-ads-mcp-vs-api)
- [PostHog official MCP](https://github.com/PostHog/mcp) · [mcp.posthog.com](http://mcp.posthog.com/) · [PostHog MCP analytics tutorial](https://posthog.com/tutorials/mcp-analytics)
- [Vercel MCP hosting](https://mcpjam.substack.com/p/vercel-supports-mcp-hosting)
- [Composio vs Pipedream vs Peliqan](https://peliqan.io/blog/composio-pipedream-peliqan-mcp/) · [Composio vs Zapier MCP](https://www.respan.ai/market-map/compare/composio-vs-zapier-mcp) · [Hosted MCP platforms](https://composio.dev/content/hosted-mcp-platforms)
- [Best marketing skills for Claude](https://composio.dev/content/best-marketing-skills) · [Claude marketing skills guide](https://improvado.io/blog/claude-marketing-skills) · [Claude skills for marketing teams](https://lessie.ai/blog/claude-skills-for-marketing)
- [MCP servers for marketing, 25 reviewed](https://www.digitalapplied.com/blog/mcp-servers-for-marketing-25-servers-reviewed-2026) · [MCP server for marketing analytics](https://improvado.io/blog/mcp-server)
