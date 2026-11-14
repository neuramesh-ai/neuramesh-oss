// WHICH WORKSPACE OWNS THIS ROW? (R10 lane A, NM-002/NM-004/NM-012). The command scope guard
// (handler/scope.ts) names every row a command addresses by id, and this answers, for each one, the
// workspace it lives in. One table per kind, fixed here: the guard never builds SQL from a field name.
import type postgres from 'postgres';

/** a row kind → the table whose `workspace_id` owns it. Every id column here is a uuid except the
 *  custom brains (`custom:<uuid>`), so a value that is not one can name no row of that kind. */
export const SCOPE_TABLES = {
  task: 'tasks', channel: 'channels', project: 'projects', agent: 'agents', schedule: 'schedules',
  skill: 'skills', skillpack: 'skill_packs', modelpack: 'custom_model_packs', content: 'content_items',
  artifact: 'artifacts', whiteboard: 'whiteboards', connector: 'connectors', fact: 'facts', message: 'messages',
  reminder: 'reply_reminders', run: 'runs', decision: 'decisions', policy: 'policies', thread: 'threads',
  machine: 'machines', repo: 'repos', code_session: 'code_sessions', invite: 'workspace_invites',
} as const;
export type ScopeKind = keyof typeof SCOPE_TABLES;
export interface ScopeRef { kind: ScopeKind; id: string }

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TEXT_IDS = new Set<ScopeKind>(['modelpack']);

/** a uuid in any form PostgreSQL reads (no hyphens, braces, a hyphen after any group of four digits,
 *  either case) → its standard lower-case form. null = not a uuid in any form. THE GUARD MUST READ AN ID
 *  AS THE DATABASE DOES: a form the guard took for "no such row" while `${id}::uuid` in the store named
 *  a real one let a command write a foreign row (the security lane's review, 2026-11-13). */
export function canonicalUuid(id: string): string | null {
  const hex = id.trim().replace(/^\{(.*)\}$/, '$1').replace(/-/g, '');
  if (!/^[0-9a-f]{32}$/i.test(hex)) return null;
  const h = hex.toLowerCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
/** a uuid, but not in the standard form: the guards refuse it, so no later code meets two spellings of one row */
export const looseUuid = (id: string): boolean => !UUID.test(id) && canonicalUuid(id) !== null;

/** may this value name a row of this kind at all? (a slug or a name never names a uuid row) */
export function scopeIdShape(kind: ScopeKind, id: string): boolean {
  return TEXT_IDS.has(kind) ? id.length > 0 : canonicalUuid(id) !== null;
}

/** each ref's owning workspace, null when no such row exists. A database error THROWS: the guard
 *  that asked must fail closed on it, never read it as "no row". */
export async function scopeWorkspaces(sql: postgres.Sql, refs: ScopeRef[]): Promise<Array<string | null>> {
  return Promise.all(refs.map(async ({ kind, id }) => {
    if (!scopeIdShape(kind, id)) return null;
    const table = SCOPE_TABLES[kind];
    const rows = TEXT_IDS.has(kind)
      ? await sql`select workspace_id::text as w from ${sql(table)} where id = ${id}`
      : await sql`select workspace_id::text as w from ${sql(table)} where id = ${canonicalUuid(id)}::uuid`;
    return (rows[0]?.['w'] as string | undefined) ?? null;
  }));
}

/** the agent's home workspace and its role, from the row (never from a header) */
export async function agentHome(sql: postgres.Sql, agentId: string): Promise<{ workspace: string; role: string | null } | null> {
  if (!UUID.test(agentId)) return null;
  const [a] = await sql`select workspace_id::text as w, role from agents where id = ${agentId}::uuid`;
  return a ? { workspace: a['w'] as string, role: (a['role'] as string | null) ?? null } : null;
}
