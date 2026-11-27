// The Sales pipeline store (0201, docs/design/inbox-sales-2026-11/plan.md S1): a leaf of both stores, reached through
// `salesOf(store)` the email-drafts.ts way (Postgres in production, a map for the in-memory store), so neither store's
// big file grows. The rows come back in the replica's own shape, so GET /v1/sales and the replica agree.
import type postgres from 'postgres';
import { LEAD_NEXT_STEP, OPEN_STAGES, leadDuplicate, type CheckedLead, type SalesContactRow, type SalesDealRow, type SalesSource, type SalesStage } from '@neuramesh/shared';
import { sqlOf } from '../credits';
import { DomainError } from '../errors';
import type { Store } from '../store';

export type Writer = { kind: 'agent' | 'human'; id: string };
export interface ContactInput { contact?: string; name?: string; email?: string; company?: string }
export interface NewContact { name: string; email: string; company: string }
export interface DealInput {
  deal?: string; contact?: string | null; title?: string; company?: string; stage?: SalesStage;
  value?: number; currency?: string; nextStep?: string; nextDate?: string | null;
}

/** what sales.add_leads did with one lead: added, in Sales already, or refused for a bad address */
export interface LeadOutcome { company: string; email: string | null; outcome: 'added' | 'already' | 'bad'; deal?: string }

export interface SalesStore {
  contacts(workspace: string): Promise<SalesContactRow[]>;
  deals(workspace: string): Promise<SalesDealRow[]>;
  /** a change to the named contact, else the contact with this address, made when there is none */
  upsertContact(workspace: string, input: ContactInput, source: SalesSource, by: Writer): Promise<{ contact: string; created: boolean }>;
  /** Bring in contacts: each new address becomes a contact, and an address in Sales already is skipped */
  addContacts(workspace: string, people: NewContact[], by: Writer): Promise<{ added: string[]; skipped: number }>;
  upsertDeal(workspace: string, input: DealInput, by: Writer): Promise<{ deal: string; created: boolean }>;
  moveDeal(workspace: string, deal: string, stage: SalesStage, by: Writer): Promise<SalesDealRow>;
  /** the deal's session becomes this one when it has none (S3: its outreach cards live there) */
  linkSession(deal: string, thread: string): Promise<void>;
  /** Sales setup's Add (SO12): each lead a contact when it has an address, and a Lead deal. A person in Sales already
   *  and a company with an open deal are skipped, in one lock, so two Adds never make two deals */
  addLeads(workspace: string, leads: CheckedLead[], run: string | null, by: Writer): Promise<LeadOutcome[]>;
}

const closes = (stage: SalesStage): boolean => !(OPEN_STAGES as readonly string[]).includes(stage);
const missing = (what: string) => new DomainError('NOT_FOUND', `that ${what} is not in Sales`);

// ── memory ─────────────────────────────────────────────────────────────────────────────────────
export class MemSalesStore implements SalesStore {
  contactRows: SalesContactRow[] = [];
  dealRows: SalesDealRow[] = [];
  async contacts(workspace: string) { return this.contactRows.filter((c) => c.workspace_id === workspace); }
  async deals(workspace: string) { return this.dealRows.filter((d) => d.workspace_id === workspace); }
  async upsertContact(workspace: string, input: ContactInput, source: SalesSource, by: Writer) {
    const now = new Date().toISOString();
    const row = input.contact ? this.contactRows.find((c) => c.id === input.contact && c.workspace_id === workspace)
      : this.contactRows.find((c) => c.workspace_id === workspace && c.email === input.email);
    if (input.contact && !row) throw missing('contact');
    if (row) {
      if (input.email && input.email !== row.email && this.contactRows.some((c) => c.workspace_id === workspace && c.email === input.email)) throw new DomainError('CONFLICT', `${input.email} is a contact already`);
      Object.assign(row, { ...(input.name ? { name: input.name } : {}), ...(input.email ? { email: input.email } : {}), ...(input.company ? { company: input.company } : {}), updated_at: now });
      return { contact: row.id, created: false };
    }
    if (!input.email) throw new DomainError('INVALID_INPUT', 'a new contact needs an email address');
    const id = crypto.randomUUID();
    this.contactRows.push({ id, workspace_id: workspace, name: input.name ?? '', email: input.email, company: input.company ?? '', source, created_by_kind: by.kind, created_by: by.id, created_at: now, updated_at: now });
    return { contact: id, created: true };
  }
  async addContacts(workspace: string, people: NewContact[], by: Writer) {
    const added: string[] = [];
    for (const p of people) {
      if (this.contactRows.some((c) => c.workspace_id === workspace && c.email === p.email)) continue;
      added.push((await this.upsertContact(workspace, p, 'gmail', by)).contact);
    }
    return { added, skipped: people.length - added.length };
  }
  async upsertDeal(workspace: string, input: DealInput, by: Writer) {
    const now = new Date().toISOString();
    if (input.deal) {
      const row = this.dealRows.find((d) => d.id === input.deal && d.workspace_id === workspace);
      if (!row) throw missing('deal');
      if (input.stage && input.stage !== row.stage) await this.moveDeal(workspace, row.id, input.stage, by);
      Object.assign(row, Object.fromEntries(Object.entries({
        contact_id: input.contact, title: input.title, company: input.company, value_year: input.value, currency: input.currency, next_step: input.nextStep, next_date: input.nextDate,
      }).filter(([, v]) => v !== undefined)), { updated_at: now });
      return { deal: row.id, created: false };
    }
    if (!input.title) throw new DomainError('INVALID_INPUT', 'a new deal needs a title');
    const contact = input.contact ? this.contactRows.find((c) => c.id === input.contact && c.workspace_id === workspace) : null;
    if (input.contact && !contact) throw missing('contact');
    const stage = input.stage ?? 'lead';
    const id = crypto.randomUUID();
    this.dealRows.push({
      id, workspace_id: workspace, contact_id: contact?.id ?? null, title: input.title, company: input.company || contact?.company || '', stage, value_year: input.value ?? 0,
      currency: input.currency ?? 'USD', next_step: input.nextStep ?? '', next_date: input.nextDate ?? null, thread_id: null, moved_by_kind: null, moved_by: null, moved_at: null,
      closed_at: closes(stage) ? now : null, created_by_kind: by.kind, created_by: by.id, created_at: now, updated_at: now,
    });
    return { deal: id, created: true };
  }
  async moveDeal(workspace: string, deal: string, stage: SalesStage, by: Writer) {
    const row = this.dealRows.find((d) => d.id === deal && d.workspace_id === workspace);
    if (!row) throw missing('deal');
    if (row.stage === stage) return row;
    const now = new Date().toISOString();
    return Object.assign(row, { stage, moved_by_kind: by.kind, moved_by: by.id, moved_at: now, closed_at: closes(stage) ? now : null, updated_at: now });
  }
  async linkSession(deal: string, thread: string) {
    const row = this.dealRows.find((d) => d.id === deal);
    if (row && !row.thread_id) Object.assign(row, { thread_id: thread, updated_at: new Date().toISOString() });
  }
  async addLeads(workspace: string, leads: CheckedLead[], run: string | null, by: Writer) {
    const out: LeadOutcome[] = [];
    for (const l of leads) {
      const base = { company: l.company, email: l.email ?? null };
      if (l.check === 'bad') { out.push({ ...base, outcome: 'bad' }); continue; }
      if (leadDuplicate(l, await this.contacts(workspace), await this.deals(workspace))) { out.push({ ...base, outcome: 'already' }); continue; }
      let contact: string | null = null;
      if (l.email) {
        contact = (await this.upsertContact(workspace, { name: l.name, email: l.email, company: l.company }, l.source, by)).contact;
        Object.assign(this.contactRows.find((c) => c.id === contact)!, { title: l.title, address_check: l.check === 'none' ? null : l.check });
      }
      const { deal } = await this.upsertDeal(workspace, { title: l.company, company: l.company, contact, nextStep: LEAD_NEXT_STEP }, by);
      Object.assign(this.dealRows.find((d) => d.id === deal)!, { fit: l.fit, source_url: l.sourceUrl ?? '', source: l.source, setup_run: run });
      out.push({ ...base, outcome: 'added', deal });
    }
    return out;
  }
}

// ── postgres ───────────────────────────────────────────────────────────────────────────────────
type Row = Record<string, unknown>;
const iso = (v: unknown): string | null => (v == null ? null : new Date(v as string).toISOString());
const day = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const contactOf = (r: Row): SalesContactRow => ({
  id: String(r['id']), workspace_id: String(r['workspace_id']), name: String(r['name']), email: String(r['email']), company: String(r['company']), source: String(r['source']),
  created_by_kind: String(r['created_by_kind']), created_by: String(r['created_by']), created_at: iso(r['created_at'])!, updated_at: iso(r['updated_at'])!,
  title: String(r['title'] ?? ''), address_check: (r['address_check'] as string | null) ?? null,
});
const dealOf = (r: Row): SalesDealRow => ({
  id: String(r['id']), workspace_id: String(r['workspace_id']), contact_id: (r['contact_id'] as string | null) ?? null, title: String(r['title']), company: String(r['company']),
  stage: String(r['stage']), value_year: Number(r['value_year']), currency: String(r['currency']), next_step: String(r['next_step']), next_date: day(r['next_date']),
  thread_id: (r['thread_id'] as string | null) ?? null, moved_by_kind: (r['moved_by_kind'] as string | null) ?? null, moved_by: (r['moved_by'] as string | null) ?? null,
  moved_at: iso(r['moved_at']), closed_at: iso(r['closed_at']), created_by_kind: String(r['created_by_kind']), created_by: String(r['created_by']),
  created_at: iso(r['created_at'])!, updated_at: iso(r['updated_at'])!,
  fit: String(r['fit'] ?? ''), source_url: String(r['source_url'] ?? ''), source: String(r['source'] ?? 'human'), setup_run: (r['setup_run'] as string | null) ?? null,
});
const taken = (e: unknown): boolean => (e as { code?: string })?.code === '23505';

export class PgSalesStore implements SalesStore {
  constructor(private readonly sql: postgres.Sql) {}
  async contacts(workspace: string) { return (await this.sql`select * from sales_contacts where workspace_id = ${workspace}::uuid order by created_at desc`).map(contactOf); }
  async deals(workspace: string) { return (await this.sql`select * from sales_deals where workspace_id = ${workspace}::uuid order by updated_at desc`).map(dealOf); }
  async upsertContact(workspace: string, input: ContactInput, source: SalesSource, by: Writer) {
    try {
      if (input.contact) {
        const [r] = await this.sql`update sales_contacts set name = coalesce(${input.name ?? null}, name), email = coalesce(${input.email ?? null}, email),
            company = coalesce(${input.company ?? null}, company), updated_at = now()
          where id = ${input.contact}::uuid and workspace_id = ${workspace}::uuid returning id`;
        if (!r) throw missing('contact');
        return { contact: String(r['id']), created: false };
      }
      if (!input.email) throw new DomainError('INVALID_INPUT', 'a new contact needs an email address');
      const [r] = await this.sql`insert into sales_contacts (workspace_id, name, email, company, source, created_by_kind, created_by)
        values (${workspace}::uuid, ${input.name ?? ''}, ${input.email}, ${input.company ?? ''}, ${source}, ${by.kind}, ${by.id})
        on conflict (workspace_id, email) do update set name = case when excluded.name <> '' then excluded.name else sales_contacts.name end,
          company = case when excluded.company <> '' then excluded.company else sales_contacts.company end, updated_at = now()
        returning id, (xmax = 0) as created`;
      return { contact: String(r!['id']), created: !!r!['created'] };
    } catch (e) {
      if (taken(e)) throw new DomainError('CONFLICT', `${input.email} is a contact already`);
      throw e;
    }
  }
  async addContacts(workspace: string, people: NewContact[], by: Writer) {
    const rows = await this.sql`insert into sales_contacts ${this.sql(people.map((p) => ({ workspace_id: workspace, name: p.name, email: p.email, company: p.company, source: 'gmail', created_by_kind: by.kind, created_by: by.id })))}
      on conflict (workspace_id, email) do nothing returning id`;
    return { added: rows.map((r) => String(r['id'])), skipped: people.length - rows.length };
  }
  async upsertDeal(workspace: string, input: DealInput, by: Writer) {
    return this.sql.begin(async (tx) => {
      if (input.deal) {
        if (input.stage) await this.move(tx as unknown as postgres.Sql, workspace, input.deal, input.stage, by);
        const set: Row = Object.fromEntries(Object.entries({
          contact_id: input.contact, title: input.title, company: input.company, value_year: input.value, currency: input.currency, next_step: input.nextStep, next_date: input.nextDate,
        }).filter(([, v]) => v !== undefined));
        const [r] = Object.keys(set).length
          ? await tx`update sales_deals set ${tx(set)}, updated_at = now() where id = ${input.deal}::uuid and workspace_id = ${workspace}::uuid returning id`
          : await tx`select id from sales_deals where id = ${input.deal}::uuid and workspace_id = ${workspace}::uuid`;
        if (!r) throw missing('deal');
        return { deal: String(r['id']), created: false };
      }
      if (!input.title) throw new DomainError('INVALID_INPUT', 'a new deal needs a title');
      const stage = input.stage ?? 'lead';
      const [c] = input.contact ? await tx`select company from sales_contacts where id = ${input.contact}::uuid and workspace_id = ${workspace}::uuid` : [null];
      if (input.contact && !c) throw missing('contact');
      const [r] = await tx`insert into sales_deals (workspace_id, contact_id, title, company, stage, value_year, currency, next_step, next_date, closed_at, created_by_kind, created_by)
        values (${workspace}::uuid, ${input.contact ?? null}, ${input.title}, ${input.company || (c?.['company'] as string | undefined) || ''}, ${stage}, ${input.value ?? 0},
          ${input.currency ?? 'USD'}, ${input.nextStep ?? ''}, ${input.nextDate ?? null}, ${closes(stage) ? new Date() : null}, ${by.kind}, ${by.id})
        returning id`;
      return { deal: String(r!['id']), created: true };
    }) as Promise<{ deal: string; created: boolean }>;
  }
  async moveDeal(workspace: string, deal: string, stage: SalesStage, by: Writer) { return this.move(this.sql, workspace, deal, stage, by); }
  private async move(sql: postgres.Sql, workspace: string, deal: string, stage: SalesStage, by: Writer) {
    const [r] = await sql`update sales_deals set stage = ${stage}, moved_by_kind = ${by.kind}, moved_by = ${by.id}, moved_at = now(),
        closed_at = ${closes(stage) ? sql`now()` : null}, updated_at = now()
      where id = ${deal}::uuid and workspace_id = ${workspace}::uuid and stage <> ${stage} returning *`;
    if (r) return dealOf(r);
    const [same] = await sql`select * from sales_deals where id = ${deal}::uuid and workspace_id = ${workspace}::uuid`;
    if (!same) throw missing('deal');
    return dealOf(same);
  }
  async linkSession(deal: string, thread: string) {
    await this.sql`update sales_deals set thread_id = ${thread}::uuid, updated_at = now() where id = ${deal}::uuid and thread_id is null`;
  }
  async addLeads(workspace: string, leads: CheckedLead[], run: string | null, by: Writer) {
    return this.sql.begin(async (_tx) => {
      const tx = _tx as unknown as postgres.Sql;
      await tx`select pg_advisory_xact_lock(hashtextextended(${`${workspace}:sales-leads`}, 0))`;
      const contacts = (await tx`select id, email from sales_contacts where workspace_id = ${workspace}::uuid`).map((r) => ({ id: String(r['id']), email: String(r['email']) }));
      const deals = (await tx`select company, stage, contact_id from sales_deals where workspace_id = ${workspace}::uuid`).map((r) => ({ company: String(r['company']), stage: String(r['stage']), contact_id: (r['contact_id'] as string | null) ?? null }));
      const out: LeadOutcome[] = [];
      for (const l of leads) {
        const base = { company: l.company, email: l.email ?? null };
        if (l.check === 'bad') { out.push({ ...base, outcome: 'bad' }); continue; }
        if (leadDuplicate(l, contacts, deals)) { out.push({ ...base, outcome: 'already' }); continue; }
        let contact: string | null = null;
        if (l.email) {
          const [c] = await tx`insert into sales_contacts (workspace_id, name, email, company, source, title, address_check, checked_at, created_by_kind, created_by)
            values (${workspace}::uuid, ${l.name}, ${l.email}, ${l.company}, ${l.source}, ${l.title}, ${l.check === 'none' ? null : l.check}, ${l.check === 'none' ? null : new Date()}, ${by.kind}, ${by.id})
            on conflict (workspace_id, email) do nothing returning id`;
          if (!c) { out.push({ ...base, outcome: 'already' }); continue; }
          contact = String(c['id']);
          contacts.push({ id: contact, email: l.email });
        }
        const [d] = await tx`insert into sales_deals (workspace_id, contact_id, title, company, stage, next_step, fit, source_url, source, setup_run, created_by_kind, created_by)
          values (${workspace}::uuid, ${contact}, ${l.company}, ${l.company}, 'lead', ${LEAD_NEXT_STEP}, ${l.fit}, ${l.sourceUrl ?? ''}, ${l.source}, ${run}, ${by.kind}, ${by.id}) returning id`;
        deals.push({ company: l.company, stage: 'lead', contact_id: contact });
        out.push({ ...base, outcome: 'added', deal: String(d!['id']) });
      }
      return out;
    }) as Promise<LeadOutcome[]>;
  }
}

const memStores = new WeakMap<Store, MemSalesStore>();
/** the store's pipeline: Postgres when it has one, else one map per in-memory store */
export function salesOf(store: Store): SalesStore {
  const sql = sqlOf(store);
  if (sql) return new PgSalesStore(sql);
  let mem = memStores.get(store);
  if (!mem) memStores.set(store, (mem = new MemSalesStore()));
  return mem;
}
