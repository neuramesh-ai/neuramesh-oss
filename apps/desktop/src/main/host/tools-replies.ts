// The REPLY tools (docs/design/reply-radar-2026-08) — handing over conversations worth joining.
//
// Split from tools-content.ts because they are a different trade: a post is something you
// publish, a reply is something you go and say somewhere else. The card carries the target and
// the draft on one row, and v1 publishes nothing — the human opens the post and replies by hand.
//
// Why tools at all (the draft_posts lesson): an agent asked for "reply drafts" with only
// draft_posts in its inventory will use draft_posts, and the drafts land in the standalone-post
// preview with a schedule button that would post them as their own tweets. A tool inventory
// beats a prompt rule, every time.
import { REPLIES_CAP, applyReplyRevision, parseReplies, type NmReply } from '@neuramesh/shared';
import { postReplyCard, replyCardBody } from './replycard';
import type { OrchTool, ToolCtx } from './orchtools';

/** the card this thread already has: its message id + parsed block (the revise target) */
async function cardHere(tc: ToolCtx): Promise<{ id: string; data: NmReply } | null> {
  const { db, thread, convoThreadId } = tc;
  const rows = thread
    ? await db.getAll<{ id: string; body: string }>(
      `select id, body from messages where task_id = ? and body like '%nmreply%' order by created_at desc limit 1`, [thread.id]).catch(() => [])
    : convoThreadId
      ? await db.getAll<{ id: string; body: string }>(
        `select id, body from messages where thread_id = ? and body like '%nmreply%' order by created_at desc limit 1`, [convoThreadId]).catch(() => [])
      : [];
  const row = rows[0];
  if (!row) return null;
  const data = parseReplies(row.body);
  return data ? { id: row.id, data } : null;
}

export function replyTools(tc: ToolCtx): OrchTool[] {
  const { z, post, ch, agent, actor, thread, convoThreadId, log, generateShareImage } = tc;
  const anchor = () => (thread ? { taskId: thread.id } : convoThreadId ? { threadId: convoThreadId } : null);

  /** draw one reply's picture and attach it to the card's own message — never base64 in the fence */
  const drawFor = async (messageId: string, letter: string, brief: string): Promise<{ artifactId?: string; error?: string }> => {
    const g = await generateShareImage(agent, ch, brief).catch(() => ({ error: 'the generator crashed' }));
    if (!('thumb' in g) || !g.thumb) return { error: ('error' in g ? g.error : null) ?? 'the image came back empty' };
    const mime = /^data:([^;]+);/.exec(g.thumb)?.[1] ?? 'image/png';
    const ext = mime.split('/')[1] === 'jpeg' ? 'jpg' : (mime.split('/')[1] ?? 'png');
    const b64 = g.thumb.split(',')[1] ?? '';
    const id = crypto.randomUUID();
    const ok = await post('/v1/artifacts', actor, {
      id, workspace: ch.workspace_id, channel: ch.id, messageId,
      ...(thread ? { taskId: thread.id } : {}),
      kind: 'file', name: `reply-${letter.toLowerCase()}.${ext}`, mime, inlineContent: g.thumb, sizeBytes: Math.floor(b64.length * 0.75),
    }).catch(() => null);
    return ok?.ok ? { artifactId: id } : { error: 'the image generated but could not be saved' };
  };

  return [
    { name: 'draft_replies', description: 'Hand over REPLY OPPORTUNITIES as one card here — each row carries the post being answered (author, link, its text, its reach) AND your drafted reply. Use it for every "what should we reply to" ask, on any network. NEVER draft_posts for replies: that card schedules the text as its own post and shows nothing of the conversation. Only a target you actually found and can link; numbers you did not measure ⇒ source:"web" and no metrics.', schema: {
      report: z.string().max(200).optional().describe('the report these came from, e.g. engage-report-2026-08-22.md'),
      baseline: z.string().max(200).optional().describe('one honest line on the brand\'s own reach, e.g. "your recent posts reached 1–12 impressions"'),
      replies: z.array(z.object({
        target: z.object({
          platform: z.enum(['x', 'linkedin', 'instagram', 'tiktok']).describe('the network this conversation is on'),
          source: z.enum(['connector', 'web']).describe('"connector" = the room\'s connected account (real metrics); "web" = public research (NO numbers allowed)'),
          handle: z.string().min(1).max(40).describe('the author\'s handle, without the @'),
          name: z.string().max(60).optional(),
          url: z.string().min(8).max(500).describe('the real permalink — never constructed'),
          age: z.string().max(12).optional().describe('short age label, e.g. 14h or 2d'),
          text: z.string().min(1).max(2000).describe('the post being answered, verbatim'),
          metrics: z.object({
            impressions: z.number().optional(), likes: z.number().optional(), reposts: z.number().optional(), replies: z.number().optional(),
          }).optional().describe('source:"connector" only — real numbers the read returned'),
        }),
        draft: z.string().min(1).max(1000).describe('the reply exactly as it would post — platform-native, adds something the thread lacks, never a pitch'),
        why: z.string().max(160).optional().describe('one line: why this conversation is worth joining'),
        imageBrief: z.string().max(2000).optional().describe('art direction — only when a picture genuinely helps; drawn and attached for download'),
      })).min(1).max(REPLIES_CAP).describe('the targets, best first'),
    }, run: async (input: { report?: string; baseline?: string; replies: unknown[] }) => {
      const out = await postReplyCard({ post, actor, ch, anchor: anchor(), draw: drawFor }, input);
      log?.({ kind: 'tool', phase: 'call', summary: `draft_replies — ${input.replies.length} target${input.replies.length === 1 ? '' : 's'}` });
      return out;
    } },

    { name: 'revise_replies', description: 'Rewrite reply drafts ALREADY on the card here, in place, by letter — use it whenever the human asks to change one ("tighten B", "warmer on A", "give C an image"). The row keeps its letter and target; draft_replies again would post a second card beside the first. `imageBrief` draws (or redraws) that reply\'s picture, attached for the human to download.', schema: {
      revisions: z.array(z.object({
        letter: z.string().min(1).max(2).describe('the row letter: A, B, C…'),
        draft: z.string().max(1000).optional().describe('the replacement reply text, in full'),
        imageBrief: z.string().max(2000).optional().describe('art direction — draws (or redraws) this reply\'s picture'),
      })).min(1).max(REPLIES_CAP),
    }, run: async (input: { revisions: Array<{ letter: string; draft?: string; imageBrief?: string }> }) => {
      const card = await cardHere(tc);
      if (!card) return 'There is no reply card in this thread to revise — draft_replies first.';
      let items = card.data.items;
      const missed: string[] = [];
      const drew: string[] = [];
      // a draw that FAILED must not leave a brief on the row (it would claim a picture that is
      // not there) and must not be swallowed — the caller has to be able to say so out loud.
      // Caught live 2026-08-22: the tool reported "updated in place" after a failed draw and
      // the orchestrator told the human their reply now had an image.
      const failed: string[] = [];
      for (const rev of input.revisions) {
        const letter = rev.letter.trim()[0]?.toUpperCase() ?? '';
        let imageArtifactId: string | undefined;
        let drawError: string | undefined;
        if (rev.imageBrief?.trim() && items.some((i) => i.letter === letter)) {
          const r = await drawFor(card.id, letter, rev.imageBrief);
          if (r.artifactId) { imageArtifactId = r.artifactId; drew.push(letter); }
          else drawError = r.error ?? 'the image could not be drawn';
        }
        const next = applyReplyRevision(items, { letter, ...(rev.draft ? { draft: rev.draft } : {}), ...(imageArtifactId ? { imageArtifactId } : {}), ...(rev.imageBrief && !drawError ? { imageBrief: rev.imageBrief } : {}) });
        if (drawError) failed.push(`${letter}: ${drawError}`);
        if (next) items = next; else missed.push(rev.letter);
      }
      if (failed.length && items === card.data.items) {
        return `No picture was drawn — ${failed.join('; ')}. Tell the human plainly that the image failed and why; never say a reply has an image it does not have.`;
      }
      if (items === card.data.items) return `No row matched ${missed.join('/')} — the card's rows are ${card.data.items.map((i) => i.letter).join('/')}.`;
      const res = await post('/v1/commands', actor, {
        type: 'message.revise_card', message: card.id, body: replyCardBody({ ...card.data, items }),
      }).catch(() => null);
      if (!res?.ok) return 'The revision could not be saved to the card — say so rather than pasting the new text.';
      log?.({ kind: 'tool', phase: 'call', summary: `revise_replies — ${input.revisions.map((r) => r.letter).join('/')}` });
      return `The card is updated in place${drew.length ? ` (drew a picture for ${drew.join('/')})` : ''}${failed.length ? `. NO PICTURE for ${failed.join('; ')} — say that plainly and never claim an image that does not exist` : ''}${missed.length ? `; no row matched ${missed.join('/')}` : ''}. One short line on what changed — never repeat the reply text.`;
    } },
  ];
}
