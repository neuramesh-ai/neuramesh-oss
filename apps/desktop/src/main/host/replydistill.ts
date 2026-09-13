// The reply-card guarantee (docs/design/reply-radar-2026-08, found live 2026-08-26): the engage
// playbook's real deliverable is the ```nmreply card, but the worker handing its drafts to
// `draft_replies` is a prompt rule — production ran the radar and the drafted replies never left
// the report (a v0.119.0 tool-layer failure ate the call, and nothing noticed). The finish lane
// now closes the gap the way it already does for next steps: when a deliversReplies run settles
// with a report but NO card born of this run, the host extracts the kept targets + drafts from
// the report (the nextstepsflow idiom — one bare complete(), shape-guarded by cleanReplies,
// never a tool loop) and posts through the ONE writer. The worker's own draft_replies stays the
// happy path (richer rows, the image lane); this lane fires only when it didn't.
import { REPLIES_CAP } from '@neuramesh/shared';
import { postReplyCard } from './replycard';

type ReplicaGet = { get: <T>(sql: string, params?: unknown[]) => Promise<T | undefined | null> };
type Actor = { kind: string; id: string; role?: string };
type Post = (path: string, actor: Actor, body: unknown) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> } | null>;
type CompleteFn = (system: string, user: string, token: string, model: string, maxTokens?: number) => Promise<string>;

const EXTRACT_SYSTEM =
  'You read a reply-radar report and extract its kept targets with their drafted replies as JSON. ' +
  'Output ONLY a JSON object (no prose, no fences): {"baseline": string (the brand\'s own reach line, e.g. ' +
  '"@brand: 7 recent X posts, 2–7 impressions each" — omit if the report states none), "replies": [{' +
  '"target": {"handle": string (with @), "name": string (omit if unstated), "url": string (the post\'s permalink), ' +
  '"platform": "x"|"linkedin"|"instagram"|"tiktok", "source": "connector"|"web", "age": string (e.g. "14h", "2d" — omit if unstated), ' +
  '"text": string (the target post\'s own words as the report quotes them), ' +
  '"metrics": {"impressions": number, "likes": number, "reposts": number, "replies": number}}, ' +
  '"draft": string (the reply exactly as the report drafted it), "why": string (<=140 chars, the report\'s own reason)}]}. ' +
  `Up to ${REPLIES_CAP} rows, in the report's own ranking. ` +
  'source is "connector" ONLY where the report says the numbers were measured through a connected read; a target found by ' +
  'public web research is "web" and carries NO metrics. Include metrics only with numbers the report itself states — ' +
  'NEVER invent or estimate one. Drop any row missing a real permalink, the post\'s text, or a drafted reply. ' +
  'If the report contains no drafted replies, output {"replies": []}.';

/**
 * Post the ```nmreply card distilled from the run's report — IF no card of this run exists.
 * Best-effort like the next-steps distill: a failed extraction costs the card, never the finish.
 */
export async function distillReplyCard(
  db: ReplicaGet, post: Post, complete: CompleteFn,
  model: string, token: string, voice: Actor,
  report: { name: string; content: string },
  ch: { id: string; workspace_id: string },
  taskId: string,
  anchor: { taskId: string } | { threadId: string },
): Promise<void> {
  try {
    // "born of this run" = any nmreply on the unit's thread OR its origin conversation since
    // the task existed — the worker's happy-path card rides the task anchor, so a report-name
    // match (the nmnext dedupe) would miss it whenever the model omitted the report field
    const threadId = 'threadId' in anchor ? anchor.threadId : taskId;
    const dupe = await db.get<{ id: string }>(
      `select id from messages where (task_id = ? or thread_id = ?) and body like '%nmreply%'
        and created_at >= (select created_at from tasks where id = ?) limit 1`,
      [taskId, threadId, taskId],
    ).catch(() => null);
    if (dupe) return;
    const raw = (await complete(EXTRACT_SYSTEM, report.content.slice(0, 24_000), token, model, 8000)).trim();
    const parsed = JSON.parse(raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')) as { baseline?: string; replies?: unknown[] };
    if (!Array.isArray(parsed.replies) || !parsed.replies.length) return;
    // no draw: a report carries no image briefs, and the fallback's job is the card, not art
    const said = await postReplyCard(
      { post, actor: voice, ch, anchor },
      { report: report.name, ...(parsed.baseline ? { baseline: parsed.baseline } : {}), replies: parsed.replies },
    );
    console.log(`replycard_distilled task=${taskId}: ${said.slice(0, 120)}`);
  } catch (err) {
    // the report already stands on its own — a failed distill costs the card, never the run
    console.warn(`replycard_distill skipped for ${report.name}:`, err instanceof Error ? err.message : err);
  }
}
