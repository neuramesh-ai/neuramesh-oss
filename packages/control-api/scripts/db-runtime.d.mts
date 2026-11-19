import type postgres from 'postgres';
export function bootstrapRuntimeRole(sql: postgres.Sql, user?: string, role?: string): Promise<void>;
export function bootstrapBoardsRole(sql: postgres.Sql | postgres.TransactionSql, role?: string, user?: string): Promise<{ role: string; user: string; granted: boolean; login: 'absent' | 'narrowed' | 'ready' }>;
export function grantRuntimeData(sql: postgres.Sql, role?: string): Promise<void>;
export function assertRuntimeRole(sql: postgres.Sql): Promise<void>;
