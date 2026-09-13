// THE MARKETING BOOTSTRAP (docs/39) — the guided first run of a marketing room: the research
// leg, the site's design tokens, and the profile the completing command merges.
//
// Completion is that command stamping setup_at — 'ran to the end' is a fact on the row, never
// the presence of a profile. Extracted from agents.ts (track B2).
import { emitStream, resolveToken, runtimeFor } from '../agents';
import { styled } from '../housestyle';
import type { HostedAgent } from '../agents';

import { withTimeout } from './turnkit';

import { isStandDown } from '../replypolicy';

import { mcpServersFor, readMcpKeys } from '../mkmcp';
import { type LogFn } from '../agentlog';
import type { PowerSyncDatabase } from '@powersync/node';


import type { makePark } from './park';


import type { HostCtx } from './ctx';
import { makeMarketingResearch } from './marketing-research';
import { playbookRecsBlock } from '@neuramesh/shared';

export function makeMarketing(ctx: HostCtx & {
  apiUrl: string;
  arun: (agent: HostedAgent, t?: { id: string; number: number; channel_id?: string } | null, channelSlug?: string | null) => { log: LogFn; runId: string };
  db: PowerSyncDatabase;
  ownerActorId: string;
  post: any;
  runDueParks: ReturnType<typeof makePark>['runDueParks'];
  runDueSchedules: () => Promise<void>;
  setStatus: (agent: HostedAgent, status: 'online' | 'thinking' | 'working') => void;
  wake: (agent: HostedAgent, m: { id: string; channel_id: string; body: string; thread_id?: string | null }) => Promise<void>;
  workspace: string;
}) {
const { apiUrl, arun, db, ownerActorId, post, runDueParks, runDueSchedules, setStatus } = ctx;

  // Split-out neighbours: same ctx, so every call below keeps the name it always used.
  const { researchComplete, siteDesignTokens } = makeMarketingResearch(ctx);

// ── the marketing bootstrap (round 4): a CONVERSATION, not a task ────────────────────
// The setup card's answers sit on channels.marketing; the analysis runs here as the
// agent's chat thread — the kickoff reply lands in the thread the human's setup message
// birthed, each doc posts into the thread AND drops into the room library via
// artifact.create, and the wrap-up hands the human the next move. No board task, no
// review ceremony: onboarding analysis reads like a colleague talking (George, round 4).
async function runMarketingBootstrap(runner: HostedAgent, s: { id: string; workspace_id: string; channel_id: string }, anchor: { threadId?: string; taskId?: string }, opts?: { only?: string[] }): Promise<void> {
  const actor = { kind: 'agent', id: runner.id, role: runner.role };
  // round 3: the whole flow anchors to the setup TASK's thread when one exists — wizard,
  // docs, close and playbook subtasks in one session (the threadId shape is the pre-flows
  // fallback). One spread, so no message can land on the wrong anchor.
  const at = anchor.taskId ? { taskId: anchor.taskId } : { threadId: anchor.threadId };
  const say = (body: string) => post('/v1/messages', actor, { workspace: s.workspace_id, channel: s.channel_id, ...at, body });
  // The task-anchored run streams its liveness (round 3 rerun — "why doesn't plume show the
  // animated status?"): anchoring to the setup task orphaned the round-6 ghost — ConvoThread's
  // status ghost doesn't mount in a task thread, and the typists row is assignee-scoped, which
  // a setup task never has. The thread STREAM is the attributed live channel every task view
  // already renders (wakeThread's own idiom), so status lines ride it like a forming reply.
  const streamKey = anchor.taskId ? `${s.channel_id}:${anchor.taskId}` : null;
  const stream = (text: string, streamDone = false) => { if (streamKey) emitStream(streamKey, runner.name, text, streamDone); };
  const [ch] = await db.getAll<{ slug: string; marketing: string | null }>(`select slug, marketing from channels where id = ? limit 1`, [s.channel_id]).catch(() => [] as Array<{ slug: string; marketing: string | null }>);
  const profile = ((): { website?: string | null; focus?: string[]; goal?: string | null; mcp?: { posthog?: boolean; x?: boolean; meta?: boolean } } => {
    try { return JSON.parse(ch?.marketing ?? '{}') as { website?: string | null; focus?: string[]; goal?: string | null; mcp?: { posthog?: boolean; x?: boolean; meta?: boolean } }; } catch { return {}; }
  })();
  // the room's enabled integrations attach as official MCP servers with MACHINE-LOCAL
  // creds (mkmcp.ts — never synced, never on our server). Empty map = plain web research.
  const mcpServers = ((): ReturnType<typeof mcpServersFor> => {
    try {
      const { app } = require('electron') as typeof import('electron');
      return mcpServersFor(profile.mcp, readMcpKeys(app.getPath('userData')));
    } catch { return {}; }
  })();
  const site = profile.website || null;
  const focus = profile.focus?.length ? profile.focus : ['social', 'content'];
  const subject = site ?? 'the product';
  const { log } = arun(runner, null, ch?.slug ?? 'marketing');
  setStatus(runner, 'thinking');
  try {
    const cred = await resolveToken(apiUrl, s.workspace_id, runner, ownerActorId);
    if (cred.blocked || cred.authMode === 'none') { console.warn(`mk_bootstrap id=${s.id} skipped: no usable creds`); return; }
    log({ kind: 'wake', phase: 'channel', summary: `marketing bootstrap — studying ${subject}` });
    // the room's project may carry a locally checked-out repo — real ground truth the
    // site doesn't show (README, docs, package metadata). Best effort; site-only otherwise.
    const { existsSync } = await import('node:fs');
    const [repoRow] = await db.getAll<{ local_path: string | null }>(
      `select r.local_path from repos r
         join project_repos pr on pr.repo_id = r.id
         join channels c on c.project_id = pr.project_id
        where c.id = ? and r.local_path is not null limit 1`,
      [s.channel_id],
    ).catch(() => [] as Array<{ local_path: string | null }>);
    const repoCwd = repoRow?.local_path && existsSync(repoRow.local_path) ? repoRow.local_path : null;
    if (opts?.only?.length) {
      await say(`Picking it back up — ${opts.only.length === 1 ? `writing ${opts.only[0]} now` : `${opts.only.length} docs to go`}.`);
    } else {
      await say(
        `On it. I'll research ${site ? site : 'the product'} properly — the site page by page` +
        `${repoCwd ? ', the project codebase' : ''}, and the market around it — and build the brand foundation right here: ` +
        `business profile, brand guidelines, market research, then the social strategy. ` +
        `Each doc lands in the room library as it's done; give me a few minutes per doc.`,
      );
    }
    // Section outlines mirror George's Helena sample docs verbatim
    // (docs/design/marketing-channel-2026-07/samples/) — tight, scannable,
    // table-where-tabular, honest about stage. The outline is the contract;
    // the grounding rule (real site, "unknown" over guessed) fills it.
    const docs = [
      {
        file: 'business-profile.md', label: 'Business profile',
        outline:
          `# <Product>. Business Profile\n` +
          `## What It Is — 2-3 sentences: what it is, who it's for, the mechanism that makes it different\n` +
          `## Core Value Prop — one quotable line in quotes, then 1-2 lines of support\n` +
          `## How It Works — the core loop/workflow as an arrow chain (A → B → C), one line on the human's role\n` +
          `## Key Differentiators — 4-6 tight bullets\n` +
          `## Pricing — a | Tier | Price | Key Limits | table from the LIVE pricing page ("unknown" cells only where the site is silent)\n` +
          `## Target Audience — 3-4 bullets\n` +
          `## Tone — one line describing the product's own voice\n` +
          `## Stage — one honest line on maturity (signals from the site, e.g. beta, waitlist, shipped apps)`,
      },
      {
        file: 'brand-guidelines.md', label: 'Brand guidelines',
        outline:
          `# <Product>. Brand Guidelines\n` +
          `## Color Palette — a | Role | Hex | table (Background/Text/Primary/Secondary/Accent/Link) of the site's REAL colors — read them from the site's styles/branding; "unknown" only where you truly can't see one — then a **Mood:** line\n` +
          `## Typography — font family, key sizes, stack as the site actually declares them\n` +
          `## Spacing & Shape — base grid, border radii, other structural quirks\n` +
          `## Buttons — primary + secondary CTA styling and their actual label text\n` +
          `## Brand Voice — 4-6 bullets: sentence style, vocabulary, recurring motifs\n` +
          `## Visual Style — 3-5 bullets on imagery, whitespace, storytelling formats\n` +
          `## What to Avoid — 3-5 bullets (palettes, language, imagery that would be off-brand)`,
      },
      {
        file: 'market-research.md', label: 'Market research',
        outline:
          `# <Product>. Market Research\n` +
          `## Competitive Landscape (<year>) — one framing line, then a | Competitor | Category | Key Weakness vs <Product> | table of REAL named competitors\n` +
          `## <Product>'s Strategic Wedge — one short paragraph: the defensible difference and why it's a product truth\n` +
          `## Market Signals — 4-5 bullets of observable sentiment/trends (name the communities)\n` +
          `## Target Audience Segments — numbered list, **bold segment name:** one line each\n` +
          `## Opportunity Gaps — 3-5 bullets: openings nobody owns yet`,
      },
      {
        file: 'social-strategy.md', label: 'Social strategy',
        outline:
          `# <Product>. Social Media Strategy\n` +
          `## Platform Priority — the primary channel and why; secondaries in one line (focus areas: ${focus.join(', ')})\n` +
          `## Core Narrative Pillars — numbered, **bold pillar name**. one relatable line each (4-5 pillars)\n` +
          `## Content Formats That Work — bullets, **bold format:** one line each\n` +
          `## Posting Cadence (Starter) — 2-3 bullets with days/frequency\n` +
          `## Tone Rules — 3-4 bullets matching the brand voice\n` +
          `## Key Hashtags / Communities — one line\n` +
          `## Quick-Win Content Ideas — 5 numbered CONCRETE post drafts written in the brand voice`,
      },
    ];
    const done: string[] = [];
    const written: Record<string, string> = {};
    // The closing hands the human an ARMABLE plan (round 9): 2-4 schedule recommendations
    // distilled from the strategy doc, as an ```nmsched block the renderer turns into
    // rows with + Arm buttons (arming stays the human's click — and Free's 402 routes to
    // the upgrade card, THE funnel moment). A model extraction that fails shape-checking
    // falls back to sensible defaults, so the block always ships.
    const scheduleRecsBlock = async (): Promise<string> => {
      const fallback = [
        { title: 'Daily post drafts', cadence: 'weekdays', atTime: '09:00', prompt: 'Draft one X post from the narrative pillars in social-strategy.md, in the brand voice.' },
        { title: 'Weekly thread', cadence: 'weekly', weekday: 2, atTime: '10:00', prompt: 'Draft a thread on the strongest narrative pillar this week, grounded in the brand docs.' },
        { title: 'Weekly competitor scan', cadence: 'weekly', weekday: 1, atTime: '08:00', prompt: 'Re-run the competitor scan per the competitor-scan skill; summarize deltas vs market-research.md as a room note.' },
      ];
      let recs = fallback;
      const strategy = written['social-strategy.md']
        ?? (await db.getAll<{ inline_content: string | null }>(`select inline_content from artifacts where channel_id = ? and name = 'social-strategy.md' order by created_at desc limit 1`, [s.channel_id]).catch(() => [] as Array<{ inline_content: string | null }>))[0]?.inline_content
        ?? undefined;
      if (strategy) {
        try {
          const raw = (await runtimeFor(runner.runtime).complete(
            `You extract schedule recommendations from a social strategy document. Output ONLY a JSON array (no prose, no fences): [{"title": string (<=60 chars), "cadence": "daily"|"weekdays"|"weekly", "weekday": 0-6 (weekly only, 0=Sun), "atTime": "HH:MM", "prompt": string (<=300 chars, the drafting instruction, grounded in the docs)}] — 2 to 4 items matching the document's own cadence section.`,
            strategy.slice(0, 6000), cred.token ?? '', runner.model,
          )).trim();
          const parsed = JSON.parse(raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')) as unknown;
          if (Array.isArray(parsed)) {
            const clean = parsed
              .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
              .map((r) => ({
                title: String(r['title'] ?? '').slice(0, 60),
                cadence: ['daily', 'weekdays', 'weekly'].includes(String(r['cadence'])) ? String(r['cadence']) : 'weekdays',
                weekday: typeof r['weekday'] === 'number' && r['weekday'] >= 0 && r['weekday'] <= 6 ? r['weekday'] : undefined,
                atTime: /^\d{2}:\d{2}$/.test(String(r['atTime'])) ? String(r['atTime']) : '09:00',
                prompt: String(r['prompt'] ?? '').slice(0, 300),
              }))
              .filter((r) => r.title && r.prompt)
              .slice(0, 4);
            if (clean.length >= 2) recs = clean;
          }
        } catch (err) { console.warn(`mk_bootstrap id=${s.id} rec extraction fell back:`, err instanceof Error ? err.message : err); }
      }
      return '```nmsched\n' + JSON.stringify({ channel: s.channel_id, recs }) + '\n```';
    };
    // a nudge re-run writes ONLY the missing docs into the same thread
    const targets = opts?.only?.length ? docs.filter((d) => opts.only!.includes(d.file)) : docs;
    // the daemon-read design tokens ride into brand-guidelines as verified source
    // material (round 10 — the SPA-shell "unknown hex" gap, closed deterministically)
    const designTokens = site && targets.some((d) => d.file === 'brand-guidelines.md')
      ? await siteDesignTokens(site).catch(() => null)
      : null;
    if (designTokens) log({ kind: 'tool', phase: 'result', summary: `design tokens read from the site's CSS` });
    // 'thinking', not 'working': this IS a chat response — the ConvoThread/feed ghost
    // (the animated status text) keys on thinking; 'working' means a claimed task
    // elsewhere and renders nothing here (George noticed the silence, round 6).
    stream(`*studying ${subject} — the brand foundation is next…*`);
    for (const [ti, d] of targets.entries()) {
      log({ kind: 'tool', phase: 'call', summary: `drafting ${d.file}` });
      stream(`*researching + writing \`${d.file}\` (${ti + 1}/${targets.length})…*`);
      const canResearch = runner.runtime === 'claude-code';
      const system = styled(
        `You are ${runner.name}, the ${runner.role} for #${ch?.slug ?? 'marketing'} in a NeuraMesh workspace.` +
        `${runner.brief ? ` Your specialty: ${runner.brief}.` : ''} ` +
        `You are writing ONE brand-foundation document as clean markdown, grounded in research you do NOW. ` +
        (canResearch
          ? `Fetch and read the product website${site ? ` (start at ${site})` : ''} and its key pages (pricing, docs, about), and use web search for market/competitive context.` +
            `${repoCwd ? ' The product\'s codebase is checked out in your working directory — read README/docs/package metadata for ground truth the site doesn\'t show.' : ''} `
          : `Use what you can establish about the product from the context given. `) +
        `Never fabricate facts, numbers, quotes, or hex colors — state only what your research actually surfaced; write "unknown" where it came up empty. ` +
        `When you're done researching, output ONLY the document body, starting with a # title. No preamble, no meta-commentary, no tool narration.`);
      const prompt =
        `Product: ${subject}${site ? `\nWebsite: ${site}` : ''}${profile.goal ? `\nThe human's stated goal: ${profile.goal}` : ''}\n` +
        `Focus areas: ${focus.join(', ')}` +
        `${done.length ? `\nAlready written (build on them, do not repeat): ${done.join(', ')}` : ''}` +
        `${d.file === 'brand-guidelines.md' && designTokens ? `\n\n${designTokens}\nUse these as the palette/typography source of truth — put the real hexes in the table and cite the CSS URL in the doc.` : ''}\n\n` +
        `Write **${d.file}** following EXACTLY this section structure (replace <Product> with the real name; keep sections in this order, keep them tight):\n\n${d.outline}`;
      // a doc must LOOK like a doc: tool-less runtimes sometimes narrate an intent
      // ("let me gather context…") instead of writing — that must never reach the
      // library. Shape-check + one sharpened retry, then the honest skip. A thrown
      // complete() (provider outage) costs THIS doc only — the loop moves on.
      const looksLikeDoc = (t: string) => t.startsWith('#') && t.length >= 400;
      const write = (usr: string) => canResearch
        ? withTimeout(researchComplete(system, usr, cred.token ?? '', runner.model, repoCwd, log, mcpServers), 420_000, `${d.file} research turn timed out`)
        : runtimeFor(runner.runtime).complete(system, usr, cred.token ?? '', runner.model);
      let body = '';
      try {
        body = (await write(prompt)).trim();
        if (body && !isStandDown(body) && !looksLikeDoc(body)) {
          log({ kind: 'tool', phase: 'call', summary: `${d.file} — reply wasn't the doc; one retry` });
          body = (await write(`${prompt}\n\nYour previous reply was commentary, not the document. Output the COMPLETE ${d.file} markdown document now — start with the # title.`)).trim();
        }
      } catch (err) {
        console.error(`mk_bootstrap id=${s.id} ${d.file} complete failed:`, err);
        body = '';
      }
      if (!body || isStandDown(body) || !looksLikeDoc(body)) {
        log({ kind: 'wake', phase: 'stood_down', summary: `${d.file} — nothing produced` });
        await say(`⚠️ Couldn't produce **${d.label}** this pass — nudge me here and I'll pick it up.`).catch(() => {});
        continue;
      }
      const art = await post('/v1/commands', actor, { type: 'artifact.create', channel: s.channel_id, kind: 'doc', name: d.file, inlineContent: body, mime: 'text/markdown', tags: ['brand'] }).catch(() => null);
      if (!art?.ok) console.warn(`mk_bootstrap id=${s.id} artifact ${d.file} failed: ${art ? art.status : 'network'}`);
      await say(`📄 **${d.label}** — saved to the library as \`${d.file}\`.\n\n${body}`);
      done.push(d.file);
      written[d.file] = body;
      log({ kind: 'tool', phase: 'result', summary: `${d.file} saved to the library` });
    }
    if (done.length === targets.length) {
      // a nudge that completes the set closes SHORT — the full recs plan already
      // shipped with the original bootstrap closing; re-recommending would stack cards
      await say(opts?.only?.length
        ? `Done — ${targets.map((d) => `\`${d.file}\``).join(', ')} ${targets.length === 1 ? 'is' : 'are'} in the **Library**. That completes the brand foundation.`
        : `That's the brand foundation — the docs are in the **Library** tab, and I'll write from them from here on. ` +
          `Here's the starting cadence I'd run, straight from the strategy — arm what you like, tweak the rest. ` +
          `You approve anything before it ever publishes.\n\n${await scheduleRecsBlock()}\n\n` +
          // the nmplays sibling (marketing-os round): now the foundation exists, the
          // highest-value next move is a BASELINE — recommended, never auto-run: the
          // bootstrap's cost stays flat and the plan gate stays the consent (docs/design/
          // marketing-os-2026-08 §4.7). Deterministic recs — audit first when never run.
          `And now that the foundation exists, the highest-value next move is a baseline — score the site once so every later change has a number to move.\n\n` +
          playbookRecsBlock(s.channel_id, [
            { id: 'audit', why: 'six dimensions, scored — the number your work moves' },
            { id: 'geo', why: 'who gets cited on your questions today' },
          ]));
    } else if (done.length || targets.length) {
      await say(`${done.length} of ${targets.length} docs made it to the library this pass — reply here and I'll pick up the rest.`);
    }
    log({ kind: 'wake', phase: 'replied', summary: `brand foundation — ${done.length}/${targets.length} docs in the library` });
    console.log(`mk_bootstrap id=${s.id} agent=${runner.name} docs=${done.length}/${targets.length}`);
  } catch (err) {
    console.error(`mk_bootstrap id=${s.id} failed:`, err);
    await say('⚠️ I hit an error mid-analysis — nudge me here and I\'ll pick it back up.').catch(() => {});
  } finally {
    stream('', true); // clear the live bubble on every exit — wakeThread's own rule
    setStatus(runner, 'online');
  }
}
setInterval(() => { void runDueSchedules().catch(() => {}); }, 60_000);
// parks wake on the same minute tick — a wait wants a cadence, not a dedicated timer
setInterval(() => { void runDueParks().catch(() => {}); }, 60_000);
setTimeout(() => { void runDueSchedules().catch(() => {}); }, 20_000); // first pass shortly after boot


  return { researchComplete, runMarketingBootstrap, siteDesignTokens };
}
