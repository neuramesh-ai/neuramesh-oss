// ONE reply-card writer (docs/design/reply-radar-2026-08) — the orchestrator registry tool and
// the worker/leg bus closure both post through this, so a drafted reply can never mean two
// different things depending on which turn found it (the host/searchx.ts lesson).
//
// v1 publishes nothing: the card is a work-through list the human opens, copies and posts by
// hand. A drawn picture is attached to the card's own message and downloaded — never inlined in
// the fence (binary in a message body is how a transcript stops rendering).
import { cleanReplies, repliesBlock, type NmReply, type ReplyItem } from '@neuramesh/shared';

export interface ReplyCardDeps {
  post: (path: string, actor: { kind: string; id: string; role?: string }, body: unknown) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> } | null>;
  actor: { kind: string; id: string; role?: string };
  ch: { id: string; workspace_id: string };
  /** the anchor this card lands on — a task thread's card rides the TASK, a conversation's the THREAD */
  anchor: { taskId: string } | { threadId: string } | null;
  /** draw one picture and return its saved artifact id (the image lane); omit to refuse briefs */
  draw?: (messageId: string, letter: string, brief: string) => Promise<{ artifactId?: string; error?: string }>;
}

export interface ReplyCardInput { report?: string; baseline?: string; replies: unknown[] }

/** the prose above the fence — one line, so the card is what the eye lands on */
export function replyCardLead(n: number): string {
  return `${n} conversation${n === 1 ? '' : 's'} worth joining, ranked by reach and fit:`;
}

export function replyCardBody(data: NmReply): string {
  return `${replyCardLead(data.items.length)}\n\n${repliesBlock(data)}`;
}

/**
 * Post the card. Returns the agent-facing sentence — the tool's whole return value, phrased so
 * the model does NOT repeat the drafts in its reply (a card plus the same text in prose is the
 * duplicate-delivery bug draft_posts already fixed).
 */
export async function postReplyCard(deps: ReplyCardDeps, input: ReplyCardInput): Promise<string> {
  const { post, actor, ch, anchor, draw } = deps;
  if (!anchor) return 'draft_replies needs a thread to deliver into — reply inside the conversation and hand them over there.';
  const items = cleanReplies(input.replies.map((r, i) => ({ ...(r as object), letter: String.fromCharCode(65 + i) })));
  if (!items.length) return "None of those rows were usable: each needs a real permalink, the target post's own text, and a drafted reply.";
  const data: NmReply = {
    channel: ch.id, items,
    ...(input.report ? { report: input.report } : {}),
    ...(input.baseline ? { baseline: input.baseline } : {}),
  };
  const res = await post('/v1/messages', actor, { workspace: ch.workspace_id, channel: ch.id, ...anchor, body: replyCardBody(data) }).catch(() => null);
  const messageId = res?.ok ? ((await res.json().catch(() => null)) as { message?: { id?: string } } | null)?.message?.id : null;
  if (!messageId) return 'The card could not be posted — say so plainly rather than pasting the replies into your message.';
  // pictures are drawn AFTER the card exists so each attaches to the card's own message; a
  // failed draw costs its image, never the card
  const { drawn, failed } = draw ? await drawInto(draw, messageId, items, input.replies) : { drawn: 0, failed: [] as string[] };
  if (drawn) {
    await post('/v1/commands', actor, { type: 'message.revise_card', message: messageId, body: replyCardBody({ ...data, items }) }).catch(() => null);
  }
  const letters = items.map((i) => i.letter).join('/');
  // a failed draw is REPORTED, never swallowed — the caller must not tell the human a reply
  // carries a picture that was never made (caught live, 2026-08-22)
  return `${items.length} reply opportunit${items.length === 1 ? 'y is' : 'ies are'} on a card in this thread (${letters})${drawn ? `, ${drawn} with a drawn picture` : ''}${failed.length ? `. NO PICTURE for ${failed.join('; ')} — say that plainly rather than claiming an image exists` : ''} — the human opens each post and replies there. Do NOT repeat the drafts in your message: one short line on what you found and the pattern across the targets.`;
}

async function drawInto(
  draw: NonNullable<ReplyCardDeps['draw']>,
  messageId: string,
  items: ReplyItem[],
  raw: unknown[],
): Promise<{ drawn: number; failed: string[] }> {
  let drawn = 0;
  const failed: string[] = [];
  for (const [i, it] of items.entries()) {
    const brief = (raw[i] as { imageBrief?: string } | undefined)?.imageBrief?.trim();
    if (!brief) continue;
    const r = await draw(messageId, it.letter, brief);
    // the brief is only recorded WITH its picture: a brief on a pictureless row would render
    // as art direction for something that does not exist
    if (r.artifactId) { it.imageArtifactId = r.artifactId; it.imageBrief = brief; drawn += 1; }
    else failed.push(`${it.letter}: ${r.error ?? 'the image could not be drawn'}`);
  }
  return { drawn, failed };
}
