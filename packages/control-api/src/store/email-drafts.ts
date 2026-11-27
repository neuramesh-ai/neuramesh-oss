// The email drafts store (0197, docs/design/inbox-sales-2026-11/plan.md I8 to I11): a leaf of both stores, reached
// through `emailDraftsOf(store)` the inbox-items.ts way (Postgres in production, a map for the in-memory store), so
// neither store's big file grows. One row is one email of a card. Synced; written only here.
import type postgres from 'postgres';
import { EMAIL_SEND_CLAIM_MS, emailLetter, type EmailDraftStatus } from '@neuramesh/shared';
import { sqlOf } from '../credits';
import { DomainError } from '../errors';
import type { Store } from '../store';

export interface NewEmail { toName: string; toEmail: string; subject: string; body: string; reason: string; /** outreach: the deal this email writes for (0201) */ deal?: string | null }
export interface EmailDraft {
  id: string; workspaceId: string; channelId: string; threadId: string; cardId: string; letter: string; version: number;
  toName: string; toEmail: string; subject: string; body: string; reason: string; status: EmailDraftStatus;
  authorKind: 'agent' | 'human'; authorId: string; editedByKind: 'agent' | 'human'; editedBy: string;
  sentBy: string | null; sentFrom: string | null; sentAt: string | null; gmailId: string | null; dealId: string | null; createdAt: string; updatedAt: string;
}
export type Writer = { kind: 'agent' | 'human'; id: string };
export interface DraftInput { workspaceId: string; channelId: string; threadId: string; by: Writer; emails: NewEmail[] }

export interface EmailDraftStore {
  /** the room a session lives in, or null when there is no such session */
  threadRoom(threadId: string): Promise<{ workspaceId: string; channelId: string } | null>;
  /** a new card: its emails lettered in order. The session's waiting drafts to the same addresses become replaced */
  draft(input: DraftInput): Promise<{ cardId: string; emails: Array<{ id: string; letter: string }>; replaced: number }>;
  get(id: string): Promise<EmailDraft | null>;
  card(cardId: string): Promise<EmailDraft[]>;
  /** a new version of a waiting email, only from the version the writer read */
  revise(id: string, version: number, patch: Partial<NewEmail>, by: Writer): Promise<EmailDraft>;
  /** holds the waiting emails of a card for one send, oldest claim first: what it returns is this sender's to send */
  claim(cardId: string, letters: string[], person: string, from: string, now: Date): Promise<EmailDraft[]>;
  markSent(id: string, gmailId: string, now: Date): Promise<void>;
  /** a send that failed lets its email wait again */
  release(id: string): Promise<void>;
  /** Do not send (DS8): a waiting email that no send holds is dropped */
  drop(id: string): Promise<EmailDraft>;
}

/** why a revision of this row cannot land, or null when it can */
export function refusal(row: EmailDraft | null, version: number, nowMs: number): DomainError | null {
  if (!row) return new DomainError('NOT_FOUND', 'that email is not on a card');
  if (row.status === 'sent') return new DomainError('CONFLICT', `email ${row.letter} already went. Draft a new card to write again`);
  if (row.status === 'replaced') return new DomainError('CONFLICT', `email ${row.letter} was replaced by a newer card`);
  if (row.status === 'dropped') return new DomainError('CONFLICT', `the person chose not to send email ${row.letter}`);
  if (row.sentAt && nowMs - Date.parse(row.sentAt) < EMAIL_SEND_CLAIM_MS) return new DomainError('CONFLICT', `email ${row.letter} is being sent`);
  if (row.version !== version) return new DomainError('EMAIL_STALE', `email ${row.letter} is at version ${row.version}${row.editedByKind === 'human' ? ', a person edited it' : ''}. Read it, and write the change from version ${row.version}`);
  return null;
}

// ── memory ─────────────────────────────────────────────────────────────────────────────────────
type MemThread = { id: string; workspace: string; channel: string };
export class MemEmailDraftStore implements EmailDraftStore {
  rows: EmailDraft[] = [];
  constructor(private readonly threads: () => MemThread[] = () => []) {}
  async threadRoom(threadId: string) {
    const t = this.threads().find((x) => x.id === threadId);
    return t ? { workspaceId: t.workspace, channelId: t.channel } : null;
  }
  async draft(input: DraftInput) {
    const now = new Date().toISOString();
    const to = new Set(input.emails.map((e) => e.toEmail.toLowerCase()));
    let replaced = 0;
    for (const r of this.rows) {
      if (r.threadId === input.threadId && r.status === 'draft' && !r.sentAt && to.has(r.toEmail)) { r.status = 'replaced'; r.updatedAt = now; replaced += 1; }
    }
    const cardId = crypto.randomUUID();
    const emails = input.emails.map((e, i) => {
      const row: EmailDraft = {
        id: crypto.randomUUID(), workspaceId: input.workspaceId, channelId: input.channelId, threadId: input.threadId, cardId, letter: emailLetter(i), version: 1,
        toName: e.toName, subject: e.subject, body: e.body, reason: e.reason, toEmail: e.toEmail.toLowerCase(), status: 'draft', authorKind: input.by.kind, authorId: input.by.id, editedByKind: input.by.kind, editedBy: input.by.id,
        sentBy: null, sentFrom: null, sentAt: null, gmailId: null, dealId: e.deal ?? null, createdAt: now, updatedAt: now,
      };
      this.rows.push(row);
      return { id: row.id, letter: row.letter };
    });
    return { cardId, emails, replaced };
  }
  async get(id: string) { return this.rows.find((r) => r.id === id) ?? null; }
  async card(cardId: string) { return this.rows.filter((r) => r.cardId === cardId).sort((a, b) => a.letter.length - b.letter.length || a.letter.localeCompare(b.letter)); }
  async revise(id: string, version: number, patch: Partial<NewEmail>, by: Writer) {
    const row = await this.get(id);
    const no = refusal(row, version, Date.now());
    if (no) throw no;
    const set = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as Partial<NewEmail>;
    if (set.toEmail) set.toEmail = set.toEmail.toLowerCase();
    Object.assign(row!, set, { version: row!.version + 1, editedByKind: by.kind, editedBy: by.id, updatedAt: new Date().toISOString() });
    return row!;
  }
  async claim(cardId: string, letters: string[], person: string, from: string, now: Date) {
    const want = new Set(letters);
    const out: EmailDraft[] = [];
    for (const r of await this.card(cardId)) {
      if (!want.has(r.letter) || r.status !== 'draft') continue;
      if (r.sentAt && now.getTime() - Date.parse(r.sentAt) < EMAIL_SEND_CLAIM_MS) continue;
      Object.assign(r, { sentBy: person, sentFrom: from, sentAt: now.toISOString(), updatedAt: now.toISOString() });
      out.push(r);
    }
    return out;
  }
  async markSent(id: string, gmailId: string, now: Date) {
    const r = await this.get(id);
    if (r) Object.assign(r, { status: 'sent', gmailId, sentAt: now.toISOString(), updatedAt: now.toISOString() });
  }
  async release(id: string) {
    const r = await this.get(id);
    if (r && r.status === 'draft') Object.assign(r, { sentBy: null, sentFrom: null, sentAt: null, updatedAt: new Date().toISOString() });
  }
  async drop(id: string) {
    const r = await this.get(id);
    const no = refusal(r, r?.version ?? 0, Date.now());
    if (no) throw no;
    return Object.assign(r!, { status: 'dropped' as const, updatedAt: new Date().toISOString() });
  }
}

// ── postgres ───────────────────────────────────────────────────────────────────────────────────
type Row = Record<string, unknown>;
const iso = (v: unknown): string | null => (v == null ? null : new Date(v as string).toISOString());
const rowOf = (r: Row): EmailDraft => ({
  id: String(r['id']), workspaceId: String(r['workspace_id']), channelId: String(r['channel_id']), threadId: String(r['thread_id']), cardId: String(r['card_id']),
  letter: String(r['letter']), version: Number(r['version']), toName: String(r['to_name']), toEmail: String(r['to_email']), subject: String(r['subject']),
  body: String(r['body']), reason: String(r['reason']), status: r['status'] as EmailDraftStatus, authorKind: r['author_kind'] as Writer['kind'], authorId: String(r['author_id']),
  editedByKind: r['edited_by_kind'] as Writer['kind'], editedBy: String(r['edited_by']), sentBy: (r['sent_by'] as string | null) ?? null, sentFrom: (r['sent_from'] as string | null) ?? null,
  sentAt: iso(r['sent_at']), gmailId: (r['gmail_id'] as string | null) ?? null, dealId: (r['deal_id'] as string | null) ?? null, createdAt: iso(r['created_at'])!, updatedAt: iso(r['updated_at'])!,
});
const CLAIM_SECONDS = Math.round(EMAIL_SEND_CLAIM_MS / 1000);

export class PgEmailDraftStore implements EmailDraftStore {
  constructor(private readonly sql: postgres.Sql) {}
  async threadRoom(threadId: string) {
    const [t] = await this.sql`select workspace_id::text as w, channel_id::text as c from threads where id = ${threadId}::uuid`;
    return t ? { workspaceId: t['w'] as string, channelId: t['c'] as string } : null;
  }
  async draft(input: DraftInput) {
    return this.sql.begin(async (tx) => {
      const to = input.emails.map((e) => e.toEmail.toLowerCase());
      const replaced = await tx`update email_drafts set status = 'replaced', updated_at = now()
        where thread_id = ${input.threadId}::uuid and status = 'draft' and sent_at is null and to_email = any(${to}::text[]) returning id`;
      const cardId = crypto.randomUUID();
      const emails: Array<{ id: string; letter: string }> = [];
      for (const [i, e] of input.emails.entries()) {
        const [row] = await tx`insert into email_drafts (workspace_id, channel_id, thread_id, card_id, letter, to_name, to_email, subject, body, reason, author_kind, author_id, edited_by_kind, edited_by, deal_id)
          values (${input.workspaceId}::uuid, ${input.channelId}::uuid, ${input.threadId}::uuid, ${cardId}::uuid, ${emailLetter(i)}, ${e.toName}, ${e.toEmail.toLowerCase()}, ${e.subject}, ${e.body}, ${e.reason},
            ${input.by.kind}, ${input.by.id}, ${input.by.kind}, ${input.by.id}, ${e.deal ?? null}) returning id, letter`;
        emails.push({ id: String(row!['id']), letter: String(row!['letter']) });
      }
      return { cardId, emails, replaced: replaced.length };
    }) as Promise<{ cardId: string; emails: Array<{ id: string; letter: string }>; replaced: number }>;
  }
  async get(id: string) {
    const [r] = await this.sql`select * from email_drafts where id = ${id}::uuid`;
    return r ? rowOf(r) : null;
  }
  async card(cardId: string) {
    return (await this.sql`select * from email_drafts where card_id = ${cardId}::uuid order by length(letter), letter`).map(rowOf);
  }
  async revise(id: string, version: number, patch: Partial<NewEmail>, by: Writer) {
    const [r] = await this.sql`update email_drafts set version = version + 1,
        to_name = coalesce(${patch.toName ?? null}, to_name), to_email = coalesce(${patch.toEmail?.toLowerCase() ?? null}, to_email),
        subject = coalesce(${patch.subject ?? null}, subject), body = coalesce(${patch.body ?? null}, body), reason = coalesce(${patch.reason ?? null}, reason),
        edited_by_kind = ${by.kind}, edited_by = ${by.id}, updated_at = now()
      where id = ${id}::uuid and version = ${version} and status = 'draft'
        and (sent_at is null or sent_at < now() - make_interval(secs => ${CLAIM_SECONDS}))
      returning *`;
    if (r) return rowOf(r);
    throw refusal(await this.get(id), version, Date.now()) ?? new DomainError('CONFLICT', 'the email changed. Read it again');
  }
  async claim(cardId: string, letters: string[], person: string, from: string, now: Date) {
    return (await this.sql`update email_drafts set sent_by = ${person}::uuid, sent_from = ${from}, sent_at = ${now}, updated_at = now()
      where card_id = ${cardId}::uuid and letter = any(${letters}::text[]) and status = 'draft'
        and (sent_at is null or sent_at < ${now} - make_interval(secs => ${CLAIM_SECONDS}))
      returning *`).map(rowOf).sort((a, b) => a.letter.length - b.letter.length || a.letter.localeCompare(b.letter));
  }
  async markSent(id: string, gmailId: string, now: Date) {
    await this.sql`update email_drafts set status = 'sent', gmail_id = ${gmailId}, sent_at = ${now}, updated_at = now() where id = ${id}::uuid`;
  }
  async release(id: string) {
    await this.sql`update email_drafts set sent_by = null, sent_from = null, sent_at = null, updated_at = now() where id = ${id}::uuid and status = 'draft'`;
  }
  async drop(id: string) {
    const [r] = await this.sql`update email_drafts set status = 'dropped', updated_at = now()
      where id = ${id}::uuid and status = 'draft' and (sent_at is null or sent_at < now() - make_interval(secs => ${CLAIM_SECONDS})) returning *`;
    if (r) return rowOf(r);
    const row = await this.get(id);
    throw refusal(row, row?.version ?? 0, Date.now()) ?? new DomainError('CONFLICT', 'the email changed. Read it again');
  }
}

const memStores = new WeakMap<Store, MemEmailDraftStore>();
/** the store's email drafts: Postgres when it has one, else one map per in-memory store */
export function emailDraftsOf(store: Store): EmailDraftStore {
  const sql = sqlOf(store);
  if (sql) return new PgEmailDraftStore(sql);
  let mem = memStores.get(store);
  if (!mem) memStores.set(store, (mem = new MemEmailDraftStore(() => (store as { threads?: MemThread[] }).threads ?? [])));
  return mem;
}
