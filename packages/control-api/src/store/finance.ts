import type postgres from 'postgres';
import type { FinanceChat, FinanceChatSummary } from '@neuramesh/shared';
import { seal, unseal } from '../connector-crypto';

// Private person-owned state. Deliberately absent from the workspace sync publication and events.
export interface FinanceLink { session: string; sealedSecret: string; origin: string; intent: 'create' | 'connect' }
export interface FinanceStore {
  withOwner<T>(owner: string, fn: (link: FinanceLink | null, save: (link: FinanceLink | null) => Promise<void>) => Promise<T>): Promise<T>;
  withWorkspace<T>(workspace: string, by: string, fn: (link: FinanceLink | null, save: (link: FinanceLink | null) => Promise<void>) => Promise<T>): Promise<T>;
  adoptPersonal(workspace: string, owner: string): Promise<boolean>;
  listChats(workspace: string, session: string): Promise<FinanceChatSummary[]>;
  getChat(workspace: string, session: string, id: string): Promise<FinanceChat | null>;
  putChat(workspace: string, session: string, chat: FinanceChat, expectedRevision: number | null): Promise<boolean>;
}
export class MemFinanceStore implements FinanceStore {
  private links = new Map<string, FinanceLink>();
  private queues = new Map<string, Promise<unknown>>();
  private chats = new Map<string, { workspace: string; session: string; chat: FinanceChat }>();
  withWorkspace<T>(workspace: string, _by: string, fn: (link: FinanceLink | null, save: (link: FinanceLink | null) => Promise<void>) => Promise<T>) { return this.withOwner(`workspace:${workspace}`, fn); }
  async adoptPersonal(workspace: string, owner: string) {
    return this.withWorkspace(workspace, owner, async (existing, save) => {
      if (existing) return false;
      return this.withOwner(owner, async (link, clear) => { if (!link) return false; await save(link); await clear(null); return true; });
    });
  }
  async listChats(workspace: string, session: string) { return [...this.chats.values()].filter(r => r.workspace === workspace && r.session === session).map(r => ({ id: r.chat.id, title: r.chat.title, updatedAt: r.chat.updatedAt })).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0,30); }
  async getChat(workspace: string, session: string, id: string) { const row = this.chats.get(id); return row?.workspace === workspace && row.session === session ? structuredClone(row.chat) : null; }
  async putChat(workspace: string, session: string, chat: FinanceChat, expectedRevision: number | null) {
    const old = this.chats.get(chat.id);
    if (old ? old.workspace !== workspace || old.session !== session || old.chat.revision !== expectedRevision : expectedRevision !== null) return false;
    this.chats.set(chat.id, { workspace, session, chat: structuredClone(chat) }); return true;
  }
  async withOwner<T>(owner: string, fn: (link: FinanceLink | null, save: (link: FinanceLink | null) => Promise<void>) => Promise<T>): Promise<T> {
    const previous = this.queues.get(owner) ?? Promise.resolve();
    const work = previous.catch(() => {}).then(() => fn(this.links.get(owner) ?? null, async (link) => {
      if (link) this.links.set(owner, link); else this.links.delete(owner);
    }));
    this.queues.set(owner, work);
    try { return await work; } finally { if (this.queues.get(owner) === work) this.queues.delete(owner); }
  }
}
export class PgFinanceStore implements FinanceStore {
  constructor(private sql: postgres.Sql) {}
  async withWorkspace<T>(workspace: string, by: string, fn: (link: FinanceLink | null, save: (link: FinanceLink | null) => Promise<void>) => Promise<T>): Promise<T> {
    return await this.sql.begin(async tx => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${`workspace-finance:${workspace}`},0))`;
      const [row] = await tx`select session,sealed_secret,origin,intent from workspace_finance_links where workspace_id=${workspace}::uuid`;
      return fn(row ? { session: row.session, sealedSecret: row.sealed_secret, origin: row.origin, intent: row.intent } : null, async link => {
        if (!link) { await tx`delete from workspace_finance_links where workspace_id=${workspace}::uuid`; return; }
        await tx`insert into workspace_finance_links(workspace_id,session,sealed_secret,origin,intent,connected_by) values(${workspace}::uuid,${link.session}::uuid,${link.sealedSecret},${link.origin},${link.intent},${by}::uuid)
          on conflict(workspace_id) do update set session=excluded.session,sealed_secret=excluded.sealed_secret,origin=excluded.origin,intent=excluded.intent,connected_by=excluded.connected_by,updated_at=now()`;
      });
    }) as T;
  }
  async adoptPersonal(workspace: string, owner: string) {
    return await this.sql.begin(async tx => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${`workspace-finance:${workspace}`},0))`;
      await tx`select pg_advisory_xact_lock(hashtextextended(${`finance:${owner}`},0))`;
      if ((await tx`select 1 from workspace_finance_links where workspace_id=${workspace}::uuid`).length) return false;
      const rows = await tx`insert into workspace_finance_links(workspace_id,session,sealed_secret,origin,intent,connected_by)
        select ${workspace}::uuid,session,sealed_secret,origin,intent,${owner}::uuid from person_finance_links where user_id=${owner}::uuid returning workspace_id`;
      if (!rows.length) return false;
      await tx`delete from person_finance_links where user_id=${owner}::uuid`; return true;
    }) as boolean;
  }
  async listChats(workspace: string, session: string): Promise<FinanceChatSummary[]> {
    const rows = await this.sql`select id,title,updated_at from workspace_finance_chats where workspace_id=${workspace}::uuid and kinshi_session=${session}::uuid order by updated_at desc limit 30`;
    return rows.map(r => ({ id: String(r.id), title: String(r.title), updatedAt: new Date(r.updated_at).toISOString() }));
  }
  async getChat(workspace: string, session: string, id: string): Promise<FinanceChat | null> {
    const [r] = await this.sql`select id,title,sealed_messages,revision,updated_at from workspace_finance_chats where id=${id}::uuid and workspace_id=${workspace}::uuid and kinshi_session=${session}::uuid`;
    return r ? { id: String(r.id), title: String(r.title), messages: unseal(r.sealed_messages), revision: Number(r.revision), updatedAt: new Date(r.updated_at).toISOString() } : null;
  }
  async putChat(workspace: string, session: string, chat: FinanceChat, expectedRevision: number | null) {
    const encrypted = seal(chat.messages);
    const rows = expectedRevision === null
      ? await this.sql`insert into workspace_finance_chats(id,workspace_id,kinshi_session,title,sealed_messages,revision,updated_at) values(${chat.id}::uuid,${workspace}::uuid,${session}::uuid,${chat.title},${encrypted},${chat.revision},${chat.updatedAt}::timestamptz) on conflict do nothing returning id`
      : await this.sql`update workspace_finance_chats set title=${chat.title},sealed_messages=${encrypted},revision=${chat.revision},updated_at=${chat.updatedAt}::timestamptz where id=${chat.id}::uuid and workspace_id=${workspace}::uuid and kinshi_session=${session}::uuid and revision=${expectedRevision} returning id`;
    return rows.length === 1;
  }
  async withOwner<T>(owner: string, fn: (link: FinanceLink | null, save: (link: FinanceLink | null) => Promise<void>) => Promise<T>): Promise<T> {
    return await this.sql.begin(async tx => {
      // Serialize setup/confirmation/disconnect across API replicas, including a person's first setup.
      await tx`select pg_advisory_xact_lock(hashtextextended(${`finance:${owner}`}, 0))`;
      const [row] = await tx`select session, sealed_secret, origin, intent from person_finance_links where user_id = ${owner}`;
      return fn(row ? { session: row.session, sealedSecret: row.sealed_secret, origin: row.origin, intent: row.intent } : null, async link => {
        if (!link) { await tx`delete from person_finance_links where user_id = ${owner}`; return; }
        await tx`insert into person_finance_links (user_id, session, sealed_secret, origin, intent) values (${owner}, ${link.session}, ${link.sealedSecret}, ${link.origin}, ${link.intent})
          on conflict (user_id) do update set session = excluded.session, sealed_secret = excluded.sealed_secret, origin = excluded.origin, intent = excluded.intent, updated_at = now()`;
      });
    }) as T;
  }
}
