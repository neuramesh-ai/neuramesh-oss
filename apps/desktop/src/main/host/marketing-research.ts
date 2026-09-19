// The marketing research leg and the site's design tokens — what the bootstrap gathers before
// it writes anything. Split out of host/marketing.ts.

import { brandSummary, brandTokens, tallyFonts, tallyPalette } from '@neuramesh/shared';
import type { HostedAgent } from '../agents';
import { claudePathOption, providerEnv } from '../runtime/adapter';
import { drainQuery } from './turnkit';

import { mcpServersFor } from '../mkmcp';
import { type LogFn } from '../agentlog';
import type { PowerSyncDatabase } from '@powersync/node';
import type { makePark } from './park';
import type { HostCtx } from './ctx';

export function makeMarketingResearch(ctx: HostCtx & {
  apiUrl: string;
  arun: (agent: HostedAgent, t?: { id: string; number: number; channel_id?: string } | null, channelSlug?: string | null) => { log: LogFn; runId: string };
  db: PowerSyncDatabase;
  ownerActorId: string;
  post: any;
  runDueParks: ReturnType<typeof makePark>['runDueParks'];
  runDueSchedules: () => Promise<void>;
  wake: (agent: HostedAgent, m: { id: string; channel_id: string; body: string; thread_id?: string | null }) => Promise<void>;
  workspace: string;
}) {
void ctx; // the research turn is pure over its arguments — no host service needed

// The bootstrap's RESEARCH turn (round 6 — "not based on vibes"): unlike the tool-less
// complete(), the doc writer actually reads the product — WebFetch/WebSearch always,
// plus Read/Glob/Grep when the room's project has a local repo on this machine. The
// Agent SDK path serves both auth modes (providerEnv carries a key when one exists).
// claude-code runtime only; other runtimes fall back to their plain complete().

// The bootstrap's RESEARCH turn (round 6 — "not based on vibes"): unlike the tool-less
// complete(), the doc writer actually reads the product — WebFetch/WebSearch always,
// plus Read/Glob/Grep when the room's project has a local repo on this machine. The
// Agent SDK path serves both auth modes (providerEnv carries a key when one exists).
// claude-code runtime only; other runtimes fall back to their plain complete().
async function researchComplete(system: string, user: string, token: string, model: string, repoCwd: string | null, log?: LogFn, mcpServers?: ReturnType<typeof mcpServersFor>): Promise<string> {
  const os = await import('node:os');
  const { query } = await import('@anthropic-ai/claude-agent-sdk');
  // `tools` is the POSITIVE base set — the real fence. (allowedTools only auto-approves;
  // blocklists were whack-a-mole: live runs surfaced Bash, ToolSearch, Monitor,
  // TaskUpdate… each burning the doc's turn budget. That's what "3 of 4 docs" was.)
  // MCP servers ride separately — their mcp__* tools attach on top of this set.
  const tools = ['WebFetch', 'WebSearch', ...(repoCwd ? ['Read', 'Glob', 'Grep'] : [])];
  // the log hook narrates every tool call into agent_activity — the ghost's animated
  // status text ("reading neuramesh.app/pricing…") rides those rows live
  return (await drainQuery(query({
    prompt: user,
    options: {
      ...claudePathOption(), env: providerEnv('anthropic', token), model, maxTurns: 24, tools, allowedTools: tools,
      ...(mcpServers && Object.keys(mcpServers).length ? { mcpServers } : {}),
      permissionMode: 'bypassPermissions', cwd: repoCwd ?? os.tmpdir(), systemPrompt: system,
    },
  }) as AsyncIterable<any>, '', log)).trim();
}

// Round 10: SPAs hide their styling from markdown-converted fetches ("unknown" hexes) —
// so the DAEMON reads the tokens deterministically: fetch the HTML, follow stylesheet
// links (+ inline <style>), tally hex colors / CSS vars / font stacks, and hand the
// researcher a VERIFIED token summary with the CSS URL to cite. Best-effort, 10s caps.
async function siteDesignTokens(site: string): Promise<string | null> {
  try {
    const base = new URL(site.startsWith('http') ? site : `https://${site}`);
    const html = await (await fetch(base, { signal: AbortSignal.timeout(10_000) })).text();
    const linkTags = [...html.matchAll(/<link[^>]*>/gi)].map((m) => m[0]);
    const hrefs = linkTags
      .filter((t) => /rel=["']?stylesheet/i.test(t) || /\.css[^"' >]*["']?/i.test(t))
      .map((t) => /href=["']?([^"' >]+)/i.exec(t)?.[1])
      .filter((h): h is string => !!h);
    let css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]!).join('\n');
    const used: string[] = [];
    for (const h of [...new Set(hrefs)].slice(0, 4)) {
      try {
        const u = new URL(h, base).toString();
        const body = await (await fetch(u, { signal: AbortSignal.timeout(10_000) })).text();
        if (body.length < 600_000) { css += `\n${body}`; used.push(u); }
      } catch { /* skip this sheet */ }
    }
    if (!css.trim()) return null;
    // ONE brand read for the researcher and the public door (shared/brandread.ts): the declared
    // ground, ink and accent first, then what the site paints most, then its fonts. The old tally
    // alone handed the researcher chart series as "the brand" (neuramesh.app, 2026-09-18).
    const read = { tokens: brandTokens(css, html), palette: tallyPalette(css, 14), fonts: tallyFonts(css, 5) };
    const summary = brandSummary(read);
    if (!summary) return null;
    return `VERIFIED design tokens, read from the site's own CSS${used.length ? ` (${used.join(' , ')})` : ' (inline styles)'}:\n${summary.replace(/^/gm, '- ')}`;
  } catch { return null; }
}

  return { researchComplete, siteDesignTokens };
}
