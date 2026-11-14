// DURABLE PARKS (0156, docs/design/cloud-run-2026-10/architecture.md §6.3): a turn that waits on a
// human — an approval card, a question — or a timer, persisted so a Cloud Run machine can drain and
// sleep while the person decides, and resume the turn from its checkpoint when they do.
//
//   machine  POST /v1/machines/parks               park a turn: {epoch, key, kind, request, checkpoint, …}
//   human    decision.answer / a reply-line answer / POST /v1/parks/:id/resolve   → resolved, wake
//   sweep    GET /internal/park-sweep (and lazily on every machine read)          → expired = denied
//   machine  GET /v1/machines/parks?status=resolved at boot, POST …/:id/claim {epoch}, POST …/:id/done
// The routes are machine-park-routes.ts; this file holds the rules, the SQL and the two hooks the
// existing answer paths call (handler.ts decision.answer, app.ts POST /v1/messages).
//
// THE WAKE is the message path's: a resolution calls wakeMachine (member-machines.ts), which raises
// desired_replicas and stamps last_wake_at exactly as a delivered message does, credits permitting. A
// resolution that lands DURING an idle drain is caught by cloudRunSweep's `rewoken` pass, because
// last_wake_at is then later than parked_at.
//
// THE FENCE. Every machine write names its epoch and is conditional on it (409 STALE_EPOCH otherwise).
// A claim records the claiming epoch; a claim whose epoch died before `done` is claimable again by a
// later epoch, so a crash between claim and resume never strands a resolution, and a replaced
// instance can never consume one.
//
// EXPIRY resolves as a denial with reason `timeout`, the answer the old in-memory 10-minute wait gave,
// but after a TTL the machine chooses (default NM_PARK_TTL_HOURS, 24 h), clamped to [1 min, 7 days].
import { readAnswers } from '@neuramesh/shared';
import type postgres from 'postgres';
import { z } from 'zod';
import { sqlOf } from './credits';
import { DomainError } from './errors';
import { assertEpoch } from './fleet-cloudrun';
import { wakeMachine } from './member-machines';
import type { Store } from './store';

export const PARK_TTL_MIN_MS = 60_000;
export const PARK_TTL_MAX_MS = 7 * 86_400_000;
export function parkTtlMs(requested?: number | null): number {
  const hours = Number(process.env['NM_PARK_TTL_HOURS'] ?? 24);
  const fallback = Number.isFinite(hours) && hours > 0 ? hours * 3_600_000 : 86_400_000;
  const ms = requested ?? fallback;
  return Math.min(PARK_TTL_MAX_MS, Math.max(PARK_TTL_MIN_MS, Math.round(ms)));
}

export type ParkStatus = 'open' | 'resolved' | 'expired' | 'claimed' | 'done';
export type ResolutionSource = 'decision' | 'reply' | 'human' | 'machine' | 'expiry';
export interface ParkResolution {
  /** the card's answer as the person gave it ('Approve', 'Deny', free text); null = dismissed/expired */
  answer: string | null;
  /** an approval's verdict, derived once here so every reader agrees */
  approved: boolean;
  reason?: string;
  source: ResolutionSource;
  by?: { kind: string; id: string };
}
/** the verdict of an approval answer: only an explicit Approve allows (fail-closed, policygate.ts) */
export const approvedOf = (answer: string | null | undefined): boolean => (answer ?? '').trim().toLowerCase() === 'approve';
export const timeoutResolution = (): ParkResolution => ({ answer: null, approved: false, reason: 'timeout', source: 'expiry' });

export interface Park {
  id: string; workspaceId: string; machineId: string; key: string;
  threadId: string | null; taskId: string | null; turnId: string | null;
  kind: 'approval' | 'question' | 'timer';
  messageId: string | null; question: string | null;
  request: Record<string, unknown>; checkpoint: Record<string, unknown>; wakeCondition: Record<string, unknown>;
  status: ParkStatus; resolution: ParkResolution | null;
  expiresAt: string; createdEpoch: number; claimedEpoch: number | null;
  createdAt: string; resolvedAt: string | null; claimedAt: string | null; doneAt: string | null;
}

export interface ParkRow {
  id: string; workspace_id: string; machine_id: string; key: string; thread_id: string | null; task_id: string | null; turn_id: string | null;
  kind: Park['kind']; message_id: string | null; question: string | null; request: unknown; checkpoint: unknown; wake_condition: unknown;
  status: ParkStatus; resolution: unknown; expires_at: Date; created_epoch: string | number; claimed_epoch: string | number | null;
  created_at: Date; resolved_at: Date | null; claimed_at: Date | null; done_at: Date | null;
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});
const iso = (d: Date | null): string | null => (d ? new Date(d).toISOString() : null);
export const toPark = (r: ParkRow): Park => ({
  id: r.id, workspaceId: r.workspace_id, machineId: r.machine_id, key: r.key,
  threadId: r.thread_id, taskId: r.task_id, turnId: r.turn_id, kind: r.kind,
  messageId: r.message_id, question: r.question,
  request: obj(r.request), checkpoint: obj(r.checkpoint), wakeCondition: obj(r.wake_condition),
  status: r.status, resolution: r.resolution ? (r.resolution as ParkResolution) : null,
  expiresAt: new Date(r.expires_at).toISOString(), createdEpoch: Number(r.created_epoch),
  claimedEpoch: r.claimed_epoch === null ? null : Number(r.claimed_epoch),
  createdAt: new Date(r.created_at).toISOString(), resolvedAt: iso(r.resolved_at), claimedAt: iso(r.claimed_at), doneAt: iso(r.done_at),
});

export const Uuid = z.string().uuid();
export const Epoch = z.number().int().min(0);
export const ResolutionSchema = z.object({
  answer: z.string().max(2_000).nullable(),
  approved: z.boolean().optional(),
  reason: z.string().max(500).optional(),
});
export const CreateParkSchema = z.object({
  epoch: Epoch,
  key: z.string().min(1).max(512),
  kind: z.enum(['approval', 'question', 'timer']),
  threadId: Uuid.nullable().optional(),
  taskId: Uuid.nullable().optional(),
  turnId: z.string().max(200).nullable().optional(),
  messageId: Uuid.nullable().optional(),
  question: z.string().max(4_000).nullable().optional(),
  request: z.record(z.unknown()).default({}),
  checkpoint: z.record(z.unknown()).default({}),
  wakeCondition: z.record(z.unknown()).default({}),
  ttlMs: z.number().int().positive().optional(),
});
export type CreatePark = z.infer<typeof CreateParkSchema>;

export const COLS = (sql: postgres.Sql) => sql`p.id, p.workspace_id, p.machine_id, p.key, p.thread_id, p.task_id, p.turn_id, p.kind, p.message_id, p.question,
  p.request, p.checkpoint, p.wake_condition, p.status, p.resolution, p.expires_at, p.created_epoch, p.claimed_epoch,
  p.created_at, p.resolved_at, p.claimed_at, p.done_at`;

export async function readPark(sql: postgres.Sql, id: string): Promise<Park | null> {
  const [row] = await sql<ParkRow[]>`select ${COLS(sql)} from parks p where p.id = ${id}::uuid`;
  return row ? toPark(row) : null;
}

/** the live (not done) park this machine holds under `key`, if any */
export async function liveParkByKey(sql: postgres.Sql, machineId: string, key: string): Promise<Park | null> {
  const [row] = await sql<ParkRow[]>`select ${COLS(sql)} from parks p where p.machine_id = ${machineId}::uuid and p.key = ${key} and p.status <> 'done' limit 1`;
  return row ? toPark(row) : null;
}

/** park a turn. Idempotent per (machine, key): a second park of a live key returns the first */
export async function createPark(sql: postgres.Sql, machineId: string, p: CreatePark): Promise<{ created: boolean; park: Park }> {
  const ttlSec = Math.ceil(parkTtlMs(p.ttlMs) / 1000);
  const [made] = await sql<ParkRow[]>`
    with ins as (
      insert into parks (workspace_id, machine_id, key, thread_id, task_id, turn_id, kind, message_id, question,
                         request, checkpoint, wake_condition, expires_at, created_epoch)
      select m.workspace_id, m.id, ${p.key}::text, ${p.threadId ?? null}::uuid, ${p.taskId ?? null}::uuid, ${p.turnId ?? null}::text,
             ${p.kind}::text, ${p.messageId ?? null}::uuid, ${p.question ?? null}::text,
             ${sql.json(p.request as never)}::jsonb, ${sql.json(p.checkpoint as never)}::jsonb, ${sql.json(p.wakeCondition as never)}::jsonb,
             now() + make_interval(secs => ${ttlSec}::int), m.epoch
        from machines m
       where m.id = ${machineId}::uuid and m.epoch = ${p.epoch}
      on conflict (machine_id, key) where status <> 'done' do nothing
      returning *
    )
    select ${COLS(sql)} from ins p`;
  if (made) return { created: true, park: toPark(made) };
  await assertEpoch(sql, machineId, p.epoch);
  const live = await liveParkByKey(sql, machineId, p.key);
  if (!live) throw new DomainError('CONFLICT', 'the park settled while it was created; retry');
  return { created: false, park: live };
}

/** open parks past their TTL become `expired`, resolved as a timeout denial. Returns what expired */
export async function expireParks(sql: postgres.Sql, machineId: string | null = null): Promise<Array<{ id: string; machineId: string }>> {
  const rows = await sql<{ id: string; machine_id: string }[]>`
    update parks
       set status = 'expired', resolution = ${sql.json(timeoutResolution() as never)}::jsonb, resolved_at = now()
     where status = 'open' and expires_at <= now()
       and (${machineId === null}::boolean or machine_id = ${machineId ?? '00000000-0000-0000-0000-000000000000'}::uuid)
    returning id, machine_id`;
  return rows.map((r) => ({ id: r.id, machineId: r.machine_id }));
}

/** what a booted epoch should take: resolved or expired parks, and claims an older epoch never finished */
export async function claimableParks(sql: postgres.Sql, machineId: string): Promise<Park[]> {
  await expireParks(sql, machineId);
  const rows = await sql<ParkRow[]>`
    select ${COLS(sql)} from parks p join machines m on m.id = p.machine_id
     where p.machine_id = ${machineId}::uuid
       and (p.status in ('resolved', 'expired') or (p.status = 'claimed' and p.claimed_epoch < m.epoch))
     order by coalesce(p.resolved_at, p.created_at) asc
     limit 200`;
  return rows.map(toPark);
}

export async function openParks(sql: postgres.Sql, machineId: string): Promise<Park[]> {
  await expireParks(sql, machineId);
  const rows = await sql<ParkRow[]>`select ${COLS(sql)} from parks p where p.machine_id = ${machineId}::uuid and p.status = 'open' order by p.expires_at asc limit 200`;
  return rows.map(toPark);
}

/** take a resolved park for this epoch. Idempotent for the epoch that already holds it */
export async function claimPark(sql: postgres.Sql, machineId: string, parkId: string, epoch: number): Promise<Park> {
  const [row] = await sql<ParkRow[]>`
    with up as (
      update parks x set status = 'claimed', claimed_epoch = ${epoch}, claimed_at = now()
        from machines m
       where m.id = x.machine_id and m.id = ${machineId}::uuid and m.epoch = ${epoch} and x.id = ${parkId}::uuid
         and (x.status in ('resolved', 'expired') or (x.status = 'claimed' and x.claimed_epoch < ${epoch}))
      returning x.*
    )
    select ${COLS(sql)} from up p`;
  if (row) return toPark(row);
  await assertEpoch(sql, machineId, epoch);
  const park = await readPark(sql, parkId);
  if (!park || park.machineId !== machineId) throw new DomainError('NOT_FOUND', 'no such park on this machine');
  if (park.status === 'claimed' && park.claimedEpoch === epoch) return park;
  throw new DomainError('CONFLICT', `the park is ${park.status}${park.status === 'claimed' ? ` by epoch ${park.claimedEpoch}` : ''}, not claimable`);
}

/** the resumed turn applied the resolution (or the machine saw the answer itself while awake) */
export async function finishPark(sql: postgres.Sql, machineId: string, parkId: string, epoch: number, resolution: ParkResolution | null): Promise<Park> {
  const [row] = await sql<ParkRow[]>`
    with up as (
      update parks x set status = 'done', done_at = now(),
             resolution = coalesce(x.resolution, ${resolution ? sql.json(resolution as never) : null}::jsonb),
             resolved_at = coalesce(x.resolved_at, case when ${resolution !== null}::boolean then now() end)
        from machines m
       where m.id = x.machine_id and m.id = ${machineId}::uuid and m.epoch = ${epoch} and x.id = ${parkId}::uuid
         and x.status <> 'done' and (x.status <> 'claimed' or x.claimed_epoch <= ${epoch})
      returning x.*
    )
    select ${COLS(sql)} from up p`;
  if (row) return toPark(row);
  await assertEpoch(sql, machineId, epoch);
  const park = await readPark(sql, parkId);
  if (!park || park.machineId !== machineId) throw new DomainError('NOT_FOUND', 'no such park on this machine');
  if (park.status === 'done') return park;
  throw new DomainError('CONFLICT', `the park is ${park.status}, not finishable by epoch ${epoch}`);
}

/** wake every machine whose park just resolved, the way a message wakes it. Never throws. `human`: a
 *  person answered, which is the only wake that retries a machine whose crash-loop breaker tripped
 *  (fleet-cloudrun-breaker.ts). An expired park is nobody's answer */
async function wakeFor(sql: postgres.Sql, rows: Array<{ id: string; machineId: string }>, human: boolean): Promise<number> {
  let woken = 0;
  for (const machineId of new Set(rows.map((r) => r.machineId))) {
    const out = await wakeMachine(sql, machineId, { human }).catch((e: unknown) => { console.error(`park_wake_failed machine=${machineId}:`, e); return { woken: false, capped: false }; });
    if (out.woken) woken += 1;
    console.log(`park_resolved_wake machine=${machineId} woken=${out.woken} capped=${out.capped} parks=${rows.filter((r) => r.machineId === machineId).map((r) => r.id).join(',')}`);
  }
  return woken;
}

const resolve = (sql: postgres.Sql, res: ParkResolution) => sql`status = 'resolved', resolution = ${sql.json(res as never)}::jsonb, resolved_at = now()`;

/** a human (or the machine relaying what the person said in its own session) resolves one open park */
export async function resolvePark(sql: postgres.Sql, parkId: string, res: ParkResolution, opts: { wake?: boolean; machineId?: string; epoch?: number } = {}): Promise<{ park: Park; woken: number }> {
  if (opts.machineId !== undefined) await assertEpoch(sql, opts.machineId, opts.epoch ?? -1);
  const rows = await sql<{ id: string; machine_id: string }[]>`
    update parks set ${resolve(sql, res)}
     where id = ${parkId}::uuid and status = 'open'
       and (${opts.machineId === undefined}::boolean or machine_id = ${opts.machineId ?? '00000000-0000-0000-0000-000000000000'}::uuid)
    returning id, machine_id`;
  const park = await readPark(sql, parkId);
  if (!park || (opts.machineId !== undefined && park.machineId !== opts.machineId)) throw new DomainError('NOT_FOUND', 'no such park');
  if (!rows.length) throw new DomainError('CONFLICT', `the park is already ${park.status}`);
  const woken = opts.wake === false ? 0 : await wakeFor(sql, rows.map((r) => ({ id: r.id, machineId: r.machine_id })), opts.machineId === undefined);
  return { park, woken };
}

/** decision.answer / decision.dismiss: the card's park resolves with the same answer */
export async function resolveParksForDecision(sql: postgres.Sql, decisionId: string, answer: string | null, by: { kind: string; id: string }): Promise<string[]> {
  const res: ParkResolution = { answer, approved: approvedOf(answer), source: 'decision', by, ...(answer === null ? { reason: 'dismissed' } : {}) };
  const rows = await sql<{ id: string; machine_id: string }[]>`
    update parks p set ${resolve(sql, res)}
      from decisions d
     where d.id = ${decisionId}::uuid and p.workspace_id = d.workspace_id and p.message_id = d.message_id and p.status = 'open'
    returning p.id, p.machine_id`;
  await wakeFor(sql, rows.map((r) => ({ id: r.id, machineId: r.machine_id })), by.kind === 'human');
  return rows.map((r) => r.id);
}

/** a human reply carrying `**question** → answer` lines (mobile, chat threads, older clients) */
export async function resolveParksForReply(sql: postgres.Sql, workspaceId: string, where: { taskId?: string | null; threadId?: string | null }, answers: Iterable<[string, string]>, by: { kind: string; id: string }): Promise<string[]> {
  const taskId = where.taskId ?? null;
  const threadId = where.threadId ?? null;
  if (!taskId && !threadId) return [];
  const out: Array<{ id: string; machineId: string }> = [];
  for (const [question, answer] of answers) {
    const res: ParkResolution = { answer, approved: approvedOf(answer), source: 'reply', by };
    const rows = await sql<{ id: string; machine_id: string }[]>`
      update parks set ${resolve(sql, res)}
       where workspace_id = ${workspaceId}::uuid and status = 'open' and question = ${question}
         and ((${taskId}::uuid is not null and task_id = ${taskId}::uuid) or (${threadId}::uuid is not null and thread_id = ${threadId}::uuid))
      returning id, machine_id`;
    out.push(...rows.map((r) => ({ id: r.id, machineId: r.machine_id })));
  }
  if (out.length) await wakeFor(sql, out, by.kind === 'human');
  return out.map((r) => r.id);
}

/** the message path's hook, fire-and-forget like fireWakeBump: never awaited, never throws */
export function fireParkReplies(store: Store, workspaceId: string, where: { taskId: string | null; threadId: string | null }, body: string, actor: { kind: string; id: string }): void {
  const sql = sqlOf(store);
  if (!sql || (!where.taskId && !where.threadId)) return;
  const answers = [...readAnswers([body])];
  if (!answers.length) return;
  void resolveParksForReply(sql, workspaceId, where, answers, { kind: actor.kind, id: actor.id })
    .catch((e: unknown) => console.error('park reply resolve failed:', e));
}

/** the decision path's hook (handler.ts decision.answer / decision.dismiss). Never throws: the card's
 *  own flip already committed, and a park that missed it still expires to a denial */
export async function settleParksForDecision(store: Store, decisionId: string, answer: string | null, actor: { kind: string; id: string }): Promise<void> {
  const sql = sqlOf(store);
  if (!sql) return;
  await resolveParksForDecision(sql, decisionId, answer, { kind: actor.kind, id: actor.id })
    .catch((e: unknown) => console.error(`park decision resolve failed decision=${decisionId}:`, e));
}

/** the cron pass: expire what is due and wake each machine, so its turn resumes with the denial */
export async function parkSweep(sql: postgres.Sql): Promise<{ expired: string[]; woken: number }> {
  const expired = await expireParks(sql);
  const woken = expired.length ? await wakeFor(sql, expired, false) : 0;
  return { expired: expired.map((e) => e.id), woken };
}
