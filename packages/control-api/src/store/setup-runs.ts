// The area setup runs (0210, docs/design/sales-onboarding-2026-11/plan.md SO1 to SO8): a leaf of both stores, reached
// through `setupRunsOf(store)` the sales.ts way. A run keeps only what has no other home: the skipped steps, the last
// step card the API posted, and the end. Its facts are read from their real homes (the company profile, the Sales
// rows, the email drafts, the session's messages), so this file also reads those, for the run's own workspace only.
import type postgres from 'postgres';
import { CompanyProfileSchema, SALES_SETUP_FLOW, type CompanyProfile, type SetupRunRow } from '@neuramesh/shared';
import { sqlOf } from '../credits';
import type { Store } from '../store';

export interface RunFacts { added: number; noted: boolean; found: boolean }
export interface SetupRunStore {
  get(workspace: string, flow: string): Promise<SetupRunRow | null>;
  /** one run for each workspace and flow: a second start returns the first run */
  create(input: { workspace: string; flow: string; channel: string; startedBy: string }): Promise<{ run: SetupRunRow; created: boolean }>;
  setThread(id: string, thread: string, title: string): Promise<void>;
  /** adds a step to the skipped list once */
  skip(id: string, step: string): Promise<void>;
  /** the step card the API posts next: true only for the call that moved it, so two writes post one card */
  moveStep(id: string, step: string): Promise<boolean>;
  /** stamps the end once: true only for the call that stamped it */
  finish(id: string, how: 'completed' | 'ended'): Promise<boolean>;
  hide(id: string): Promise<void>;
  facts(run: SetupRunRow): Promise<RunFacts>;
  profile(workspace: string): Promise<CompanyProfile | null>;
  /** merges the given keys into the company profile, and keeps every other key */
  mergeProfile(workspace: string, patch: Partial<CompanyProfile>): Promise<void>;
}

type Row = Record<string, unknown>;
const iso = (v: unknown): string | null => (v == null ? null : new Date(v as string).toISOString());
const runOf = (r: Row): SetupRunRow => ({
  id: String(r['id']), workspace_id: String(r['workspace_id']), flow: String(r['flow']), channel_id: String(r['channel_id']), thread_id: (r['thread_id'] as string | null) ?? null,
  started_by: String(r['started_by']), skipped: (r['skipped'] as string[] | null) ?? [], step: (r['step'] as string | null) ?? null,
  ended_at: iso(r['ended_at']), completed_at: iso(r['completed_at']), hidden_at: iso(r['hidden_at']), created_at: iso(r['created_at'])!,
});
const profileOf = (v: unknown): CompanyProfile | null => {
  const raw = typeof v === 'string' ? (() => { try { return JSON.parse(v) as unknown; } catch { return null; } })() : v;
  const p = CompanyProfileSchema.safeParse(raw ?? {});
  return p.success ? p.data : null;
};

export class PgSetupRunStore implements SetupRunStore {
  constructor(private readonly sql: postgres.Sql) {}
  async get(workspace: string, flow: string) {
    const [r] = await this.sql`select * from setup_runs where workspace_id = ${workspace}::uuid and flow = ${flow}`;
    return r ? runOf(r) : null;
  }
  async create(input: { workspace: string; flow: string; channel: string; startedBy: string }) {
    const [r] = await this.sql`insert into setup_runs (workspace_id, flow, channel_id, started_by) values (${input.workspace}::uuid, ${input.flow}, ${input.channel}::uuid, ${input.startedBy})
      on conflict (workspace_id, flow) do nothing returning *`;
    if (r) return { run: runOf(r), created: true };
    return { run: (await this.get(input.workspace, input.flow))!, created: false };
  }
  async setThread(id: string, thread: string, title: string) {
    await this.sql`update setup_runs set thread_id = ${thread}::uuid, updated_at = now() where id = ${id}::uuid`;
    await this.sql`update threads set title = ${title}, titled_at = now() where id = ${thread}::uuid`;
  }
  async skip(id: string, step: string) {
    await this.sql`update setup_runs set skipped = array_append(skipped, ${step}), updated_at = now() where id = ${id}::uuid and not (${step} = any(skipped))`;
  }
  async moveStep(id: string, step: string) {
    const r = await this.sql`update setup_runs set step = ${step}, updated_at = now() where id = ${id}::uuid and step is distinct from ${step} returning id`;
    return r.length > 0;
  }
  async finish(id: string, how: 'completed' | 'ended') {
    const r = how === 'completed'
      ? await this.sql`update setup_runs set completed_at = now(), step = 'done', updated_at = now() where id = ${id}::uuid and completed_at is null and ended_at is null returning id`
      : await this.sql`update setup_runs set ended_at = now(), step = 'ended', updated_at = now() where id = ${id}::uuid and completed_at is null and ended_at is null returning id`;
    return r.length > 0;
  }
  async hide(id: string) { await this.sql`update setup_runs set hidden_at = coalesce(hidden_at, now()), updated_at = now() where id = ${id}::uuid`; }
  async facts(run: SetupRunRow) {
    const [r] = await this.sql`select
        (select count(*)::int from sales_deals where setup_run = ${run.id}::uuid) as added,
        exists (select 1 from email_drafts e join sales_deals d on d.id = e.deal_id where d.setup_run = ${run.id}::uuid and e.status in ('draft', 'sent')) as noted,
        exists (select 1 from messages where thread_id = ${run.thread_id}::uuid and author_kind = 'agent' and body like ${'%```nmsetup%"kind":"leads"%'}) as found`;
    return { added: Number(r!['added']), noted: !!r!['noted'], found: !!r!['found'] };
  }
  async profile(workspace: string) {
    const [r] = await this.sql`select profile from workspaces where id = ${workspace}::uuid`;
    return r ? profileOf(r['profile']) : null;
  }
  async mergeProfile(workspace: string, patch: Partial<CompanyProfile>) {
    await this.sql`update workspaces set profile = coalesce(profile, '{}'::jsonb) || ${this.sql.json(patch as never)} where id = ${workspace}::uuid`;
  }
}

/** the in-memory store's half: the run rows, the profile it holds, and the Sales rows of sales.ts. It has no messages
 *  to read, so a lead list counts as found once a lead was added */
export class MemSetupRunStore implements SetupRunStore {
  rows: SetupRunRow[] = [];
  constructor(private readonly store: Store, private readonly deals: () => Promise<Array<{ setup_run?: string | null }>>) {}
  private find(id: string) { return this.rows.find((r) => r.id === id); }
  async get(workspace: string, flow: string) { return this.rows.find((r) => r.workspace_id === workspace && r.flow === flow) ?? null; }
  async create(input: { workspace: string; flow: string; channel: string; startedBy: string }) {
    const have = await this.get(input.workspace, input.flow);
    if (have) return { run: have, created: false };
    const run: SetupRunRow = { id: crypto.randomUUID(), workspace_id: input.workspace, flow: input.flow, channel_id: input.channel, thread_id: null, started_by: input.startedBy,
      skipped: [], step: null, ended_at: null, completed_at: null, hidden_at: null, created_at: new Date().toISOString() };
    this.rows.push(run);
    return { run, created: true };
  }
  async setThread(id: string, thread: string) { const r = this.find(id); if (r) r.thread_id = thread; }
  async skip(id: string, step: string) { const r = this.find(id); if (r && !r.skipped.includes(step)) r.skipped.push(step); }
  async moveStep(id: string, step: string) { const r = this.find(id); if (!r || r.step === step) return false; r.step = step; return true; }
  async finish(id: string, how: 'completed' | 'ended') {
    const r = this.find(id);
    if (!r || r.completed_at || r.ended_at) return false;
    if (how === 'completed') Object.assign(r, { completed_at: new Date().toISOString(), step: 'done' }); else Object.assign(r, { ended_at: new Date().toISOString(), step: 'ended' });
    return true;
  }
  async hide(id: string) { const r = this.find(id); if (r && !r.hidden_at) r.hidden_at = new Date().toISOString(); }
  async facts(run: SetupRunRow) {
    const added = (await this.deals()).filter((d) => d.setup_run === run.id).length;
    return { added, noted: false, found: added > 0 };
  }
  private workspaces() { return (this.store as unknown as { workspaces: Array<{ id: string; profile?: CompanyProfile | null }> }).workspaces ?? []; }
  async profile(workspace: string) { return this.workspaces().find((w) => w.id === workspace)?.profile ?? null; }
  async mergeProfile(workspace: string, patch: Partial<CompanyProfile>) {
    const w = this.workspaces().find((x) => x.id === workspace);
    if (w) w.profile = { ...(w.profile ?? { help: [] }), ...patch } as CompanyProfile;
  }
}

const memStores = new WeakMap<Store, MemSetupRunStore>();
export function setupRunsOf(store: Store, deals: () => Promise<Array<{ setup_run?: string | null }>> = async () => []): SetupRunStore {
  const sql = sqlOf(store);
  if (sql) return new PgSetupRunStore(sql);
  let mem = memStores.get(store);
  if (!mem) memStores.set(store, (mem = new MemSetupRunStore(store, deals)));
  return mem;
}
export const SALES_FLOW_ID = SALES_SETUP_FLOW.id;
