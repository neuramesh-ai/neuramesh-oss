// The mail read grants store (0203, docs/design/inbox-sales-2026-11/plan.md I12): a leaf of both stores, reached
// through `mailGrantsOf(store)` the email-drafts.ts way. One row is an agent's ask, the person's Allow once and the
// read's log. Every move names the state it starts from, so two clicks or two reads never both win. Synced.
import type postgres from 'postgres';
import { MAIL_GRANT_MS, type MailGrantStatus, type MailReadSearch } from '@neuramesh/shared';
import { sqlOf } from '../credits';
import type { Store } from '../store';

export interface MailGrant {
  id: string; workspaceId: string; channelId: string; threadId: string; agentId: string;
  search: MailReadSearch; reason: string; status: MailGrantStatus;
  allowedBy: string | null; timeZone: string | null; allowedAt: string | null; expiresAt: string | null;
  usedAt: string | null; readThreads: number | null; readDays: number | null; createdAt: string;
}
export interface AskInput { workspaceId: string; channelId: string; threadId: string; agentId: string; search: MailReadSearch; reason: string }

export interface MailGrantStore {
  /** a new ask. null when this agent has an ask in this session that still waits for the person */
  ask(input: AskInput): Promise<{ id: string } | null>;
  get(id: string): Promise<MailGrant | null>;
  /** Allow once: only an ask that waits, for one hour from now */
  allow(id: string, person: string, timeZone: string, now: Date): Promise<MailGrant | null>;
  /** Not now: only an ask that waits */
  decline(id: string): Promise<MailGrant | null>;
  /** one read: the live grant of this agent in this session (the named one, else the newest) becomes used */
  claim(agentId: string, threadId: string, grantId: string | null, now: Date): Promise<MailGrant | null>;
  /** a read that failed before it gave the agent anything lets the grant read again */
  release(id: string): Promise<void>;
  /** what the read gave the agent: the card's done line and the log */
  finish(id: string, threads: number | null, days: number | null): Promise<void>;
}

// ── memory ─────────────────────────────────────────────────────────────────────────────────────
export class MemMailGrantStore implements MailGrantStore {
  rows: MailGrant[] = [];
  async ask(input: AskInput) {
    if (this.rows.some((r) => r.threadId === input.threadId && r.agentId === input.agentId && r.status === 'asked')) return null;
    const row: MailGrant = {
      id: crypto.randomUUID(), ...input, status: 'asked', allowedBy: null, timeZone: null, allowedAt: null, expiresAt: null,
      usedAt: null, readThreads: null, readDays: null, createdAt: new Date().toISOString(),
    };
    this.rows.push(row);
    return { id: row.id };
  }
  async get(id: string) { return this.rows.find((r) => r.id === id) ?? null; }
  async allow(id: string, person: string, timeZone: string, now: Date) {
    const r = await this.get(id);
    if (!r || r.status !== 'asked') return null;
    return Object.assign(r, { status: 'allowed', allowedBy: person, timeZone, allowedAt: now.toISOString(), expiresAt: new Date(now.getTime() + MAIL_GRANT_MS).toISOString() } as const);
  }
  async decline(id: string) {
    const r = await this.get(id);
    return r && r.status === 'asked' ? Object.assign(r, { status: 'declined' } as const) : null;
  }
  async claim(agentId: string, threadId: string, grantId: string | null, now: Date) {
    const live = this.rows
      .filter((r) => r.agentId === agentId && r.threadId === threadId && r.status === 'allowed' && !!r.expiresAt && Date.parse(r.expiresAt) > now.getTime() && (!grantId || r.id === grantId))
      .sort((a, b) => (b.allowedAt ?? '').localeCompare(a.allowedAt ?? ''));
    const r = live[0];
    return r ? Object.assign(r, { status: 'used', usedAt: now.toISOString() } as const) : null;
  }
  async release(id: string) {
    const r = await this.get(id);
    if (r && r.status === 'used' && r.readThreads == null && r.readDays == null) Object.assign(r, { status: 'allowed', usedAt: null });
  }
  async finish(id: string, threads: number | null, days: number | null) {
    const r = await this.get(id);
    if (r) Object.assign(r, { readThreads: threads, readDays: days });
  }
}

// ── postgres ───────────────────────────────────────────────────────────────────────────────────
type Row = Record<string, unknown>;
const iso = (v: unknown): string | null => (v == null ? null : new Date(v as string).toISOString());
const num = (v: unknown): number | null => (v == null ? null : Number(v));
const rowOf = (r: Row): MailGrant => ({
  id: String(r['id']), workspaceId: String(r['workspace_id']), channelId: String(r['channel_id']), threadId: String(r['thread_id']), agentId: String(r['agent_id']),
  search: (typeof r['search'] === 'string' ? JSON.parse(r['search']) : r['search']) as MailReadSearch, reason: String(r['reason']), status: r['status'] as MailGrantStatus,
  allowedBy: (r['allowed_by'] as string | null) ?? null, timeZone: (r['time_zone'] as string | null) ?? null, allowedAt: iso(r['allowed_at']), expiresAt: iso(r['expires_at']),
  usedAt: iso(r['used_at']), readThreads: num(r['read_threads']), readDays: num(r['read_days']), createdAt: iso(r['created_at'])!,
});
const GRANT_SECONDS = Math.round(MAIL_GRANT_MS / 1000);

export class PgMailGrantStore implements MailGrantStore {
  constructor(private readonly sql: postgres.Sql) {}
  async ask(input: AskInput) {
    const [r] = await this.sql`insert into mail_grants (workspace_id, channel_id, thread_id, agent_id, search, reason)
      select ${input.workspaceId}::uuid, ${input.channelId}::uuid, ${input.threadId}::uuid, ${input.agentId}::uuid, ${this.sql.json(input.search as never)}, ${input.reason}
       where not exists (select 1 from mail_grants where thread_id = ${input.threadId}::uuid and agent_id = ${input.agentId}::uuid and status = 'asked')
      returning id`;
    return r ? { id: String(r['id']) } : null;
  }
  async get(id: string) {
    const [r] = await this.sql`select * from mail_grants where id = ${id}::uuid`;
    return r ? rowOf(r) : null;
  }
  async allow(id: string, person: string, timeZone: string, now: Date) {
    const [r] = await this.sql`update mail_grants set status = 'allowed', allowed_by = ${person}::uuid, time_zone = ${timeZone},
        allowed_at = ${now}, expires_at = ${now}::timestamptz + make_interval(secs => ${GRANT_SECONDS}), updated_at = now()
      where id = ${id}::uuid and status = 'asked' returning *`;
    return r ? rowOf(r) : null;
  }
  async decline(id: string) {
    const [r] = await this.sql`update mail_grants set status = 'declined', updated_at = now() where id = ${id}::uuid and status = 'asked' returning *`;
    return r ? rowOf(r) : null;
  }
  async claim(agentId: string, threadId: string, grantId: string | null, now: Date) {
    const [r] = await this.sql`update mail_grants set status = 'used', used_at = ${now}, updated_at = now()
      where id = (select id from mail_grants
                   where agent_id = ${agentId}::uuid and thread_id = ${threadId}::uuid and status = 'allowed' and expires_at > ${now}
                     and (${grantId}::uuid is null or id = ${grantId}::uuid)
                   order by allowed_at desc limit 1 for update skip locked)
        and status = 'allowed'
      returning *`;
    return r ? rowOf(r) : null;
  }
  async release(id: string) {
    await this.sql`update mail_grants set status = 'allowed', used_at = null, updated_at = now()
      where id = ${id}::uuid and status = 'used' and read_threads is null and read_days is null`;
  }
  async finish(id: string, threads: number | null, days: number | null) {
    await this.sql`update mail_grants set read_threads = ${threads}, read_days = ${days}, updated_at = now() where id = ${id}::uuid`;
  }
}

const memStores = new WeakMap<Store, MemMailGrantStore>();
/** the store's read grants: Postgres when it has one, else one map per in-memory store */
export function mailGrantsOf(store: Store): MailGrantStore {
  const sql = sqlOf(store);
  if (sql) return new PgMailGrantStore(sql);
  let mem = memStores.get(store);
  if (!mem) memStores.set(store, (mem = new MemMailGrantStore()));
  return mem;
}
