// THE ROUTINE'S REPLY CARD, GUARANTEED (docs/design/models-and-replies-2026-10/plan.md §1). George's
// routine "Tune X engagement routine query" (2026-10-02) posted its drafts as a markdown list: rex had
// draft_replies in that turn, but nothing in a routine run named it, and the NeuraMesh brain writes a
// tool call as text that the host then drops. A prompt rule cannot hold that, so the host checks after
// rex's turn: a session whose routine drafts replies, a reply that carries post links, and no card from
// this turn. Then the host extracts the rows from the reply (the replydistill idiom, one bare complete())
// and posts the card through the one writer. The reply keeps its opening words and points at the card,
// so the drafts never show twice.
import { cardPostedSince } from './replycard';
import { postDistilledCard } from './replydistill';

type Db = { get: <T>(sql: string, params?: unknown[]) => Promise<T | undefined | null> };
type Post = (path: string, actor: { kind: string; id: string; role?: string }, body: unknown) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> } | null>;
type Complete = (system: string, user: string, token: string, model: string, maxTokens?: number) => Promise<string>;
type TurnAgent = { id: string; role: string; model: string; runtime: string };

/** a post permalink: what a list of drafted replies carries, and a prose answer does not */
const POST_LINK = /https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/[^/\s)]+\/status\/\d+|https?:\/\/(?:www\.)?linkedin\.com\/(?:posts|feed)\//i;

/** does this session run a routine whose runs draft replies (a Replies gap, or a prompt about replies) */
export async function routineDeliversReplies(db: Db, threadId: string): Promise<boolean> {
  const row = await db.get<{ payload: unknown }>('select s.payload from threads t join schedules s on s.id = t.schedule_id where t.id = ?', [threadId]).catch(() => null);
  if (!row?.payload) return false;
  let p: { routine?: boolean; replyGap?: number; prompt?: string };
  try { p = (typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload) as typeof p; } catch { return false; }
  return !!p.routine && (!!p.replyGap || /\b(repl(?:y|ies)|respon(?:se|ses|d))\b/i.test(p.prompt ?? ''));
}

/** the reply's opening words, before its first list item or post link: what rex said above the drafts */
export function replyIntro(reply: string): string {
  const lines = reply.split('\n');
  const cut = lines.findIndex((l) => /^\s*(?:\d+[.)]|[-*•])\s/.test(l) || POST_LINK.test(l));
  return (cut < 0 ? reply : lines.slice(0, cut).join('\n')).trim();
}

/**
 * Run rex's turn, then make sure a routine's drafted replies landed as the card. Best-effort: a failed
 * extraction leaves the reply as rex wrote it, never fails the run.
 */
export async function routineReplyTurn<A extends unknown[]>(
  turn: (...a: A) => Promise<string>, args: A,
  deps: { db: Db; post: Post; runtimeFor: (runtime: string) => { complete: Complete } },
): Promise<string> {
  const started = Date.now();
  const reply = await turn(...args);
  const agent = args[0] as TurnAgent;
  const ch = args[1] as { id: string; workspace_id: string };
  const token = args[3] as string;
  const threadId = (args[8] as string | null | undefined) ?? null;
  try {
    if (!threadId || !POST_LINK.test(reply) || cardPostedSince(threadId, started)) return reply;
    if (!(await routineDeliversReplies(deps.db, threadId))) return reply;
    const landed = await deps.db.get<{ id: string }>(
      `select id from messages where thread_id = ? and body like '%nmreply%' and created_at >= ? limit 1`,
      [threadId, new Date(started).toISOString()],
    ).catch(() => null);
    if (landed) return reply;
    const voice = { kind: 'agent', id: agent.id, role: agent.role };
    const said = await postDistilledCard(deps.post, deps.runtimeFor(agent.runtime).complete, agent.model, token, voice,
      { name: 'this run', content: reply }, ch, { threadId });
    if (!said || !cardPostedSince(threadId, started)) return reply;
    console.log(`replycard_distilled routine thread=${threadId}: ${said.slice(0, 120)}`);
    const intro = replyIntro(reply);
    return `${intro ? `${intro}\n\n` : ''}The reply drafts are on the card above.`;
  } catch (err) {
    console.warn('routine reply card skipped:', err instanceof Error ? err.message : err);
    return reply;
  }
}
