// The public face of control-api's private Finance entry (docs/43 §2, scripts/public-tree.sh
// PUBLIC_STUBS). This build has no Finance: no /v1/finance route, and the stores keep nothing.
// The Finance migrations stay public, because Local mode runs every migration in order.
import type { Hono } from 'hono';
import type postgres from 'postgres';
import type { Actor } from '@neuramesh/shared';
import type { Store } from './store';

type FinanceEnv = { Variables: { actor: Actor; machine?: unknown; memberId?: string } };
type FinanceRoutes = <E extends FinanceEnv>(app: Hono<E>, store: Store, options?: { fetch?: typeof fetch }) => void;

export const financeRoutes: FinanceRoutes = () => {};
export const financeWorkspaceRoutes: FinanceRoutes = () => {};
export const financeChatRoutes: FinanceRoutes = () => {};

/** this build stores no Finance state */
export type FinanceStore = Record<never, never>;
export class MemFinanceStore implements FinanceStore {}
export class PgFinanceStore implements FinanceStore {
  constructor(_sql: postgres.Sql) {}
}
