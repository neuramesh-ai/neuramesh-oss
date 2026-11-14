import { FinanceStatusSchema, type Actor } from '@neuramesh/shared';
import type { Store } from './store';
import type { FinanceLink } from './store/finance';
import { destinationPermission } from './store/destinations';
import { unseal } from './connector-crypto';
export class FinanceError extends Error {
  constructor(message: string, readonly status: 400 | 402 | 403 | 404 | 409 | 502 | 503 = 502, readonly code = 'FINANCE_UNAVAILABLE') { super(message); }
}
export function kinshiConfig() {
  const raw = process.env.NM_KINSHI_ORIGIN, key = process.env.NM_KINSHI_PARTNER_SECRET;
  if (!raw || !key || key.length < 32 || (process.env.NM_CONNECTOR_KEY?.length ?? 0) < 32) return null;
  try {
    const u = new URL(raw);
    if ((u.protocol !== 'https:' && !(u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname))) || u.username || u.password || u.pathname !== '/' || u.search || u.hash) return null;
    return { origin: u.origin, key };
  } catch { return null; }
}
export type FinanceIdentity = { actor: Actor; machine?: unknown; memberId?: string };
export async function financeAccess(store: Store, identity: FinanceIdentity, workspace: string, manage = false) {
  if (!store.destinations) throw new FinanceError('Finance access is unavailable.', 503);
  if (identity.machine && identity.actor.kind === 'human') throw new FinanceError('Sign in as a person, or use an explicitly authorized Finance agent.', 403, 'NOT_PERMITTED');
  const access = await destinationPermission(store.destinations, identity.actor, workspace, 'finance');
  if (identity.memberId && identity.actor.kind === 'agent') {
    const caller = await destinationPermission(store.destinations, { kind: 'human', id: identity.memberId }, workspace, 'finance');
    if (!caller.canView) throw new FinanceError('You do not have access to Finance.', 403, 'NOT_PERMITTED');
  }
  if (!access.canView || (manage && (!access.canManage || identity.actor.kind !== 'human' || identity.machine))) throw new FinanceError(manage ? 'Only the workspace owner can manage Finance.' : 'Ask the workspace owner to add you to Finance.', 403, 'NOT_PERMITTED');
  return access;
}
export function financePartner(config: NonNullable<ReturnType<typeof kinshiConfig>>, link: FinanceLink | null, request: typeof fetch = fetch) {
  return async (path: string, body: unknown = {}, timeout = 15_000, approval?: string): Promise<unknown> => {
    if (link && link.origin !== config.origin) throw new FinanceError('The Kinshi address changed. Reconnect Finance.', 409);
    const response = await request(`${config.origin}/api/partners/neuramesh${path}`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeout),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.key}`, ...(link ? { 'X-Kinshi-Session': unseal<string>(link.sealedSecret) } : {}), ...(approval ? { 'X-Kinshi-Approval': approval } : {}) }, body: JSON.stringify(body),
    });
    if (!response.ok) {
      if (response.status === 403) throw new FinanceError('Review the Finance permissions in Kinshi to use this feature.', 403, 'KINSHI_PERMISSION_REQUIRED');
      if (response.status === 409) throw new FinanceError('This connection or change needs review. Refresh Finance and try again.', 409, 'FINANCE_CONFLICT');
      if (response.status === 400) throw new FinanceError('Kinshi could not accept these values. Review the form and try again.', 400, 'INVALID_INPUT');
      throw new FinanceError('Kinshi is temporarily unavailable. Your connection has been kept.', 502);
    }
    return response.json();
  };
}
export async function activeFinance(store: Store, identity: FinanceIdentity, workspace: string, request: typeof fetch = fetch) {
  const access = await financeAccess(store, identity, workspace);
  const config = kinshiConfig();
  if (!config || !store.finance) throw new FinanceError('Kinshi Finance is not configured.', 503);
  const link = await store.finance.withWorkspace(workspace, identity.actor.id, async value => value);
  if (!link) throw new FinanceError('Connect Kinshi to this workspace first.', 409, 'CONNECTION_REQUIRED');
  const partner = financePartner(config, link, request);
  const status = FinanceStatusSchema.parse(await partner(`/${link.session}/status`));
  if (status.state !== 'connected') throw new FinanceError('Confirm an active workspace Kinshi connection first.', 409, 'CONNECTION_REQUIRED');
  if (status.consentRevision === undefined) throw new FinanceError('Kinshi Finance needs an update before data can be shared. Please try again later.',503,'KINSHI_UPDATE_REQUIRED');
  const recheck = async () => {
    await financeAccess(store, identity, workspace);
    const current = await store.finance!.withWorkspace(workspace, identity.actor.id, async value => value);
    const latest=FinanceStatusSchema.parse(await partner(`/${link.session}/status`));
    if (current?.session !== link.session || latest.state !== 'connected' || latest.consentRevision!==status.consentRevision) throw new FinanceError('Finance access changed during this request.', 403, 'NOT_PERMITTED');
  };
  return { access, link, status, partner, recheck };
}
