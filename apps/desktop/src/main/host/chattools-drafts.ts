// THE DRAFTS ON SCREEN, READ BACK (2026-09-19, George: "we need to support the ability for a user
// to refine the video script before generation"). The card's ↩ arms the composer with "↩ Re draft
// b: …", and the agent answers with revise_posts, "the replacement script, in full". But a
// conversation's transcript is messages, and a draft is a content row: the agent that was asked to
// tighten b's hook had never seen b's script (its own draft_posts call is not in the transcript),
// so it rewrote from memory and dropped the beats the human liked. A prompt line ("read it first")
// would lose the way every prompt line loses (host/grounding.ts). So: a tool that reads the cards,
// and a gate on revise_posts that refuses to rewrite a card's text this turn has not read.
import type { AttDbLike } from '../agents';
import type { Grounding } from './grounding';
import type { OrchTool } from './orchtools';
import type { ChatToolCtx } from './chattools';

type DraftRow = { id: string; platform: string; body: string; status: string; media: string | null };
export type DraftView = { letter: string; platform: string; status: string; caption: string; script: string | null; brief: string | null; frame: string | null; seconds: number | null; film: string };

/** the drafts a thread holds, lettered the way their cards are (created order, before any status filter) */
export async function readDrafts(db: AttDbLike, at: { threadId?: string | null; taskId?: string | null }): Promise<DraftView[]> {
  const anchor = at.taskId ? { col: 'task_id', id: at.taskId } : at.threadId ? { col: 'thread_id', id: at.threadId } : null;
  if (!anchor) return [];
  const rows = await db.getAll<DraftRow>(`select id, platform, body, status, media from content_items where ${anchor.col} = ? order by created_at asc`, [anchor.id]).catch(() => [] as DraftRow[]);
  return rows.map((r, i) => {
    const m = ((): { brief?: string; script?: string; frame?: string; seconds?: number; video_id?: string; video_pending?: boolean; video_error?: string; video?: { model?: string; seconds?: number } } => { try { return JSON.parse(r.media ?? '{}') as never; } catch { return {}; } })();
    const film = m.video_pending ? 'filming now' : m.video_id ? `filmed${m.video?.seconds ? `, ${m.video.seconds} s` : ''}${m.video?.model ? ` on ${m.video.model}` : ''}` : m.video_error ? `no film: ${m.video_error}` : 'not filmed yet';
    return { letter: String.fromCharCode(97 + i), platform: r.platform, status: r.status, caption: r.body, script: m.script ?? null, brief: m.brief ?? null, frame: m.frame ?? null, seconds: m.seconds ?? null, film };
  });
}

/** the drafts as the agent reads them: every field a revision can replace, by letter */
export function draftsText(drafts: DraftView[]): string {
  if (!drafts.length) return 'there are no drafts in this conversation yet';
  return drafts.map((d) => [
    `${d.letter}) [${d.platform}] ${d.status}${d.script ? ` · video post · length ${d.seconds ?? 8} s · ${d.film}` : ''}${d.frame ? ` · frame ${d.frame}` : ''}`,
    `caption: ${d.caption}`,
    d.brief ? `${d.script ? 'shot direction' : 'image brief'}: ${d.brief}` : '',
    d.script ? `script:\n${d.script}` : '',
  ].filter(Boolean).join('\n')).join('\n\n');
}

/** the gate revise_posts asks before it rewrites a card's text: null when this turn read that card, else the refusal */
export function unreadRevision(grounding: Grounding, letter: string, r: { body?: string; script?: string }): string | null {
  if (!r.body && !r.script) return null; // a frame, a brief or a length alone starts from nothing on the card
  if (grounding.drafts.has(letter)) return null;
  return `Not yet: read draft ${letter} before you rewrite it. Call read_drafts, then revise_posts with the ${r.script ? 'script' : 'text'} changed from what is on the card, in full. A rewrite from memory drops what the human kept.`;
}

const READ_DESC = 'Read the drafts on screen in this conversation, by card letter: the caption, the script and its length, the shot direction, the frame, and whether a film is on the card. Call it BEFORE revise_posts, whenever the human asks to change a draft (a "↩ Re draft b:" message is exactly that): the rewrite starts from what the card holds, not from memory.';

/** the conversation registry's read (host/chattools.ts spreads it) */
export function draftsChatTools(t: Pick<ChatToolCtx, 'tool' | 'text' | 'db' | 'threadId' | 'log'>, grounding: Grounding) {
  const { tool, text, db, threadId, log } = t;
  return [
    tool('read_drafts', READ_DESC, {}, async () => {
      const drafts = await readDrafts(db, { threadId });
      for (const d of drafts) grounding.drafts.add(d.letter);
      log({ kind: 'tool', phase: 'call', summary: `read_drafts — ${drafts.length} draft${drafts.length === 1 ? '' : 's'}` });
      return text(draftsText(drafts));
    }),
  ];
}

/** the orchestrator registry's read (host/tools-content.ts spreads it) */
export function draftsOrchTools(db: AttDbLike, at: () => { taskId?: string | null; threadId?: string | null }, grounding: Grounding, log?: (e: { kind: 'tool'; phase: 'call'; summary: string }) => void): OrchTool[] {
  return [{ name: 'read_drafts', description: READ_DESC, schema: {}, run: async () => {
    const drafts = await readDrafts(db, at());
    for (const d of drafts) grounding.drafts.add(d.letter);
    log?.({ kind: 'tool', phase: 'call', summary: `read_drafts — ${drafts.length} draft${drafts.length === 1 ? '' : 's'}` });
    return draftsText(drafts);
  } }];
}
