// DRAFTED CONTENT — the image an agent draws for a card, the in-place revision by card
// letter, and the transcript a turn is built from. Drafts only: publishing is a human's click.
// Extracted from agents.ts (track B2).
import { EMPTY_BRAND, PACKS, TURN_BUDGETS, parseDraftRevisions, parseShowLetters, type AgentRole, type DraftRevision, visibleStream } from '@neuramesh/shared';
import { brandTokensFor, designerImageCred, emitStream, generateBrandImage, runtimeFor } from '../agents';
import type { HostedAgent, ThreadTask } from '../agents';



import { pickImageProvider, textComplete, type ImageCred } from '../imagegen';
import { providerFor } from '../runtime/adapter';
import { BRIEF_SYSTEM, REWRITE_SYSTEM, briefAsk, parseRewrite, rewriteAsk, type BrandBits } from './draftbrief';
import { type DraftRow } from './orchtools';
import { type LogFn } from '../agentlog';

import { type SubjectRef } from '../harness/brain';
import { withTimeout } from './turnkit';
import type { PowerSyncDatabase } from '@powersync/node';


import type { PromptOverride } from '../runtime/adapter';
import type { Seat } from './lookups';

import type { makeRuns } from './runs';
import type { makeLookups } from './lookups';
import type { makeBlock } from './block';





import type { HostCtx } from './ctx';
import { makeTurnContext } from './turncontext';

export function makeContent(ctx: HostCtx & {
  agents: Map<string, HostedAgent>;
  alog: (agent: HostedAgent, t?: { id: string; number: number; channel_id?: string } | null, channelSlug?: string | null, runId?: string | null) => LogFn;
  apiUrl: string;
  blockFor: ReturnType<typeof makeBlock>['blockFor'];
  brainBriefing: (subject: SubjectRef | null, dir: string) => string;
  db: PowerSyncDatabase;
  designerOverride: (a: { ch: { id: string; slug: string; workspace_id: string }; taskId: string | null; label: string; brief: string; dir: string; brainSubject: SubjectRef | null }) => Promise<PromptOverride>;
  ensureChatWorkspace: (threadId: string) => string;
  legSummary: (out: string) => string;
  narrate: ReturnType<typeof makeRuns>['narrate'];
  openRun: ReturnType<typeof makeRuns>['openRun'];
  ownerActorId: string;
  post: unknown;
  recordLegResult: (subject: SubjectRef, where: { channelId: string; taskId?: string | null }, leg: { role: string; label: string; turnId: string; out: string }) => void;
  resolveSeat: (parent: HostedAgent, channelId: string, role: AgentRole) => Promise<Seat>;
  seatLabel: ReturnType<typeof makeLookups>['seatLabel'];
  taskOf: ReturnType<typeof makeLookups>['taskOf'];
  workspace: string;
}) {
const { agents, apiUrl, db, ownerActorId, post } = ctx;

  // Split-out neighbours: same ctx, so every call below keeps the name it always used.
  const { threadTranscript, orchSpawnFor } = makeTurnContext(ctx);

// The marketer revising its drafts after a human requests a change (§4.5). It writes a `revise`
// block naming ONLY the drafts that change; the daemon applies each (content.revise for copy, +
// a regenerated on-brand image where asked) so the CARD updates — not just a chat acknowledgement.
// Returns the reply text, or null when there are no drafts yet (caller falls back to a plain turn).
// The card's "Try again" (§4.6): regenerate ONE draft's image from its existing brief — no LLM
// turn, just the designer's key + generateBrandImage. Records the outcome ON the card (thumb on
// success, image_error on failure) so the reason is never buried in a summary message again.
/**
 * Draw the picture ONE draft asked for, from the brief already on it. No LLM turn.
 *
 * Scoped by CHANNEL, not by task (2026-08-08). It used to take the owning `ThreadTask` and
 * filter `task_id = t.id`, which is why the Generate-image button existed only on a content
 * task's cards: a draft written in a conversation had no task to match, so the same card in a
 * thread could show its brief and never draw it. The channel is the honest scope — it is the
 * ACL boundary, it is where the designer and the brand tokens are resolved from, and it is the
 * same guarantee the task filter was actually providing.
 */
async function generateDraftImage(agent: HostedAgent, ch: { id: string; slug: string; workspace_id: string }, itemId: string): Promise<string> {
  const [d] = await db.getAll<{ platform: string; media: string | null }>(
    `select platform, media from content_items where id = ? and channel_id = ? and status = 'draft'`,
    [itemId, ch.id],
  ).catch(() => [] as Array<{ platform: string; media: string | null }>);
  if (!d) return `That draft isn't available to re-image (already scheduled or gone).`;
  let brief = '';
  try { brief = (JSON.parse(d.media ?? 'null') as { brief?: string } | null)?.brief ?? ''; } catch { /* none */ }
  if (!brief) return `That draft has no image brief to draw from — ask me for a visual and I'll add one.`;

  const out = await drawBriefed(agent, ch, itemId, d.platform, brief);
  if (!out.ok) {
    return /no image key/.test(out.error ?? '')
      ? `I can't draw it — there's no image key connected. Add an OpenAI or Gemini key under Image generation and hit Try again.`
      : `Couldn't generate that image — ${out.error}. The reason is on the card; Try again when it's sorted.`;
  }
  return `Drew the image${out.model ? ` on ${out.model}` : ''} — it's on the card now. Nothing publishes until you approve.`;
}

/** The draw tail both callers share: credential ladder → brand → pixels → attach + thumb (or
 *  the imageError revise). Outcome-shaped so the calendar's button gets data, not prose. */
async function drawBriefed(agent: HostedAgent, ch: { id: string; slug: string; workspace_id: string }, itemId: string, platform: string, brief: string): Promise<{ ok: boolean; thumb?: string; model?: string; error?: string }> {
  const postCmd = async (cmd: unknown): Promise<boolean> => {
    const r = await post('/v1/commands', { kind: 'agent', id: agent.id, role: agent.role }, cmd).catch(() => null);
    return !!(r && (r as { ok?: boolean }).ok);
  };
  const designer = [...agents.values()].find((a) => a.role === 'designer' && a.channels.has(ch.id));
  const { cred } = await designerImageCred(apiUrl, ch.workspace_id, designer, ownerActorId);
  if (!cred) {
    const why = 'no image key on this workspace — add one under Image generation';
    await postCmd({ type: 'content.revise', item: itemId, imageError: why });
    return { ok: false, error: why };
  }
  const brand = await brandTokensFor(db, ch.id);
  const reviewSeat = providerFor(agent.runtime) === cred.provider ? agent.model : (PACKS[cred.provider === 'openai' ? 'openai-core' : 'gemini-core']?.roles.marketer ?? '');
  const g = await generateBrandImage(cred, reviewSeat, brand, brief, platform, agent.name);
  if (g.error || (!g.thumb && !g.publish)) {
    const why = g.error ?? 'the image came back empty';
    await postCmd({ type: 'content.revise', item: itemId, imageError: why });
    console.log(`agent_gen_image agent=${agent.name} room=#${ch.slug} item=${itemId.slice(0, 8)} failed=${why}`);
    return { ok: false, error: why };
  }
  if (g.publish) await postCmd({ type: 'content.attach_media', item: itemId, dataUrl: g.publish });
  if (g.thumb) await postCmd({ type: 'content.revise', item: itemId, thumb: g.thumb });
  console.log(`agent_gen_image agent=${agent.name} room=#${ch.slug} item=${itemId.slice(0, 8)} ok model=${g.model ?? '?'}`);
  return { ok: true, thumb: g.thumb, model: g.model };
}

/**
 * The calendar's Generate/Regenerate/New-angle button (docs/design/calendar-image-gen-2026-08):
 * one direct entry, no thread detour, no marker message. Brief-less drafts get their brief
 * WRITTEN here (one text-only completion on the same image credential — one key powers words
 * and pixels, so "no image key" stays the single failure story); `rewrite` redrafts body +
 * brief from a new angle before drawing. Every mutation rides the command lane as the acting
 * agent — the channel's marketer, else the orchestrator — so sync and the papertrail hold.
 */
async function draftImageFor(itemId: string, opts: { angle?: string; rewrite?: boolean } = {}): Promise<{ ok: boolean; thumb?: string; body?: string; error?: string }> {
  const [d] = await db.getAll<{ platform: string; media: string | null; body: string; channel_id: string; slug: string; workspace_id: string }>(
    `select ci.platform, ci.media, ci.body, ci.channel_id, c.slug, c.workspace_id
       from content_items ci join channels c on c.id = ci.channel_id
      where ci.id = ? and ci.status = 'draft'`,
    [itemId],
  ).catch(() => []);
  if (!d) return { ok: false, error: 'that draft isn’t available (already scheduled or gone)' };
  const ch = { id: d.channel_id, slug: d.slug, workspace_id: d.workspace_id };
  const agent = [...agents.values()].find((a) => a.role === 'marketer' && a.channels.has(ch.id))
    ?? [...agents.values()].find((a) => a.role === 'orchestrator');
  if (!agent) return { ok: false, error: 'no agent is running on this machine to draw it — is the workspace still starting?' };
  const postCmd = async (cmd: unknown): Promise<boolean> => {
    const r = await post('/v1/commands', { kind: 'agent', id: agent.id, role: agent.role }, cmd).catch(() => null);
    return !!(r && (r as { ok?: boolean }).ok);
  };
  const designer = [...agents.values()].find((a) => a.role === 'designer' && a.channels.has(ch.id));
  const { cred } = await designerImageCred(apiUrl, ch.workspace_id, designer, ownerActorId);
  if (!cred) {
    const why = 'no image key on this workspace — add one under Image generation';
    await postCmd({ type: 'content.revise', item: itemId, imageError: why });
    return { ok: false, error: why };
  }
  const brandFull = await brandTokensFor(db, ch.id);
  const bits: BrandBits = { palette: brandFull.tokens.palette.map((c) => c.hex), fonts: brandFull.tokens.fonts, product: brandFull.product };
  const seat = providerFor(agent.runtime) === cred.provider ? agent.model : (PACKS[cred.provider === 'openai' ? 'openai-core' : 'gemini-core']?.roles.marketer ?? '');
  let brief = '';
  try { brief = (JSON.parse(d.media ?? 'null') as { brief?: string } | null)?.brief ?? ''; } catch { /* none */ }
  let body: string | undefined;
  if (opts.rewrite) {
    const raw = await textComplete(cred, seat, REWRITE_SYSTEM, rewriteAsk(d.body, d.platform, bits, opts.angle)).catch(() => '');
    const rw = parseRewrite(raw);
    if (!rw) return { ok: false, error: 'the rewrite came back unusable — try again' };
    body = rw.body;
    brief = rw.brief;
    if (!(await postCmd({ type: 'content.revise', item: itemId, body, imageBrief: brief }))) return { ok: false, error: 'saving the rewrite didn’t stick — try again' };
    console.log(`draft_rewrite agent=${agent.name} room=#${ch.slug} item=${itemId.slice(0, 8)}${opts.angle ? ' angled' : ''}`);
  } else if (!brief) {
    const raw = await textComplete(cred, seat, BRIEF_SYSTEM, briefAsk(d.body, d.platform, bits)).catch(() => '');
    brief = raw.trim().replace(/^["'`]+|["'`]+$/g, '').split('\n')[0]!.slice(0, 400);
    if (!brief) return { ok: false, error: 'couldn’t write an image brief from this post — try again' };
    await postCmd({ type: 'content.revise', item: itemId, imageBrief: brief });
  }
  const out = await drawBriefed(agent, ch, itemId, d.platform, brief);
  return out.ok ? { ok: true, thumb: out.thumb, body } : { ok: false, body, error: out.error };
}
/**
 * Draw ONE image for the CONVERSATION itself — no draft, no card (article round, 2026-08-19).
 *
 * generateDraftImage above is draft-scoped by design (it records outcomes ON a post card), which
 * left "rex, generate a cover photo" with no way to SHOW anything: the model narrated a picture
 * it had nowhere to put. This is the draft-free seam share_images rides — same credential ladder,
 * same brand tokens, the bytes come back to the caller instead of onto a card.
 */
async function generateShareImage(agent: HostedAgent, ch: { id: string; slug: string; workspace_id: string }, brief: string): Promise<{ thumb?: string; bytes?: Buffer; error?: string }> {
  const designer = [...agents.values()].find((a) => a.role === 'designer' && a.channels.has(ch.id));
  const { cred } = await designerImageCred(apiUrl, ch.workspace_id, designer, ownerActorId);
  if (!cred) return { error: 'no image key connected — add an OpenAI or Gemini key under Image generation' };
  const brand = await brandTokensFor(db, ch.id);
  const reviewSeat = providerFor(agent.runtime) === cred.provider ? agent.model : (PACKS[cred.provider === 'openai' ? 'openai-core' : 'gemini-core']?.roles.marketer ?? '');
  const g = await generateBrandImage(cred, reviewSeat, brand, brief, 'x', agent.name);
  if (g.error || !g.thumb) return { error: g.error ?? 'the image came back empty' };
  console.log(`agent_share_image agent=${agent.name} room=#${ch.slug} ok model=${g.model ?? '?'}`);
  return { thumb: g.thumb, bytes: g.bytes }; // the bytes too: make_product_image shelves a copy (chattools-product.ts)
}
async function reviseContentDrafts(agent: HostedAgent, ch: { id: string; slug: string; workspace_id: string }, t: ThreadTask, m: { id: string; body: string }, mode: string, token: string): Promise<string | null> {
  // draft AND scheduled: a human's free-form "change the drafts" reaches every unpublished post,
  // even ones the marketer already slotted (the store unschedules a revised scheduled post so it
  // returns for approval). Without 'scheduled' here, an all-scheduled batch found NO drafts, so
  // the wake fell through to a plain chat turn and the requested edit was silently dropped.
  const drafts = await db.getAll<{ id: string; platform: string; body: string; media: string | null }>(
    `select id, platform, body, media from content_items where task_id = ? and status in ('draft', 'scheduled') order by created_at asc`,
    [t.id],
  ).catch(() => [] as Array<{ id: string; platform: string; body: string; media: string | null }>);
  if (!drafts.length) return null;
  const briefOf = (media: string | null): string => { try { return (JSON.parse(media ?? 'null') as { brief?: string } | null)?.brief ?? ''; } catch { return ''; } };
  const lettered = drafts.map((d, i) => ({ id: d.id, platform: d.platform, body: d.body, brief: briefOf(d.media), letter: String.fromCharCode(97 + i) }));

  let revisions: DraftRevision[];
  let showLetters: string[] = [];
  let prose = '';
  if (mode === 'claude') {
    // TWO verbs, because the human asks for two things. The contract knew only "change this",
    // so "can you show the drafts for x" left the model nothing to do but RETYPE all three
    // posts as markdown — beside the very cards that were already rendering them (live #1048).
    // `cards` names drafts; the thread re-anchors those cards under this reply. The
    // never-paste rule is the whole point: a card is the product's answer, prose is not.
    const contract = `\n\n[CONTENT THREAD — these drafts are ALREADY ON SCREEN as review cards in this thread, one card each, labelled #${t.number}·a, #${t.number}·b, …:\n${lettered.map((d) => `${d.letter}) [${d.platform}] ${d.body}${d.brief ? `  (image brief: ${d.brief})` : ''}`).join('\n')}\n\nNEVER paste, quote or retype a draft's text in your reply — the human is looking at the cards, and repeating them puts the same post on screen twice. Refer to a draft by its letter.\n\nReply in one or two plain sentences. THEN, when the human asked to SEE drafts, add a fenced block tagged \`cards\` naming their letters — the cards re-render under your reply:\n\`\`\`cards\na, b, c\n\`\`\`\nAnd when the human asked to CHANGE drafts, add a fenced block tagged \`revise\` with a JSON array of ONLY the drafts that change:\n\`\`\`revise\n[{"letter":"a","body":"the complete revised post text","imageBrief":"optional — set only to add/replace the image"}]\n\`\`\`\n"body" is the full new post (not a diff). Leave unchanged drafts OUT. Use either block, both, or neither — a revised draft re-renders on its own, so it needs no \`cards\` entry.]`;
    const raw = await withTimeout(
      runtimeFor(agent.runtime).streamTurn(agent, ch.slug, (await threadTranscript(agent, t)) + contract, token, undefined, (t2) => emitStream(`${t.channel_id}:${t.id}`, agent.name, t2, false)),
      TURN_BUDGETS.triage.wallMs,
      'revise turn timed out after 4m',
    );
    revisions = parseDraftRevisions(/```revise\s*\n([\s\S]*?)```/.exec(raw)?.[1] ?? '');
    showLetters = parseShowLetters(/```cards\s*\n([\s\S]*?)```/.exec(raw)?.[1] ?? '');
    // visibleStream is the SAME matcher the live bubble filters with, so what the human read
    // while it typed and what lands in the thread cannot disagree about what was machinery
    prose = visibleStream(raw).text;
  } else {
    // echo: a deterministic, targeted revision so the loop is provable without an LLM
    const ask = m.body.replace(/^↩\s*Re\s+#\S+:\s*/i, '').trim();
    const letter = (new RegExp(`#${t.number}[·.-]([a-z])`, 'i').exec(m.body)?.[1] ?? /\bdraft\s+([a-z])\b/i.exec(m.body)?.[1] ?? lettered[0]?.letter ?? 'a').toLowerCase();
    const d = lettered.find((x) => x.letter === letter) ?? lettered[0];
    // echo answers "show me" deterministically too, so the cards path is provable without a model
    const wantsShow = /\b(show|see|view|display|what are|list)\b/i.test(ask);
    revisions = wantsShow ? [] : d ? [{ letter: d.letter, body: `${d.body}\n\n— revised: ${ask.slice(0, 80)}`, ...(/\b(image|photo|visual|picture)\b/i.test(m.body) ? { imageBrief: 'a warm, on-brand hero image for this post' } : {}) }] : [];
    if (wantsShow) { showLetters = lettered.map((x) => x.letter); prose = `[echo · ${agent.name}] the ${lettered.length} draft${lettered.length === 1 ? '' : 's'}, below.`; }
  }

  // SHOW: the cards re-anchor under this reply instead of the model retyping them. Resolved to
  // ids here (the renderer keys on id, and letters shift as drafts are added) and capped to the
  // drafts this task actually has, so a hallucinated letter renders nothing rather than crashing.
  const showIds = showLetters.map((l) => lettered.find((x) => x.letter === l)?.id).filter((v): v is string => !!v);
  if (!revisions.length && showIds.length) {
    console.log(`agent_show agent=${agent.name} task=${t.number} cards=${showLetters.join(',')}`);
    return `${prose || `Draft${showIds.length > 1 ? 's' : ''} ${showLetters.join(', ')}, below.`}\n\n‹cards:${showIds.join(',')}›`;
  }
  if (!revisions.length) return prose || `I read your note but couldn't tell which draft to change — say which one (a, b, …) and what to adjust.`;

  const needsImage = revisions.some((r) => r.imageBrief);
  const brand = needsImage ? await brandTokensFor(db, t.channel_id) : { tokens: EMPTY_BRAND };
  let cred: ImageCred | null = null;
  let reviewSeat = '';
  if (needsImage) {
    const [wsRow] = await db.getAll<{ workspace_id: string }>('select workspace_id from channels where id = ?', [t.channel_id]).catch(() => [] as Array<{ workspace_id: string }>);
    const designer = [...agents.values()].find((a) => a.role === 'designer' && a.channels.has(t.channel_id));
    cred = wsRow ? (await designerImageCred(apiUrl, wsRow.workspace_id, designer, ownerActorId)).cred : pickImageProvider();
    reviewSeat = cred ? (providerFor(agent.runtime) === cred.provider ? agent.model : (PACKS[cred.provider === 'openai' ? 'openai-core' : 'gemini-core']?.roles.marketer ?? '')) : '';
  }
  const postCmd = async (cmd: unknown): Promise<boolean> => {
    const r = await post('/v1/commands', { kind: 'agent', id: agent.id, role: agent.role }, cmd).catch(() => null);
    return !!(r && (r as { ok?: boolean }).ok);
  };

  const done: string[] = [];
  const doneIds: string[] = [];
  const notes: string[] = [];
  for (const rev of revisions) {
    const d = lettered.find((x) => x.letter === rev.letter);
    if (!d) continue;
    let thumb: string | undefined;
    if (rev.imageBrief && cred) {
      const g = await generateBrandImage(cred, reviewSeat, brand, rev.imageBrief, d.platform, agent.name);
      if (g.error) notes.push(`couldn't regenerate the ${d.platform} image — ${g.error}`);
      else {
        thumb = g.thumb;
        if (g.reviewNote) notes.push(g.reviewNote);
        if (g.publish) await postCmd({ type: 'content.attach_media', item: d.id, dataUrl: g.publish });
      }
    } else if (rev.imageBrief && !cred) {
      notes.push('no image key on this workspace, so the copy changed but the image brief stayed a brief');
    }
    const ok = await postCmd({ type: 'content.revise', item: d.id, ...(rev.body ? { body: rev.body } : {}), ...(rev.imageBrief ? { imageBrief: rev.imageBrief } : {}), ...(thumb ? { thumb } : {}) });
    if (ok) { done.push(`${d.letter}${rev.imageBrief && thumb ? ' (+image)' : ''}`); doneIds.push(d.id); }
  }
  console.log(`agent_revise agent=${agent.name} task=${t.number} revised=${done.join(',') || 'none'}`);
  const summary = done.length
    ? `Updated draft${done.length > 1 ? 's' : ''} ${done.join(', ')} — the new version${done.length > 1 ? 's are' : ' is'} below. Nothing publishes until you approve.`
    : `I tried to revise but the update didn't take — give it another go in a moment.`;
  // the ‹revised:…› marker (hidden in the UI) anchors the fresh cards right after this reply, so
  // the updated draft renders below the response while the prior version stays in place above.
  // ‹cards:…› does the same for drafts the human asked to SEE but that did not change — a
  // revised draft is already anchored, so it never needs both.
  const marker = doneIds.length ? `\n\n‹revised:${doneIds.join(',')}›` : '';
  const alsoShow = showIds.filter((id) => !doneIds.includes(id));
  const showMarker = alsoShow.length ? `\n\n‹cards:${alsoShow.join(',')}›` : '';
  return [prose, summary, ...notes.map((n) => `· ${n}`)].filter(Boolean).join('\n\n') + marker + showMarker;
}
/**
 * The drafted posts a turn is standing in front of, lettered a/b/c the way their cards are.
 *
 * ONE resolver for every content tool and for the prompt block that lists them, because the
 * anchor and the letters are what they must never disagree about: a TASK thread's drafts hang
 * off `task_id` (unchanged since 0084), a conversation's off `thread_id` (0115), and "reschedule
 * b" has to reach the card marked b on screen.
 *
 * Returns null when there is no thread at all (a channel wake, a sweep): nothing to act on, and
 * a channel-wide list would let "unschedule b" hit some other conversation's post.
 */
async function draftsForAnchor(
  taskId: string | null,
  threadId: string | null,
): Promise<{ posts: DraftRow[]; msgAnchor: { taskId: string } | { threadId: string } } | null> {
  const anchor = taskId
    ? { col: 'task_id', id: taskId, msgAnchor: { taskId } as const }
    : threadId
      ? { col: 'thread_id', id: threadId, msgAnchor: { threadId } as const }
      : null;
  if (!anchor) return null;
  const rows = await db.getAll<Omit<DraftRow, 'letter'>>(
    `select id, platform, body, status, scheduled_at from content_items where ${anchor.col} = ? order by created_at asc`,
    [anchor.id],
  ).catch(() => [] as Array<Omit<DraftRow, 'letter'>>);
  // letter BEFORE any status filter: a published post still holds its letter on screen, so
  // filtering first would silently re-letter the rest and schedule the wrong card.
  return { posts: rows.map((p, i) => ({ ...p, letter: String.fromCharCode(97 + i) })), msgAnchor: anchor.msgAnchor };
}
// Build the ```nmq body for a schedule-confirm card: the custom renderer draws the per-post slots
// and a single Confirm that applies content.approve/unschedule as the HUMAN; the options are the
// graceful-degradation fallback if that renderer is ever absent (it still reads as a choice card).
function buildScheduleCard(action: 'schedule' | 'unschedule', items: Array<{ item: string; letter: string; platform: string; slot?: string; preview: string }>, question: string): string {
  // nmq answered-state keys off the question TEXT, so a SECOND proposal with a generic question
  // ("Schedule 2 posts for #1?") collapses against the stale answer of a prior one — the live test
  // caught a re-proposal rendering pre-answered. Fold a compact summary of THIS proposal's slots
  // (or letters, for unschedule) into the question: it makes each proposal a distinct, answerable
  // card AND tells the human at a glance what they're approving.
  const summary = action === 'unschedule'
    ? items.map((i) => i.letter).join(', ')
    : items.map((i) => (i.slot ? new Date(i.slot).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '?')).join(' · ');
  const q = {
    question: `${question} (${summary})`,
    schedule: { action, items },
    options: [{ label: action === 'unschedule' ? 'Unschedule all' : 'Schedule all', description: 'apply the proposal above' }, { label: 'Not now', description: 'leave them as they are' }],
    allowOther: false,
  };
  return `\`\`\`nmq\n${JSON.stringify(q)}\n\`\`\``;
}

  return { buildScheduleCard, draftImageFor, draftsForAnchor, generateDraftImage, generateShareImage, orchSpawnFor, reviseContentDrafts, threadTranscript };
}
