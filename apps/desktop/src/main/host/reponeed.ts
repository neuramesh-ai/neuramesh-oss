// THE GITHUB CARD, POSTED BY A TOOL (docs/design/repo-connect-2026-10). Work that needs the room's
// repository never starts blind: when nothing on this machine can read it, the tool that found out
// posts ONE card in the conversation (or the task's thread) and refuses the work. The card is the
// tools' (`needCard` on /v1/messages), so the server mints its Needs-you row, and the grant that
// connects GitHub resumes the work by itself (control-api github-resume.ts). Before this, rex said
// "point the human at Connections" in prose, and a deep investigation fanned out with no code.
import { GITHUB_NEED_PREFIX, needBlock } from '@neuramesh/shared';
import { repoSlugFor } from './gh';
import { ghLive, githubConnected, githubGrantable, primaryRepoRow } from './reporead';
import type { ApiGetFn } from './searchx';
export { CARD_UP } from './reporead';

type ReplicaDb = { getAll<T>(sql: string, params?: unknown[]): Promise<T[]> };
type ActorRef = { kind: string; id: string; role?: string };
type PostFn = (path: string, actor: ActorRef, body: unknown) => Promise<Response>;

/** where the card goes: a conversation, a task's thread, or the room's feed */
export interface NeedPlace { workspace: string; channel: string; threadId?: string | null; taskId?: string | null }
/** the words the card carries: what waits, why, the line above it, and who continues after the grant */
export interface NeedWords { ask: string; why: string; lead: string; after: string }

/** can this machine read the room's repository? the connector, or a GitHub repository and this machine's gh */
export async function repoReadable(db: ReplicaDb, channelId: string, capable: () => Promise<boolean> = ghLive): Promise<{ ok: boolean; repoName: string | null }> {
  if (await githubConnected(db, channelId)) return { ok: true, repoName: null };
  const repo = await primaryRepoRow(db, channelId);
  if (!repo) return { ok: false, repoName: null };
  const slug = await repoSlugFor(repo);
  return { ok: !!slug && !slug.startsWith('local/') && await capable(), repoName: repo.name };
}

// a card posted this minute is not in the replica yet: the memo covers the gap, the replica the rest
const posted = new Map<string, number>();
const MEMO_MS = 10 * 60_000;
const keyOf = (p: NeedPlace): string => `${p.channel}:${p.taskId ?? ''}:${p.threadId ?? ''}`;

/** is a GitHub card already open here? one card per conversation, or per task */
export async function needOpen(db: ReplicaDb, place: NeedPlace, now = Date.now()): Promise<boolean> {
  const at = posted.get(keyOf(place));
  if (at && now - at < MEMO_MS) return true;
  const like = `${GITHUB_NEED_PREFIX}%`;
  // a card is a row whose message holds the nmneed block: an agent's own question with the same
  // prefix keeps no real card down (the server's openGitHubNeeds reads it the same way)
  const rows = place.taskId
    ? await db.getAll<{ n: number }>(`select count(*) as n from decisions d join messages m on m.id = d.message_id
        where d.status = 'open' and d.task_id = ? and d.question like ? and instr(m.body, '\`\`\`nmneed') > 0`, [place.taskId, like]).catch(() => [])
    : await db.getAll<{ n: number }>(`select count(*) as n from decisions d join messages m on m.id = d.message_id
        where d.status = 'open' and d.channel_id = ? and d.task_id is null and m.thread_id is ? and d.question like ? and instr(m.body, '\`\`\`nmneed') > 0`, [place.channel, place.threadId ?? null, like]).catch(() => []);
  return Number(rows[0]?.n ?? 0) > 0;
}

/** post the card unless one is open here. True when a card is up, either way. With `get`, a server that
 *  cannot connect GitHub (a Local stack) gets no card, and the caller keeps its prose */
export async function postRepoNeed(deps: { db: ReplicaDb; post: PostFn; actor: ActorRef; get?: ApiGetFn }, place: NeedPlace, words: NeedWords): Promise<boolean> {
  if (await needOpen(deps.db, place)) return true;
  if (deps.get && !(await githubGrantable(deps.get, deps.actor, place.channel))) return false;
  const res = await deps.post('/v1/messages', deps.actor, {
    workspace: place.workspace, channel: place.channel,
    ...(place.taskId ? { taskId: place.taskId } : place.threadId ? { threadId: place.threadId } : {}),
    needCard: true,
    body: `${words.lead}\n\n${needBlock({ channel: place.channel, ask: words.ask, why: words.why, after: words.after, connect: ['github'] })}`,
  }).catch(() => null);
  if (!res?.ok) return false;
  posted.set(keyOf(place), Date.now());
  return true;
}

/** the words for a conversation whose read was refused: the thread's own title names what waits */
export async function conversationNeedWords(db: ReplicaDb, place: NeedPlace, agentName: string): Promise<NeedWords> {
  const repo = await primaryRepoRow(db, place.channel).catch(() => null);
  const title = place.threadId
    ? (await db.getAll<{ title: string | null }>(`select title from threads where id = ? limit 1`, [place.threadId]).catch(() => []))[0]?.title
    : null;
  return {
    ask: (title || 'This conversation').slice(0, 160),
    why: repo ? `This conversation reads the code in ${repo.name}. Nothing ran yet.` : 'This project has no repository yet. GitHub can attach one.',
    lead: repo ? `I need to read the code in ${repo.name} for this, and nothing here can read it yet.` : 'I need a repository to read for this, and this project has none yet.',
    after: `${agentName} continues here when GitHub is connected.`,
  };
}

export function resetNeedMemoForTest(): void { posted.clear(); }
