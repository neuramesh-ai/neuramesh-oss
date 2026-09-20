// THE UGC PLAYBOOK IS A TWO-TURN FLOW (George, 2026-09-19, on the web app: "it should do some
// research on the product, provide nice options for the ugc videos in ui cards for me to select
// or provide an alternate angle, platform target, before generating the on-brand drafts").
//
//   1. research: the shelf is read (the grounding gate already makes that so);
//   2. the angle card: `propose_angles` posts ONE question card whose options are the angles the
//      research produced, with "type your own" as the alternate, the room's platforms as chips
//      ("prepare for": connected accounts picked from the start, nothing is scheduled by a pick),
//      and the film's LENGTH as chips (video-rung plan §8: the lengths the workspace's tier films,
//      each priced, read from the door when it is served); the turn stops there;
//   3. the drafts: when the human's pick arrives, `draft_posts` writes one video post per picked
//      platform in the chosen angle, as the cards, each carrying the picked length.
//
// Enforced, not prompted: `draft_posts` with a script (a video post) refuses until this thread
// holds an answered angle card, and `propose_angles` refuses until the shelf was read. The agent
// keeps every judgment (which angles, what copy); it cannot skip the research or the pick. The
// length is read off the human's answer by code, never trusted to the model's retelling.
import type { AttDbLike } from '../agents';
import type { OrchTool, ToolCtx } from './orchtools';
import { filmCredits, type UgcCardData } from '@neuramesh/shared';
import { readBrand } from './brandnote';
import { ungrounded, type Grounding } from './grounding';

export const PLATFORM_LABELS: Record<UgcCardData['platforms'][number]['id'], string> = { x: 'X', linkedin: 'LinkedIn', instagram: 'Instagram', tiktok: 'TikTok' };
const PLATFORM_IDS = Object.keys(PLATFORM_LABELS) as Array<UgcCardData['platforms'][number]['id']>;

export interface AngleInput { product: string; angles: Array<{ title: string; why: string }> }

export type FilmLength = { seconds: number; credits: number };

/** the card's message body: a question whose options are the angles, with the platform row and the length row */
export function angleCard(input: AngleInput, connected: readonly string[], lengths: readonly FilmLength[] = []): string {
  const ugc: UgcCardData = {
    product: input.product,
    platforms: PLATFORM_IDS.map((id) => ({ id, label: PLATFORM_LABELS[id], connected: connected.includes(id) })),
    ...(lengths.length > 1 ? { lengths: [...lengths] } : {}), // one length is no choice: no row
  };
  const card = {
    question: `Which angle should the UGC scripts take for ${input.product}?`,
    options: input.angles.map((a) => ({ label: a.title, description: a.why })),
    allowOther: true,
    ugc,
  };
  return `\`\`\`nmq\n${JSON.stringify(card)}\n\`\`\``;
}

/** the answer's platforms, as the card wrote them ("… · platforms: x, linkedin · length: 15 s") */
export function pickedPlatforms(answer: string): string[] {
  const m = /platforms:\s*([a-z, ]+)/i.exec(answer.trim());
  if (!m) return [];
  return m[1]!.split(',').map((s) => s.trim().toLowerCase()).filter((s) => (PLATFORM_IDS as string[]).includes(s));
}
/** the answer's film length in seconds, as the card wrote it ("… · length: 15 s"); null when the answer names none */
export function pickedLength(answer: string | null | undefined): number | null {
  const m = /\blength:\s*(\d{1,3})\s*s\b/i.exec(answer ?? '');
  return m ? Number(m[1]) : null;
}

type Catalog = { served?: boolean; tier?: string | null; tiers?: Array<{ tier: string; lengths?: number[]; perSecondMicros?: number }> };
/** the lengths the workspace's tier films, priced, from the door (GET /v1/starter/video): empty when the
 *  lane is not served here (the local stack, no FAL_KEY), so the card shows no row and the default holds.
 *  The daemon's apiGet hands back the raw Response (host/searchx.ts reads it the same way); a fake may hand the body. */
export async function videoLengths(apiGet: (path: string, actor: { kind: string; id: string; role?: string }) => Promise<any>, actor: { kind: string; id: string; role?: string }, workspaceId: string): Promise<FilmLength[]> {
  const res = await apiGet(`/v1/starter/video?workspace=${encodeURIComponent(workspaceId)}`, actor).catch(() => null) as (Catalog & { ok?: boolean; json?: () => Promise<unknown> }) | null;
  const cat = (res && typeof res.json === 'function' ? (res.ok ? await res.json().catch(() => null) : null) : res) as Catalog | null;
  const active = cat?.served ? cat.tiers?.find((t) => t.tier === cat.tier) ?? cat.tiers?.[0] : null;
  if (!active?.lengths?.length || !active.perSecondMicros) return [];
  return active.lengths.map((seconds) => ({ seconds, credits: filmCredits(active.perSecondMicros!, seconds) }));
}

type MsgRow = { author_kind: string; body: string | null };
/** the conversation's messages, oldest first, by the anchor a tool has (a task thread, or a conversation thread) */
async function threadMessages(db: AttDbLike, at: { threadId?: string | null; taskId?: string | null }): Promise<MsgRow[]> {
  if (at.taskId) return db.getAll<MsgRow>('select author_kind, body from messages where task_id = ? order by created_at', [at.taskId]).catch(() => []);
  if (at.threadId) return db.getAll<MsgRow>('select author_kind, body from messages where thread_id = ? order by created_at', [at.threadId]).catch(() => []);
  return [];
}

const isAngleCard = (m: MsgRow): boolean => m.author_kind === 'agent' && !!m.body && m.body.includes('```nmq') && m.body.includes('"ugc"');

/**
 * The gate `draft_posts` asks before it writes a VIDEO post: null when the thread holds an angle
 * card the human answered, else the refusal that names the step that lifts it. A text post (no
 * script) never asks: the two-turn flow is the UGC playbook's, not every draft's.
 */
export async function unpicked(db: AttDbLike, at: { threadId?: string | null; taskId?: string | null }): Promise<string | null> {
  const msgs = await threadMessages(db, at);
  const last = msgs.map(isAngleCard).lastIndexOf(true);
  if (last < 0) return 'Not yet: a UGC run proposes its angles before it drafts. Read the brand docs, then call propose_angles with three to five angles from what the product does and stop. When the human picks one, draft.';
  const answered = msgs.slice(last + 1).some((m) => m.author_kind === 'human' && !!m.body?.trim());
  if (!answered) return 'The angle card is in the thread and the human has not picked yet. Stop here: their pick wakes you, and then you draft.';
  return null;
}

/** the human's answer to the thread's last angle card (their first message after it), or null */
export async function angleAnswer(db: AttDbLike, at: { threadId?: string | null; taskId?: string | null }): Promise<string | null> {
  const msgs = await threadMessages(db, at);
  const last = msgs.map(isAngleCard).lastIndexOf(true);
  if (last < 0) return null;
  return msgs.slice(last + 1).find((m) => m.author_kind === 'human' && !!m.body?.trim())?.body ?? null;
}

/** the length each video draft carries: the tool's own `seconds` when the human named one in the
 *  conversation, else the angle card's pick, read off the answer by code; a text post carries none */
export async function draftSeconds<P extends { script?: string; seconds?: number }>(db: AttDbLike, at: { threadId?: string | null; taskId?: string | null }, posts: P[]): Promise<Array<number | undefined>> {
  const picked = posts.some((p) => p.script) ? pickedLength(await angleAnswer(db, at)) : null;
  return posts.map((p) => (p.script ? p.seconds ?? picked ?? undefined : undefined));
}

/** what `propose_angles` asks before it posts: the shelf read (research first), and a real set of angles */
export async function angleGate(db: AttDbLike, channelId: string, grounding: Grounding, input: AngleInput): Promise<string | null> {
  const shelf = await ungrounded(db, channelId, grounding);
  if (shelf) return `Research first: ${shelf}`;
  if (input.angles.length < 2) return 'Give the human a real choice: two to five angles, each with the product fact it rests on.';
  return null;
}

/** the room's connected platforms, for the chips that come picked */
export async function connectedPlatforms(db: AttDbLike, channelId: string): Promise<string[]> {
  const b = await readBrand(db, channelId);
  return b.conns.map((c) => c.provider).filter((p) => (PLATFORM_IDS as string[]).includes(p));
}

/** the orchestrator registry's tool (tools-content.ts spreads it beside draft_posts) */
export function ugcOrchTools(tc: Pick<ToolCtx, 'z' | 'db' | 'post' | 'apiGet' | 'ch' | 'actor' | 'log' | 'grounding'>, msgAnchor: () => { taskId: string } | { threadId: string } | null): OrchTool[] {
  const { z, db, post, apiGet, ch, actor, log, grounding } = tc;
  return [
    { name: 'propose_angles', description: 'THE UGC PLAYBOOK, step two, after the research: post the ANGLE CARD in this conversation — two to five angles for the creator videos, each resting on a fact from the brand docs you just read, with "type your own" as the alternate and the room\'s platforms as chips (connected accounts come picked). Then STOP: the human\'s pick wakes you, and only then draft_posts, one video post per picked platform in the chosen angle. A creator script drafted before this card is answered is refused.', schema: {
      product: z.string().min(1).max(80).describe('the product name as the brand docs say it'),
      angles: z.array(z.object({
        title: z.string().min(1).max(60).describe('the angle, as a creator would pitch it, e.g. "The 2am spiral" or "Before and after"'),
        why: z.string().min(1).max(200).describe('the product fact from the shelf this angle rests on'),
      })).min(2).max(5),
    }, run: async (input: AngleInput) => {
      const gate = await angleGate(db, ch.id, grounding, input);
      if (gate) return gate;
      const anchor = msgAnchor();
      if (!anchor) return 'propose_angles needs a conversation to post into — reply inside the thread and propose there.';
      const [conns, lengths] = await Promise.all([connectedPlatforms(db, ch.id), videoLengths(apiGet, actor, ch.workspace_id)]);
      const posted = await post('/v1/messages', actor, { workspace: ch.workspace_id, channel: ch.id, ...anchor, body: angleCard(input, conns, lengths) }).catch(() => null);
      if (!posted?.ok) return 'the angle card could not be posted — say so plainly rather than listing the angles in your reply';
      log?.({ kind: 'tool', phase: 'call', summary: `propose_angles — ${input.angles.length} angles, platforms ${conns.join(', ') || 'none connected'}, lengths ${lengths.map((l) => l.seconds).join('/') || 'default'}` });
      return `Angle card posted with ${input.angles.length} angles. STOP here and say one line: the human picks on the card. Their pick wakes you; then call draft_posts with one video post per picked platform in that angle, the script written to the length they picked.`;
    } },
  ];
}
