import { drawOutcomeText } from './drawdraft';
import { deliverImages } from './deliver-images';
// The conversation's DELIVERY tools (article round): an article as its card, images as
// attachments the human can expand and download. Split from chattools.ts when the two tools
// tipped it past the size gate — same ctx, same rules: the tool inventory is what makes "show
// me / write me" answerable with something clickable instead of prose.
import type { ChatToolCtx } from './chattools';

export function shareChatTools(t: Pick<ChatToolCtx, 'z' | 'tool' | 'text' | 'agent' | 'ch' | 'threadId' | 'log' | 'post' | 'generateShareImage' | 'generateDraftImage' | 'draftsForAnchor'>) {
  const { z, tool, text, agent, ch, threadId, log, generateDraftImage, draftsForAnchor } = t;
  return [
    // the chat half of the orchestrator's generate_image — same function, same rules. A
    // conversation is where "regenerate that picture" is actually said.
    tool(
      'generate_image',
      'Draw the picture a draft asked for, from the art direction already on its card. Use it whenever the human asks you to generate, regenerate, redraw or replace a post\'s image — name the cards by letter. If they want a DIFFERENT picture rather than another take on the same one, call revise_posts with a new imageBrief (that redraws on its own). Nothing publishes: the picture lands on the card for the human to approve.',
      { letters: z.array(z.string()).min(1).max(4).describe('card letters to draw, e.g. ["a","c"] — at most 4 per call') },
      async (i) => {
        const here = await draftsForAnchor(null, threadId);
        if (!here?.posts.length) return text('there are no drafts in this conversation to draw for — draft_posts first');
        const byLetter = new Map(here.posts.map((p) => [p.letter, p]));
        const lines: string[] = [];
        const missed: string[] = [];
        for (const raw of i.letters as string[]) {
          const target = byLetter.get(raw.trim().toLowerCase());
          if (!target || target.status !== 'draft') { missed.push(raw); continue; }
          lines.push(`${target.letter}: ${drawOutcomeText(await generateDraftImage(agent, ch, target.id).catch((error) => ({ ok: false, error: error instanceof Error ? error.message : 'Image generation failed.' })))}`);
        }
        if (!lines.length) return text(`nothing to draw (${missed.join(', ') || 'no matching cards'}) — a picture can only be drawn for a draft that is still a draft`);
        log({ kind: 'tool', phase: 'call', summary: `generate_image — ${(i.letters as string[]).join('/')}` });
        return text(`${lines.join('\n')}${missed.length ? `\nLeft alone: ${missed.join(', ')} (not drafts here).` : ''}\n\nEach line is the OUTCOME for that card — report failures plainly rather than claiming a picture that isn't there. Do not describe the image; the human can see it.`);
      },
    ),

    // ── Deliver an ARTICLE: a doc artifact + the ‹article:id› card ──────────────────────────
    articleChatTool(t),
    // ── SHOW images: generate → message attachments (preview · expand · download) ────────────
    imagesChatTool(t),
  ];
}

/** The same article delivery tool is available to coding runtimes. */
export function articleChatTool(t: Pick<ChatToolCtx, 'z' | 'tool' | 'text' | 'agent' | 'ch' | 'threadId' | 'log' | 'post'>) {
  const { z, tool, text, agent, ch, threadId, log, post } = t;
  return tool(
      'draft_article',
      'Deliver an ARTICLE or long-form research write-up as a reviewable ARTICLE CARD in this conversation — the reader opens it in a reading tab, saves it to Workspace Files, or downloads it. Use it whenever the ask is an article, essay, report or research write-up (a post is draft_posts). Markdown is the WHOLE piece: start with a single `# Title`, then the dek paragraph; end citable work with a `## Sources` section of numbered links. NEVER paste the article into your reply — the card is the delivery.',
      {
        title: z.string().min(1).max(200),
        markdown: z.string().min(50).max(200_000).describe('the complete article as markdown'),
      },
      async (i) => {
        const md = /^#\s/m.test(i.markdown as string) ? (i.markdown as string) : `# ${i.title}\n\n${i.markdown}`;
        const name = `${(i.title as string).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'article'}.md`;
        const res = await post('/v1/commands', { kind: 'agent', id: agent.id }, { type: 'artifact.create', channel: ch.id, kind: 'doc', name, inlineContent: md, mime: 'text/markdown' }).catch(() => null);
        const artifactId = res?.ok ? ((await res.json().catch(() => null)) as { artifactId?: string } | null)?.artifactId : null;
        if (!artifactId) return text('the article could not be saved — say so plainly rather than pasting it into your reply');
        const posted = await post('/v1/messages', { kind: 'agent', id: agent.id }, { workspace: ch.workspace_id, channel: ch.id, threadId, body: `‹article:${artifactId}›` }).catch(() => null);
        log({ kind: 'tool', phase: 'call', summary: `draft_article — ${name}` });
        if (!posted?.ok) return text('the article saved but its card did not post — mention it exists in Files');
        return text('the article is delivered as a card in this conversation — the human opens, saves or downloads it there. Do NOT repeat the article in your reply: one short line on the angle you took.');
      },
    );
}

export function imagesChatTool(t: Pick<ChatToolCtx, 'z' | 'tool' | 'text' | 'agent' | 'ch' | 'threadId' | 'log' | 'post' | 'generateShareImage'>) {
  const { z, tool, text, agent, ch, threadId, log, post, generateShareImage } = t;
  return tool(
      'share_images',
      'Generate one or more images and SHOW them in this conversation as image attachments — previews inline, expandable, downloadable. Use it whenever the human asks you to generate/create/show a picture, cover, illustration or visual that is NOT attached to a drafted post (a post\'s picture rides its card via imageBrief/generate_image). Each brief is full art direction: subject, composition, light, mood, on-brand look. NEVER claim an image exists without calling this — if the call fails, report the failure.',
      {
        images: z.array(z.object({
          brief: z.string().min(8).max(2000),
          name: z.string().max(80).optional().describe('a short kebab-case filename, e.g. x-article-cover'),
        })).min(1).max(4),
        caption: z.string().max(500).optional(),
      },
      async (i) => {
        const input = i as { images: Array<{ brief: string; name?: string }>; caption?: string };
        const result = await deliverImages({ post, actor: { kind: 'agent', id: agent.id }, agentName: agent.name, channel: ch, anchor: { threadId },
          generate: brief => generateShareImage(agent, ch, brief) }, input);
        log({ kind: 'tool', phase: 'call', summary: `share_images — ${result.attached}/${input.images.length}` });
        if (result.error) return text(result.error);
        return text(`${result.attached} image${result.attached === 1 ? ' is' : 's are'} now SHOWING in the conversation${result.failed.length ? ` (${result.failed.length} failed: ${result.failed[0]})` : ''}. The original is saved; one short line at most.`);
      },
    );
}
