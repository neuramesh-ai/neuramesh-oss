// Lean units (docs/41; marketing-os round 3 is the population — playbook runs): a plan that
// declares NO review leg finishes straight to the accept gate, the same command as a
// subtask's finish. Submitting one instead would invent a reviewer round its plan declared
// away. Split from flows.ts (the file cap): detection reads the replica, the finish is one
// command — each used at exactly one call site in the worker flow.
import { playbookById, playbookReportName, reportFrom } from '@neuramesh/shared';
import { distillNextSteps } from './nextstepsflow';
import { distillReplyCard } from './replydistill';
import { type LogFn } from '../agentlog';

type ReplicaGet = { get: <T>(sql: string, params?: unknown[]) => Promise<T | undefined | null> };
type Actor = { kind: string; id: string; role?: string };
type Post = (path: string, actor: Actor, body: unknown) => Promise<{ ok: boolean; status: number; text: () => Promise<string>; json: () => Promise<unknown> }>;
/** the finishing worker's own model + credential — the distill reads the report it just wrote */
export type DistillCreds = { complete: (system: string, user: string, token: string, model: string, maxTokens?: number) => Promise<string>; model: string; token: string };

/** the run's PRIMARY report: the markdown that parses as a scored report, else the sole markdown */
function pickReport(files: Array<{ name: string; content: string }>): { name: string; content: string } | null {
  const md = files.filter((f) => /\.md$/i.test(f.name));
  return md.find((f) => reportFrom(f.name, f.content)) ?? (md.length === 1 ? md[0]! : null);
}
type Deliverable = { kind: string; name: string; content: string };

/** the flow facts one task read answers: lean = a declared plan whose legs omit `review`;
 *  playbook = the run_playbook marker its description opens with (both lanes write it) */
export async function taskFlowMeta(db: ReplicaGet, taskId: string): Promise<{ lean: boolean; playbook: string | null }> {
  const row = await db.get<{ work_plan: string | null; description: string | null }>(
    'select work_plan, description from tasks where id = ?', [taskId],
  ).catch(() => null);
  let lean = false;
  try {
    const legs = (JSON.parse(row?.work_plan ?? 'null') as { legs?: string[] } | null)?.legs;
    lean = Array.isArray(legs) && legs.length > 0 && !legs.includes('review');
  } catch { /* an unreadable plan keeps the review road */ }
  const playbook = /^Playbook: ([a-z0-9]+) \(marketing-os\)/.exec(row?.description ?? '')?.[1] ?? null;
  return { lean, playbook };
}

/** a playbook deliverable's name IS its identity (`<id>-report-YYYY-MM-DD.md` — the trend and
 *  the room state match on it), and the preamble's naming rule is prose a model can ignore —
 *  the live run delivered COMPETITOR_TEARDOWN_FATHOM_SIMPLE_ANALYTICS.md. When the run leaves
 *  exactly one markdown deliverable, it takes the contract name here, structurally. */
export function contractDeliverables<T extends Deliverable>(files: T[], playbook: string | null): T[] {
  if (!playbook) return files;
  const md = files.filter((f) => /\.md$/i.test(f.name));
  const want = playbookReportName(playbook, new Date().toISOString());
  if (md.some((f) => f.name === want)) return files;
  // a sole markdown IS the report; among several (found live: GEO delivered audit + notes +
  // rewrites), the one carrying the scored-report head is — the shape is the identity, so
  // renaming it is reading, not guessing. Ambiguity (0 or 2+ scored) leaves names alone.
  const scored = md.length === 1 ? md : md.filter((f) => /^.+\n.*Score:\s*\d{1,3}\s*\/\s*100/m.test(f.content.slice(0, 400)));
  if (scored.length !== 1) return files;
  return files.map((f) => (f === scored[0] ? { ...f, name: want } : f));
}

/** finish the unit to the accept gate — deliverables stay on the unit (fsm.ts keeps them) */
export async function finishLeanUnit(
  db: ReplicaGet, post: Post, actor: Actor,
  t: { id: string; number: number; title: string }, ch: { id: string; workspace_id: string }, agentName: string,
  result: string, artifacts: Array<{ kind: string; name: string; content: string }>,
  fileCount: number, log: LogFn, distill?: DistillCreds, playbook?: string | null,
): Promise<void> {
  const finish = await post('/v1/commands', actor, {
    type: 'task.finish_subtask',
    taskId: t.id,
    note: result.slice(0, 1900),
    artifacts,
  });
  if (!finish.ok) throw new Error(`finish ${finish.status}: ${await finish.text()}`);
  console.log(`agent_finish_lean agent=${agentName} task=${t.number} ok`);
  log({ kind: 'exec', phase: 'submitted', summary: `finished #${t.number} to the accept gate — its plan declares no review${fileCount ? ` · ${fileCount} file(s)` : ''}` });
  // First-REGISTERED wins: an unordered pick grabbed a stale test clone in the dev DB — the
  // room's original coordinator is the stable voice. Ordered by the REGISTRATION row's
  // created_at, not the agent's: the client-side agents table doesn't declare created_at
  // (schema/crew.ts), so ordering on it errored on the replica and the catch silently fell
  // back to the worker's voice — the live #1117 card arrived signed by plume.
  const orch = await db.get<{ id: string }>(
    `select a.id from agents a join agent_channels ac on ac.agent_id = a.id
      where ac.channel_id = ? and a.role = 'orchestrator' and a.retired_at is null
      order by length(a.name) asc, a.name asc limit 1`, [ch.id],
  ).catch(() => null);
  const voice: Actor = orch ? { kind: 'agent', id: orch.id, role: 'orchestrator' } : actor;
  // ── the ACCEPTANCE CARD, in the unit's own thread (founder, rerun round) ──
  // `done` docks nothing by design — the verdict arrives as a transcript card — but a lean
  // unit has no reviewer round, so nobody ever posted one and the accept lived only in the
  // needs-you queue. The finish posts it deterministically: the same nmq shape rex's
  // request_verdict tool composes, so the human's click IS the accept, structurally. The
  // headline mirrors VerdictCard's own composition rule (label — title?), never re-worded.
  try {
    const named = artifacts.filter((a) => a.kind !== 'diff').slice(0, 8).map((a) => ({ name: a.name, kind: a.kind }));
    const card = {
      question: `Accept & close #${t.number} — ${t.title}?`,
      options: [{ label: `Accept & close #${t.number}` }, { label: 'Request changes' }],
      allowOther: true,
      verdict: {
        task: t.id, number: t.number, title: t.title, state: 'done',
        ...(named.length ? { artifacts: named } : {}),
        note: 'The playbook run finished — the deliverables below are what you are signing off.',
      },
    };
    await post('/v1/messages', voice, { workspace: ch.workspace_id, channel: ch.id, taskId: t.id, body: '```nmq\n' + JSON.stringify(card) + '\n```' });
  } catch { /* the finish stands; the card is best-effort */ }
  // ── round 3 rerun (founder): "the card flips to done, but rex's last word was 'underway'" ──
  // An anchored unit's origin CONVERSATION gets a completion note in the coordinator's voice,
  // deterministically — detection is code and the fact is the message, so no LLM turn is spent
  // saying one line. Best-effort: a missed note never fails the finish that already landed.
  try {
    const trow = await db.get<{ origin_thread_id: string | null }>('select origin_thread_id from tasks where id = ?', [t.id]).catch(() => null);
    if (trow?.origin_thread_id && orch) {
      const names = artifacts.filter((a) => a.kind !== 'diff').map((a) => `\`${a.name}\``).slice(0, 4).join(', ');
      await post('/v1/messages', voice, {
        workspace: ch.workspace_id, channel: ch.id, threadId: trow.origin_thread_id,
        body: `✅ **#${t.number} is done**${names ? ` — ${names} delivered` : ''}. Review it on the card and accept when it looks right.`,
      });
    }
  } catch { /* the finish stands; the note is best-effort */ }
  // §13: the run's report earns its next-steps card, in the thread that owns the run —
  // the origin conversation for anchored units, the unit's own thread otherwise
  if (distill) {
    const report = pickReport(artifacts);
    const trow = await db.get<{ origin_thread_id: string | null }>('select origin_thread_id from tasks where id = ?', [t.id]).catch(() => null);
    if (report) {
      const anchor = trow?.origin_thread_id ? { threadId: trow.origin_thread_id } : { taskId: t.id };
      // the DELIVERABLE first, the follow-ups under it: a deliversReplies run whose worker
      // never posted the ```nmreply card gets it distilled from the report (replydistill.ts)
      if (playbook && playbookById(playbook)?.deliversReplies) {
        await distillReplyCard(db, post, distill.complete, distill.model, distill.token, voice, report,
          { id: ch.id, workspace_id: ch.workspace_id }, t.id, anchor);
      }
      await distillNextSteps(db, post, distill.complete, distill.model, distill.token, voice, report,
        { id: ch.id, workspace_id: ch.workspace_id }, anchor);
    }
  }
}

/** A subtask has no accept edge — its parent's gates cover the FSM — so its acceptance moment
 *  is the DELIVERABLE'S own gate: when the run delivered a scored report, the report card
 *  (dial + save-to-library) posts into the subtask's OWN thread (founder, rerun round: "the
 *  ux card should be in the subtask thread if it requires a user accepting it"). Bounded
 *  wait: the artifact row lands over sync a beat after the finish command. */
export async function postSubtaskAcceptance(
  db: ReplicaGet, post: Post, actor: Actor,
  sub: { id: string; number: number }, parentId: string, ch: { id: string; workspace_id: string },
  files: Array<{ name: string; content: string }>, distill?: DistillCreds, playbook?: string | null,
): Promise<void> {
  // §13: the parent thread (the session that owns the run) gets the next-steps card
  if (distill) {
    const rep = pickReport(files);
    if (rep) {
      const orch = await db.get<{ id: string }>(
        `select a.id from agents a join agent_channels ac on ac.agent_id = a.id
          where ac.channel_id = ? and a.role = 'orchestrator' and a.retired_at is null
          order by length(a.name) asc, a.name asc limit 1`, [ch.id],
      ).catch(() => null);
      const voice = orch ? { kind: 'agent', id: orch.id, role: 'orchestrator' } : actor;
      // the reply-card guarantee, subtask lane: the worker's own card rides the SUBTASK's
      // thread, so the dedupe watches sub.id while the distilled card lands where the human
      // is — the parent thread, beside the next-steps card
      if (playbook && playbookById(playbook)?.deliversReplies) {
        await distillReplyCard(db, post, distill.complete, distill.model, distill.token, voice, rep,
          { id: ch.id, workspace_id: ch.workspace_id }, sub.id, { taskId: parentId });
      }
      await distillNextSteps(db, post, distill.complete, distill.model, distill.token, voice, rep,
        { id: ch.id, workspace_id: ch.workspace_id }, { taskId: parentId });
    }
  }
  const report = files.find((f) => /\.md$/i.test(f.name) && reportFrom(f.name, f.content));
  if (!report) return;
  for (let i = 0; i < 12; i++) {
    const row = await db.get<{ id: string }>(
      'select id from artifacts where task_id = ? and name = ? order by created_at desc limit 1',
      [parentId, report.name],
    ).catch(() => null);
    if (row) {
      await post('/v1/messages', actor, {
        workspace: ch.workspace_id, channel: ch.id, taskId: sub.id,
        body: `The report is in — save it to the library if it looks right. ‹report:${row.id}›`,
      }).catch(() => {});
      return;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}
