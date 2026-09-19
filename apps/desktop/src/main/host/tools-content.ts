// The CONTENT tools — drafting, revising and scheduling posts, and drawing for them (docs/harness/04).
//
// Drafts only. Publishing is a human's click, and nothing here can bypass that.
//
// Split out of host/orchtools.ts. Each group is a function of the TURN's context — the room, the
// agent, the thread it is answering in, the seat it was granted — because a tool that closed over
// a previous turn's seat would spend the wrong credential.


import { normalizeDraft, parseDraftRevisions } from '@neuramesh/shared';
import type { OrchTool, ToolCtx } from './orchtools';
import { frameArg, framesFor } from './frames';
import { ungrounded } from './grounding';
import { ugcOrchTools, unpicked } from './ugcflow';

export function contentTools(tc: ToolCtx): OrchTool[] {
  const { z, db, post, ch, agent, actor, thread, convoThreadId, log,
          draftsHere, grounding, libraryDocs,
          buildScheduleCard, generateDraftImage, generateShareImage } = tc;
  // the message a deliverable anchors to: a task thread's ride the TASK, a conversation's the
  // THREAD (0115) — the same rule every content surface keys on
  const msgAnchor = () => (thread ? { taskId: thread.id } : convoThreadId ? { threadId: convoThreadId } : null);
  const shareTools: OrchTool[] = [
    // ── Deliver an ARTICLE (article round): a doc artifact + the ‹article:id› card ──────────
    { name: 'draft_article', description: 'Deliver an ARTICLE or long-form research write-up as a reviewable ARTICLE CARD in this conversation — the reader opens it in a reading tab, saves it to Workspace Files, or downloads it. Use it whenever the ask is an article, essay, report or research write-up (a post is draft_posts; a task file is an artifact on the task). Markdown in `markdown` is the WHOLE piece: start with a single `# Title`, then the dek paragraph; end citable work with a `## Sources` section of numbered links. NEVER paste the article into your reply — the card is the delivery.', schema: {
      title: z.string().min(1).max(200).describe('the article title — becomes the # heading if the markdown lacks one'),
      markdown: z.string().min(50).max(200_000).describe('the complete article as markdown'),
    }, run: async (input: { title: string; markdown: string }) => {
      const anchor = msgAnchor();
      if (!anchor) return 'draft_article needs a conversation to deliver into — reply inside the thread and deliver there.';
      const md = /^#\s/m.test(input.markdown) ? input.markdown : `# ${input.title}\n\n${input.markdown}`;
      const name = `${input.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'article'}.md`;
      const res = await post('/v1/commands', actor, { type: 'artifact.create', channel: ch.id, kind: 'doc', name, inlineContent: md, mime: 'text/markdown' }).catch(() => null);
      const artifactId = res?.ok ? ((await res.json().catch(() => null)) as { artifactId?: string } | null)?.artifactId : null;
      if (!artifactId) return 'The article could not be saved — say so plainly rather than pasting it into your reply.';
      const posted = await post('/v1/messages', actor, { workspace: ch.workspace_id, channel: ch.id, ...anchor, body: `‹article:${artifactId}›` }).catch(() => null);
      log?.({ kind: 'tool', phase: 'call', summary: `draft_article — ${name}` });
      if (!posted?.ok) return 'The article saved but its card did not post — mention the article exists in Files.';
      return 'The article is delivered as a card in this thread — the human opens, saves or downloads it there. Do NOT repeat the article in your reply: one short line on the angle you took.';
    } },
    // ── SHOW images in the conversation (article round): generate → message attachments ─────
    { name: 'share_images', description: 'Generate one or more images and SHOW them in this conversation as image attachments — previews inline, expandable, downloadable. Use it whenever the human asks you to generate/create/show a picture, cover, illustration or visual that is NOT attached to a drafted post (a post\'s picture rides its card via imageBrief/generate_image). Each brief is full art direction: subject, composition, light, mood, on-brand look. NEVER claim an image exists without calling this — if the call fails, report the failure.', schema: {
      images: z.array(z.object({
        brief: z.string().min(8).max(2000).describe('art direction for this image'),
        name: z.string().max(80).optional().describe('a short kebab-case filename, e.g. x-article-cover'),
      })).min(1).max(4).describe('up to 4 images per call'),
      caption: z.string().max(500).optional().describe('one short line to post above the images'),
    }, run: async (input: { images: Array<{ brief: string; name?: string }>; caption?: string }) => {
      const anchor = msgAnchor();
      if (!anchor) return 'share_images needs a conversation to deliver into.';
      const made: Array<{ name: string; thumb: string }> = [];
      const failed: string[] = [];
      for (const im of input.images) {
        const g = await generateShareImage(agent, ch, im.brief).catch(() => ({ error: 'the generator crashed' }));
        if ('thumb' in g && g.thumb) made.push({ name: im.name?.replace(/[^\w.-]+/g, '-').slice(0, 60) || 'image', thumb: g.thumb });
        else failed.push(('error' in g ? g.error : null) ?? 'the image came back empty');
      }
      if (!made.length) return `No images were generated — ${failed[0] ?? 'unknown failure'}. Report this plainly; never describe an image that does not exist.`;
      const posted = await post('/v1/messages', actor, { workspace: ch.workspace_id, channel: ch.id, ...anchor, body: input.caption?.trim() || `Here ${made.length === 1 ? 'is the image' : 'are the images'}.` }).catch(() => null);
      const messageId = posted?.ok ? ((await posted.json().catch(() => null)) as { message?: { id?: string } } | null)?.message?.id : null;
      if (!messageId) return 'The images generated but their message did not post — try once more.';
      let attached = 0;
      for (const im of made) {
        const mime = /^data:([^;]+);/.exec(im.thumb)?.[1] ?? 'image/png';
        const b64 = im.thumb.split(',')[1] ?? '';
        const ok = await post('/v1/artifacts', actor, {
          id: crypto.randomUUID(), workspace: ch.workspace_id, channel: ch.id, messageId,
          ...(thread ? { taskId: thread.id } : {}),
          kind: 'file', name: `${im.name}.${mime.split('/')[1] === 'jpeg' ? 'jpg' : (mime.split('/')[1] ?? 'png')}`,
          mime, inlineContent: im.thumb, sizeBytes: Math.floor(b64.length * 0.75),
        }).catch(() => null);
        if (ok?.ok) attached += 1;
      }
      log?.({ kind: 'tool', phase: 'call', summary: `share_images — ${attached}/${input.images.length}` });
      if (!attached) return 'The images generated but could not attach — report the failure.';
      return `${attached} image${attached === 1 ? ' is' : 's are'} now SHOWING in the thread${failed.length ? ` (${failed.length} failed: ${failed[0]})` : ''}. Do not describe them — the human can see them; one short line at most.`;
    } },
  ];
  return [...shareTools,
    // ── Social drafts: write them, then schedule them ───────────────────────────────────────
    // NOT gated on the room's kind any more (founder, 2026-08-08). The gate was never a data
    // constraint: a post publishes through the connector its channel's PROJECT owns (0106,
    // `connectorWithSecret`), so a #build room in a project with an X account could always
    // have published — it simply had no tools to draft with. Restricting the trade to rooms
    // typed `marketing` only made every OTHER room answer a draft request with prose.
    //
    // The orchestrator can WRITE a draft and PROPOSE a slot; it can never publish (content.
    // approve is HUMAN_ONLY), so scheduling builds a confirmation card whose click fires the
    // command as the human. The publish gate stays structural, not prompted.
    ...ugcOrchTools(tc, msgAnchor),
    { name: 'draft_posts', description: 'Hand over drafted social posts as REVIEWABLE CARDS in this conversation — how posts are delivered, in any room. NEVER write posts.json or paste posts as markdown (nothing to click). `body` is ONLY the wire text — no character counts, no "(draft only)" footers, no image briefs inside it; it would publish verbatim. Art direction goes in `imageBrief`, only when the post should carry a visual (Instagram and TikTok always do). A VIDEO post (a UGC or creator script) puts the script in `script` and the caption that posts with the video in `body`; never the script in the body. Draft for the platform the ask names, else for the connected accounts. Call ONCE with every post — calling again ADDS drafts (revise_posts changes one in place).', schema: {
      posts: z.array(z.object({
        platform: z.enum(['x', 'instagram', 'linkedin', 'tiktok', 'email']).describe('the network this post is for: the one asked for, else a connected account'),
        body: z.string().min(1).max(10_000).describe('the post text exactly as it would publish, within the network\'s limit. For a video post: the caption that posts with the video.'),
        imageBrief: z.string().max(2000).optional().describe('art direction for this post\'s picture — subject, composition, light, mood, on-brand look. For a video post: the shot direction the film follows. Omit for a text-only post.'),
        mediaUrl: z.string().max(2000).optional().describe('a genuinely real public image URL, if you have one. Never invent one.'),
        script: z.string().max(10_000).optional().describe('a VIDEO post only: the creator\'s script, timestamped beats ([0:00-0:03] direction, Spoken: "…", CAPTION: …). The card folds it and can film its hook.'),
        frame: z.string().max(200).optional().describe('a VIDEO post that shows the product: the name of an IMAGE on this room\'s shelf (a real screenshot, see list_library). The film then shows that screen, never an invented one. Omit when the shelf has no screenshot, and ask the human for one.'),
      })).min(1).max(20).describe('one entry per post, in the order they should read'),
    }, run: async (input: { posts: Array<{ platform: string; body: string; imageBrief?: string; mediaUrl?: string; script?: string; frame?: string }> }) => {
      // The anchor: a task thread's drafts ride the TASK (unchanged, so a content task reads
      // byte-identically); a conversation's ride the THREAD (0115). Without one there is no
      // surface to render on — a channel-level draft would card nowhere.
      const anchor = thread ? { task: thread.id } : convoThreadId ? { thread: convoThreadId } : null;
      if (!anchor) return 'draft_posts needs a thread to deliver into — reply inside the conversation and draft there.';
      // the grounding gate (host/grounding.ts): a marketing room's brand docs are read before a draft is written
      const gate = await ungrounded(db, ch.id, grounding);
      if (gate) { log?.({ kind: 'tool', phase: 'result', summary: 'draft_posts refused: the brand docs were not read this turn' }); return gate; }
      // the angle gate (host/ugcflow.ts): a VIDEO post is the UGC playbook's, and it drafts only after the human picked an angle
      if (input.posts.some((p) => p.script)) {
        const pick = await unpicked(db, { threadId: convoThreadId, taskId: thread?.id });
        if (pick) { log?.({ kind: 'tool', phase: 'result', summary: 'draft_posts refused: no answered angle card in this thread' }); return pick; }
      }
      // The guard that used to live here is GONE, and its removal is the point: it refused any
      // task the triage had not typed `content`, because the renderer's two transcript builders
      // meant those drafts would card nowhere. There is one builder now — every thread renders
      // the drafts it holds — so there is no longer a place a draft can be invisible.
      // one cleaner for the tool path and the marketer's posts.json (normalizeDraft), so a
      // "Character count: 196/280" footer is stripped identically whichever door it came in
      const drafts = input.posts.map((p) => normalizeDraft(p)).filter((p): p is NonNullable<typeof p> => !!p);
      if (!drafts.length) return 'None of those entries were usable posts — each needs a supported platform and a body that is more than working notes.';
      // the frame (host/frames.ts): a name the shelf does not hold is refused before anything is written
      const frames = await framesFor(libraryDocs, ch.id, input.posts);
      if (!frames.ok) { log?.({ kind: 'tool', phase: 'result', summary: 'draft_posts refused: a frame is not on the shelf' }); return frames.why; }
      let made = 0;
      for (const [i, d] of drafts.entries()) {
        const res = await post('/v1/commands', actor, {
          type: 'content.create', channel: ch.id, ...anchor, platform: d.platform, body: d.body,
          ...(d.imageBrief ? { imageBrief: d.imageBrief } : {}), ...(d.mediaUrl ? { mediaUrl: d.mediaUrl } : {}), ...(d.script ? { script: d.script } : {}), ...(frames.names.has(i) ? { frame: frames.names.get(i) } : {}),
        }).catch(() => null);
        if (res?.ok) made += 1;
      }
      if (!made) return 'The drafts could not be saved — say so plainly rather than pasting the posts into your reply.';
      log?.({ kind: 'tool', phase: 'call', summary: `draft_posts — ${made} draft${made === 1 ? '' : 's'}` });
      const letters = drafts.slice(0, made).map((_, i) => String.fromCharCode(97 + i)).join('/');
      return `${made} draft${made === 1 ? '' : 's'} delivered as cards in this thread (${letters}) — the human reads them there and approves, schedules, or asks for changes. Do NOT repeat the posts in your reply: one short line naming what you drafted and what you'd change on their word.`;
    } },
    { name: 'revise_posts', description: 'Rewrite drafts that are ALREADY on screen here, in place — always use this when the human asks to change a post ("make b punchier", "drop the emoji on a"). Name each by its card letter. The card keeps its letter and its earlier version stays readable beneath it, so the human sees what changed. Calling draft_posts instead would leave the old draft sitting there and add a second one beside it, which is the wrong answer to "change this".', schema: {
      revisions: z.array(z.object({
        letter: z.string().describe('the card letter to rewrite: a, b, c…'),
        body: z.string().max(10_000).optional().describe('the replacement post text, in full — wire text only, no notes (a video post: its caption)'),
        imageBrief: z.string().max(2000).optional().describe('replacement art direction for this post\'s picture (a video post: its shot direction)'),
        script: z.string().max(10_000).optional().describe('a video post: the replacement script, in full. The card films the new one on the next Generate video.'),
        frame: z.string().max(200).optional().describe('a video post: the name of an image on this room\'s shelf the film shows as the product (a real screenshot). "none" drops the frame.'),
      })).min(1).max(20),
    }, run: async (input: { revisions: Array<{ letter: string; body?: string; imageBrief?: string; script?: string; frame?: string }> }) => {
      const here = await draftsHere();
      if (!here) return 'revise_posts works on the drafts in a thread — open the conversation or task that has them.';
      if (!here.posts.length) return 'There are no drafts here to revise — draft_posts first.';
      const byLetter = new Map(here.posts.map((p) => [p.letter, p]));
      const done: string[] = [];
      const missed: string[] = [];
      // letters whose ART DIRECTION changed — they get a fresh picture below, once every copy
      // revision has landed (drawing is slow; the text should not wait on it)
      const drew: string[] = [];
      for (const r of input.revisions) {
        const target = byLetter.get(r.letter.trim().toLowerCase());
        // published posts are history — the server refuses them too, but saying WHICH letter
        // failed is what lets the reply be honest instead of claiming a change that never landed
        if (!target || target.status === 'published') { missed.push(r.letter); continue; }
        // ONE cleaner for a revision (parseDraftRevisions, the posts-file path's): the caption
        // stripped of notes, a script filed under a heading in the brief or the body lifted out
        const [rev] = parseDraftRevisions(JSON.stringify([r]));
        if (!rev && !r.frame?.trim()) { missed.push(r.letter); continue; } // a frame alone is a change too
        const { body, imageBrief: brief, script } = rev ?? {};
        const fr = await frameArg(libraryDocs, ch.id, r.frame);
        if (!fr.ok) return fr.why;
        const res = await post('/v1/commands', actor, {
          type: 'content.revise', item: target.id,
          ...(body ? { body } : {}), ...(brief ? { imageBrief: brief } : {}), ...(script ? { script } : {}), ...(fr.frame !== undefined ? { frame: fr.frame } : {}),
        }).catch(() => null);
        if (res?.ok) { done.push(target.letter); if (brief) drew.push(target.letter); } else missed.push(r.letter);
      }
      if (!done.length) return `Nothing was revised (${missed.join(', ') || 'no matching cards'}) — say so plainly rather than pasting the new copy into your reply.`;
      log?.({ kind: 'tool', phase: 'call', summary: `revise_posts — ${done.join('/')}` });
      // A NEW brief means a new picture, and this is where "change the picture" lands. The tool
      // path used to write media.brief and stop, while the content-task path (reviseContentDrafts)
      // drew on the very same field — so an agent that revised a brief here reported a change the
      // card never showed. Drawing is best-effort: a failed redraw records itself ON the card
      // (image_error) and never un-does the copy revision that already landed.
      const redrew: string[] = [];
      for (const letter of drew) {
        const target = byLetter.get(letter);
        if (!target) continue;
        const outcome = await generateDraftImage(agent, ch, target.id).catch(() => null);
        if (outcome) redrew.push(letter);
      }
      if (redrew.length) log?.({ kind: 'tool', phase: 'call', summary: `revise_posts — redrew ${redrew.join('/')}` });
      return `Revised ${done.join(', ')} in place — the updated card${done.length === 1 ? '' : 's'} and the earlier version are in the thread.${redrew.length ? ` Redrew the image on ${redrew.join(', ')}.` : ''}${missed.length ? ` Could not revise: ${missed.join(', ')} — say why.` : ''} Do NOT repeat the new copy in your reply: one short line on what you changed.`;
    } },
    // The hand that matches the eye. `generateDraftImage` has existed since the marketing round
    // and needs no model turn — but its ONLY caller was the ‹gen-image:id› marker the card's own
    // button emits, so an agent asked for a picture could do nothing but point at that button
    // (live, 2026-08-13). A tool is the fix, not a prompt line: the inventory is the enforcement.
    { name: 'generate_image', description: 'Draw the picture a draft asked for, from the art direction already on its card. Use it whenever the human asks you to generate, regenerate, redraw or replace a post\'s image — name the cards by letter. If they want a DIFFERENT picture rather than another take on the same one, call revise_posts with a new imageBrief first (that redraws on its own); this tool re-runs the brief the card already carries. It draws on the room designer\'s image key and the project\'s brand palette, and nothing publishes — the picture lands on the card for the human to approve.', schema: {
      letters: z.array(z.string()).min(1).max(4).describe('card letters to draw, e.g. ["a","c"] — at most 4 per call'),
    }, run: async (input: { letters: string[] }) => {
      const here2 = await draftsHere();
      if (!here2) return 'generate_image works on the drafts in a thread — open the conversation or task that has them.';
      if (!here2.posts.length) return 'There are no drafts here to draw for — draft_posts first.';
      const byLetter = new Map(here2.posts.map((p) => [p.letter, p]));
      const lines: string[] = [];
      const missed: string[] = [];
      for (const raw of input.letters) {
        const target = byLetter.get(raw.trim().toLowerCase());
        // only a DRAFT can be redrawn — generateDraftImage enforces it too, but naming the
        // letter here is what lets the reply be honest about which card was left alone
        if (!target || target.status !== 'draft') { missed.push(raw); continue; }
        lines.push(`${target.letter}: ${await generateDraftImage(agent, ch, target.id)}`);
      }
      if (!lines.length) return `Nothing to draw (${missed.join(', ') || 'no matching cards'}) — a picture can only be drawn for a draft that is still a draft.`;
      log?.({ kind: 'tool', phase: 'call', summary: `generate_image — ${input.letters.join('/')}` });
      return `${lines.join('\n')}${missed.length ? `\nLeft alone: ${missed.join(', ')} (not drafts here).` : ''}\n\nEach line above is the OUTCOME for that card — report failures plainly rather than claiming a picture that isn't there. Do not describe the image; the human can see it.`;
    } },
    { name: 'schedule_posts', description: 'Propose a publish schedule for the draft posts in THIS conversation (or content task). Use when the human asks to schedule / re-time / move posts. It posts a CONFIRMATION CARD listing each post and its proposed slot — the human approves it there, which is what actually schedules them (you can never publish or schedule on your own; the card is the gate). Pass per-post ISO times when the human named them; omit `items` to schedule ALL of them (each keeps its already-proposed slot, else a sensible daily cadence). Works for both first-time scheduling and rescheduling an already-scheduled post to a new time.', schema: {
      items: z.array(z.object({
        letter: z.string().describe('the post letter from its draft card: a, b, c…'),
        at: z.string().optional().describe('ISO 8601 publish time, e.g. 2026-07-28T09:00:00Z — omit to keep its proposed slot'),
      })).optional().describe('specific posts + times; omit entirely to propose slots for EVERY post here'),
    }, run: async (input: { items?: Array<{ letter: string; at?: string }> }) => {
      const here = await draftsHere(['draft', 'scheduled']);
      if (!here) return 'schedule_posts works on the drafts in a thread — open the conversation or task that has them.';
      if (!here.posts.length) return 'There are no unpublished draft posts here to schedule.';
      const lettered = here.posts;
      const asked = new Map((input.items ?? []).map((x) => [x.letter.toLowerCase(), x.at]));
      const targets = input.items?.length ? lettered.filter((p) => asked.has(p.letter)) : lettered;
      if (!targets.length) return `None of those letters match the posts here (they are ${lettered.map((p) => p.letter).join(', ')}).`;
      const nine = new Date(); nine.setDate(nine.getDate() + 1); nine.setHours(9, 0, 0, 0);
      const cardItems = targets.map((p, i) => ({
        item: p.id, letter: p.letter, platform: p.platform,
        slot: asked.get(p.letter) || p.scheduled_at || new Date(nine.getTime() + i * 86_400_000).toISOString(),
        preview: p.body.slice(0, 60),
      }));
      await post('/v1/messages', actor, { workspace: ch.workspace_id, channel: ch.id, ...here.msgAnchor, body: buildScheduleCard('schedule', cardItems, `Schedule ${cardItems.length} post${cardItems.length === 1 ? '' : 's'}${thread ? ` for #${thread.number}` : ''}?`) }).catch(() => {});
      return `Proposed slots for ${cardItems.length} post${cardItems.length === 1 ? '' : 's'} — the human confirms on the card to schedule them. Keep your reply to one short line.`;
    } },
    { name: 'unschedule_posts', description: 'Propose pulling one or more SCHEDULED posts here back out of the publish queue — use when the human asks to unschedule / hold / cancel specific posts. Posts a confirmation card; the human\'s click unschedules them (back to draft), never publishing anything. Name the posts by their letters.', schema: {
      letters: z.array(z.string()).describe('post letters to unschedule, e.g. ["a","c"]'),
    }, run: async (input: { letters: string[] }) => {
      const here = await draftsHere();
      if (!here) return 'unschedule_posts works on the drafts in a thread — open the conversation or task that has them.';
      const want = new Set(input.letters.map((l) => l.trim().toLowerCase()));
      const targets = here.posts.filter((p) => want.has(p.letter) && p.status === 'scheduled');
      if (!targets.length) return 'None of those posts are currently scheduled, so there\'s nothing to unschedule.';
      const cardItems = targets.map((p) => ({ item: p.id, letter: p.letter, platform: p.platform, preview: p.body.slice(0, 60) }));
      await post('/v1/messages', actor, { workspace: ch.workspace_id, channel: ch.id, ...here.msgAnchor, body: buildScheduleCard('unschedule', cardItems, `Unschedule ${cardItems.length} post${cardItems.length === 1 ? '' : 's'}${thread ? ` from #${thread.number}` : ''}?`) }).catch(() => {});
      return `Proposed unscheduling ${cardItems.length} post${cardItems.length === 1 ? '' : 's'} — the human confirms on the card. One short line back.`;
    } },
  ];
}
