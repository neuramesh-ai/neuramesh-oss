// The next-steps distill (docs/design/marketing-os-2026-08 §13) — a finished playbook run's
// report, read by the model that just wrote it, handed over as armable items (every worthwhile
// recommendation up to the cap; the card pages at 5). The scheduleRecsBlock idiom: one bare
// complete() with a JSON-extraction prompt, shape-guarded in code (cleanNextItems), never a
// tool loop. The card posts in the COORDINATOR's voice into the thread that owns the run;
// every arm verb stays the human's click.
import { NEXT_STEPS_CAP, cleanNextItems, nextStepsBlock, type NmNext } from '@neuramesh/shared';

type ReplicaGet = { get: <T>(sql: string, params?: unknown[]) => Promise<T | undefined | null> };
type Actor = { kind: string; id: string; role?: string };
type Post = (path: string, actor: Actor, body: unknown) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;
type CompleteFn = (system: string, user: string, token: string, model: string, maxTokens?: number) => Promise<string>;

const EXTRACT_SYSTEM =
  'You read a marketing report and extract its actionable next steps as JSON. ' +
  `Extract EVERY step the report actually recommends, up to ${NEXT_STEPS_CAP} — do not summarize the list down; the reader pages through all of them. ` +
  'Output ONLY a JSON array (no prose, no fences), ordered by impact: ' +
  '[{"kind": "task"|"routine"|"research", "title": string (<=90 chars, imperative), ' +
  '"why": string (<=140 chars, from the report\'s own reasoning), ' +
  '"src": string (<=60 chars, the report section it came from, e.g. "Fix these first · #1"), ' +
  '"description": string (task only — enough for a worker to act without the report), ' +
  '"taskKind": "chore"|"feature"|"content"|"research" (task only; site/code changes are chore or feature), ' +
  '"cadence": "daily"|"weekdays"|"weekly", "weekday": 0-6, "atTime": "HH:MM", "prompt": string (routine only — the recurring instruction), ' +
  '"opener": string (research only — the question, written to open an investigation)]. ' +
  'kind rules: a change to the product, site or copy is a task; recurring work is a routine; an open question needing digging is research. ' +
  'BIAS: recurring work is a ROUTINE, not a task somebody re-does by hand. Tasks are the byproduct, never the default. ' +
  'EXCLUDE the run\'s own plumbing (2026-08-26, founder): a step that exists only to make THIS analysis work — connect an account, ' +
  'obtain access or credentials, re-run the search, produce an intermediate file, "generate the drafts from the candidates", ' +
  '"verify the targets are still live" — is NOT a next step. It is either a dependency the human resolves on a card, or something ' +
  'the run should have done itself. A next step is an OUTCOME the report argues for, valuable after this run is forgotten. ' +
  'EXCLUDE drafted replies (2026-08-26, founder): a reply to one specific post is NEVER a next step — reply opportunities ' +
  'ride their own card with the draft ready to copy, so a "Reply to @handle\'s post" task row is a worse duplicate of it. ' +
  'Only extract steps the report actually recommends. If it recommends none, output [].';

/** count the report's own recommendation bullets — the honesty denominator ("picked of N") */
function roughRecCount(md: string): number {
  const m = md.match(/^\s*(?:[-*]|\d+\.)\s+/gm);
  return Math.max(m?.length ? Math.min(m.length, 40) : 0, 0);
}

export async function distillNextSteps(
  db: ReplicaGet, post: Post, complete: CompleteFn,
  model: string, token: string, voice: Actor,
  report: { name: string; content: string },
  ch: { id: string; workspace_id: string },
  anchor: { taskId?: string; threadId?: string },
): Promise<void> {
  try {
    // one card per report per thread — a re-run's fresh dated report earns a fresh card
    const dupe = anchor.taskId
      ? await db.get<{ id: string }>(`select id from messages where task_id = ? and body like '%nmnext%' and body like ? limit 1`, [anchor.taskId, `%${report.name}%`]).catch(() => null)
      : await db.get<{ id: string }>(`select id from messages where thread_id = ? and body like '%nmnext%' and body like ? limit 1`, [anchor.threadId, `%${report.name}%`]).catch(() => null);
    if (dupe) return;
    // 40 items × ~80 tokens needs real headroom — a default cap truncates mid-array and the
    // JSON.parse throws, costing the whole card
    const raw = (await complete(EXTRACT_SYSTEM, report.content.slice(0, 24_000), token, model, 8000)).trim();
    const items = cleanNextItems(JSON.parse(raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')));
    if (!items.length) return;
    const data: NmNext = {
      report: report.name, channel: ch.id, anchor,
      picked: items.length, total: Math.max(roughRecCount(report.content), items.length), items,
    };
    const at = anchor.taskId ? { taskId: anchor.taskId } : { threadId: anchor.threadId };
    await post('/v1/messages', voice, {
      workspace: ch.workspace_id, channel: ch.id, ...at,
      body: `Here is what I would do with it. Arm what you like, each is one click:\n\n${nextStepsBlock(data)}`,
    });
  } catch (err) {
    // the report already stands on its own — a failed distill costs the card, never the run
    console.warn(`nextsteps_distill skipped for ${report.name}:`, err instanceof Error ? err.message : err);
  }
}
