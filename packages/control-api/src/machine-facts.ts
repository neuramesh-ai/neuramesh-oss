// MACHINE FACTS (0156, docs/design/cloud-run-2026-10/architecture.md §4): the already-handled facts a
// machine must never act on twice, moved from the daemon's local harness.db to Postgres for Cloud Run
// machines, whose disk dies with every sleep and every crash. The desktop and GKE daemons keep their
// SQLite (apps/desktop/src/main/harness/facts.ts holds both implementations behind one interface).
//
// INSERT-IF-ABSENT IS THE PROTOCOL. `POST /v1/machines/facts` creates the row or reports it was there
// (`created: false`); the caller acts only on `created: true`. One row per (workspace, kind, subject),
// so a restarted process, a newer epoch and another machine of the workspace all read the same fact.
// A subject that is per machine (a worktree on this machine's disk) carries the machine in its key —
// the client's choice, because only it knows what the fact is about.
//
// EPOCH-FENCED. Every write names the writer's epoch and the insert itself is conditional on it, so a
// replaced instance (a resize overlaps two for ~8 s) gets 409 STALE_EPOCH and records nothing.
// Registered ABOVE the /v1 gate (app.ts): machineFromBearer tells a replaced token (409) from an
// unknown one (401), the machine-snapshots.ts idiom.
import type { Env, Hono } from 'hono';
import type postgres from 'postgres';
import { z } from 'zod';
import { sqlOf } from './credits';
import { DomainError } from './errors';
import { assertEpoch, refuse } from './fleet-cloudrun';
import { machineFromBearer } from './fleet-cloudrun-boot';
import type { Store } from './store';

export const FactKind = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/);
export const FactSubject = z.string().min(1).max(512);
const Epoch = z.number().int().min(0);
const RecordSchema = z.object({ epoch: Epoch, kind: FactKind, subject: FactSubject, payload: z.record(z.unknown()).optional() });
const ReleaseSchema = z.object({ epoch: Epoch, kind: FactKind, subject: FactSubject });
/** a hydration read is bounded: the daemon's local store keeps 7 days, and so does its read */
const LIST_LIMIT = 5_000;

export interface MachineFact {
  workspaceId: string;
  kind: string;
  subject: string;
  payload: Record<string, unknown>;
  createdAt: string;
  createdByMachine: string | null;
  epoch: number;
}

interface FactRow { workspace_id: string; kind: string; subject_key: string; payload: unknown; created_at: Date; created_by_machine: string | null; epoch: string | number }

const toFact = (r: FactRow): MachineFact => ({
  workspaceId: r.workspace_id, kind: r.kind, subject: r.subject_key,
  payload: (r.payload && typeof r.payload === 'object' ? r.payload : {}) as Record<string, unknown>,
  createdAt: new Date(r.created_at).toISOString(), createdByMachine: r.created_by_machine, epoch: Number(r.epoch),
});

/** insert-if-absent, conditional on the machine's current epoch. `created: false` = already handled */
export async function recordFact(sql: postgres.Sql, machineId: string, f: { epoch: number; kind: string; subject: string; payload?: Record<string, unknown> }): Promise<{ created: boolean; fact: MachineFact }> {
  const [made] = await sql<FactRow[]>`
    insert into machine_facts (workspace_id, kind, subject_key, payload, created_by_machine, epoch)
    select m.workspace_id, ${f.kind}::text, ${f.subject}::text, ${sql.json((f.payload ?? {}) as never)}::jsonb, m.id, m.epoch
      from machines m
     where m.id = ${machineId}::uuid and m.epoch = ${f.epoch}
    on conflict (workspace_id, kind, subject_key) do nothing
    returning workspace_id, kind, subject_key, payload, created_at, created_by_machine, epoch`;
  if (made) return { created: true, fact: toFact(made) };
  // nothing inserted: either the epoch is not current (refused out loud) or the fact already exists
  await assertEpoch(sql, machineId, f.epoch);
  const had = await readFact(sql, machineId, f.kind, f.subject);
  // released between the two statements: the caller retries, and the retry decides
  if (!had) throw new DomainError('CONFLICT', 'the fact was released while it was recorded; retry');
  return { created: false, fact: had };
}

/** undo this machine's own fact (a merge attempt that failed records nothing). Another machine's fact
 *  is never released from here: it may be acting on it right now */
export async function releaseFact(sql: postgres.Sql, machineId: string, f: { epoch: number; kind: string; subject: string }): Promise<{ released: boolean }> {
  const rows = await sql<{ kind: string }[]>`
    delete from machine_facts x
     using machines m
     where m.id = ${machineId}::uuid and m.epoch = ${f.epoch}
       and x.workspace_id = m.workspace_id and x.kind = ${f.kind} and x.subject_key = ${f.subject}
       and x.created_by_machine = m.id
    returning x.kind`;
  if (rows.length) return { released: true };
  await assertEpoch(sql, machineId, f.epoch);
  return { released: false };
}

/** FACTS THAT ARE A TICK'S LEASE, NOT A HISTORY. `orch-sweep` is one row per orchestrator, channel,
 *  cadence and time bucket (the machines of a workspace claim each sweep tick, so only one runs it).
 *  A row matters only inside its bucket, and there are hundreds a day per channel, so the park sweep
 *  deletes them after a day. Every other kind is an already-handled fact and stays */
export const TICK_FACT_KINDS = ['orch-sweep'] as const;
export const TICK_FACT_TTL_HOURS = 24;

export async function pruneTickFacts(sql: postgres.Sql, now = new Date()): Promise<number> {
  const before = new Date(now.getTime() - TICK_FACT_TTL_HOURS * 3_600_000);
  const rows = await sql<{ kind: string }[]>`
    delete from machine_facts where kind in ${sql([...TICK_FACT_KINDS])} and created_at < ${before}::timestamptz
    returning kind`;
  return rows.length;
}

export async function readFact(sql: postgres.Sql, machineId: string, kind: string, subject: string): Promise<MachineFact | null> {
  const [row] = await sql<FactRow[]>`
    select x.workspace_id, x.kind, x.subject_key, x.payload, x.created_at, x.created_by_machine, x.epoch
      from machine_facts x join machines m on m.workspace_id = x.workspace_id
     where m.id = ${machineId}::uuid and x.kind = ${kind} and x.subject_key = ${subject}`;
  return row ? toFact(row) : null;
}

export async function listFacts(sql: postgres.Sql, machineId: string, kind: string, since: Date | null): Promise<MachineFact[]> {
  const rows = await sql<FactRow[]>`
    select x.workspace_id, x.kind, x.subject_key, x.payload, x.created_at, x.created_by_machine, x.epoch
      from machine_facts x join machines m on m.workspace_id = x.workspace_id
     where m.id = ${machineId}::uuid and x.kind = ${kind}
       and (${since === null}::boolean or x.created_at >= ${since ?? new Date(0)}::timestamptz)
     order by x.created_at desc
     limit ${LIST_LIMIT}`;
  return rows.map(toFact);
}

export function machineFactRoutes<E extends Env>(app: Hono<E>, store: Store): void {
  const lane = async (authorization: string | undefined) => {
    const machine = await machineFromBearer(store, authorization);
    if ('error' in machine) return { refused: { error: machine.error, code: machine.code }, status: machine.status } as const;
    const sql = sqlOf(store);
    if (!sql) return { refused: { error: 'machine facts are not served by this store', code: 'NOT_CONFIGURED' }, status: 501 as const } as const;
    return { machine, sql } as const;
  };

  // {epoch, kind, subject, payload?} → {created, fact}. created:false means already handled: do not act
  app.post('/v1/machines/facts', async (c) => {
    const l = await lane(c.req.header('authorization'));
    if ('refused' in l) return c.json(l.refused, l.status);
    const body = RecordSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'name the epoch, a kind (lowercase, digits, - or _) and a subject', code: 'INVALID_INPUT', issues: body.error.issues }, 400);
    try {
      const out = await recordFact(l.sql, l.machine.id, body.data);
      return c.json(out, out.created ? 201 : 200);
    } catch (e) {
      return refuse(c, e);
    }
  });

  // {epoch, kind, subject} → {released}: the failed attempt gives the fact back, so a retry may act
  app.post('/v1/machines/facts/release', async (c) => {
    const l = await lane(c.req.header('authorization'));
    if ('refused' in l) return c.json(l.refused, l.status);
    const body = ReleaseSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'name the epoch, the kind and the subject', code: 'INVALID_INPUT' }, 400);
    try {
      return c.json(await releaseFact(l.sql, l.machine.id, body.data));
    } catch (e) {
      return refuse(c, e);
    }
  });

  // ?kind=&subject= → {fact | null}; ?kind=[&since=ISO] → {facts} (the boot hydration, newest first)
  app.get('/v1/machines/facts', async (c) => {
    const l = await lane(c.req.header('authorization'));
    if ('refused' in l) return c.json(l.refused, l.status);
    const kind = FactKind.safeParse(c.req.query('kind'));
    if (!kind.success) return c.json({ error: 'name the kind', code: 'INVALID_INPUT' }, 400);
    const subject = c.req.query('subject');
    if (subject !== undefined) {
      const s = FactSubject.safeParse(subject);
      if (!s.success) return c.json({ error: 'the subject is 1 to 512 characters', code: 'INVALID_INPUT' }, 400);
      return c.json({ fact: await readFact(l.sql, l.machine.id, kind.data, s.data) });
    }
    const sinceRaw = c.req.query('since');
    const since = sinceRaw ? new Date(sinceRaw) : null;
    if (since && Number.isNaN(since.getTime())) return c.json({ error: 'since is an ISO timestamp', code: 'INVALID_INPUT' }, 400);
    return c.json({ facts: await listFacts(l.sql, l.machine.id, kind.data, since) });
  });
}
