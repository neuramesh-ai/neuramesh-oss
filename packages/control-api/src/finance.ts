import { randomBytes } from 'node:crypto';
import type { Hono } from 'hono';
import { z } from 'zod';
import { FinanceAccountSchema, FinanceStatusSchema, type Actor } from '@neuramesh/shared';
import type { Store } from './store';
import { seal } from './connector-crypto';
import { financeAccess, financePartner, FinanceError, kinshiConfig } from './finance-gateway';
export { kinshiConfig } from './finance-gateway';

export function financeRoutes<E extends { Variables: { actor: Actor; machine?: unknown; memberId?: string } }>(app: Hono<E>, store: Store, options: { fetch?: typeof fetch } = {}) {
  const request = options.fetch ?? fetch;
  for (const action of ['status','start','confirm','disconnect','accounts','manage','migration','adopt'] as const) app.post(`/v1/finance/${action}`, async c => {
    c.header('Cache-Control','no-store');
    try {
      const input = await c.req.json().catch(() => ({}));
      const scope = z.object({ workspace: z.string().uuid() }).safeParse(input);
      if (!scope.success) return c.json({ error: 'Choose a workspace.' },400);
      const workspace = scope.data.workspace, actor = c.get('actor');
      const identity = { actor, machine: c.get('machine'), memberId: c.get('memberId') };
      const managing = !['status','accounts'].includes(action);
      await financeAccess(store, identity, workspace, managing);
      const config = kinshiConfig();
      if (!config || !store.finance) return action === 'status' ? c.json({ state:'unconfigured' }) : c.json({ error:'Kinshi Finance is not configured.' },503);
      if (action === 'migration') return c.json({ available: await store.finance.withOwner(actor.id,async link => !!link) });
      if (action === 'adopt') {
        if (input.confirm !== true) return c.json({ error:'Confirm using this Kinshi connection for workspace Finance.' },400);
        if (!await store.finance.adoptPersonal(workspace,actor.id)) return c.json({ error:'There is no connection to move, or workspace Finance is already configured.' },409);
        return c.json({ ok:true });
      }
      return await store.finance.withWorkspace(workspace,actor.id,async (link,save) => {
        const partner = financePartner(config,link,request);
        if (action === 'start') {
          const parsed = z.object({ intent:z.enum(['create','connect']) }).safeParse(input);
          if (!parsed.success) return c.json({ error:'Choose create or connect.' },400);
          if (link) {
            const status = FinanceStatusSchema.parse(await partner(`/${link.session}/status`));
            if (['connected','confirmation'].includes(status.state)) return c.json({ error:'Finish or disconnect this connection first.' },409);
            if (status.state === 'pending') return c.json({ url:`${config.origin}/neuramesh/connect/${link.session}?intent=${link.intent}` });
            await partner(`/${link.session}/revoke`);
          }
          const secret = randomBytes(32).toString('base64url');
          const result = z.object({ id:z.string().uuid() }).parse(await financePartner(config,null,request)('/setup',{ secret }));
          await save({ session:result.id,origin:config.origin,sealedSecret:seal(secret),intent:parsed.data.intent });
          return c.json({ url:`${config.origin}/neuramesh/connect/${result.id}?intent=${parsed.data.intent}` });
        }
        if (!link) return action === 'accounts' || action === 'manage' ? c.json({ error:'Connect Kinshi first.' },409) : c.json(action === 'disconnect' ? { ok:true } : { state:'disconnected' });
        if (action === 'manage') return c.json({ url:`${config.origin}/neuramesh/connect/${link.session}?intent=connect&manage=1` });
        if (action === 'disconnect') { await partner(`/${link.session}/revoke`); await save(null); return c.json({ ok:true }); }
        if (action === 'confirm') {
          const parsed = z.object({ identity:z.string().min(1).max(128) }).safeParse(input);
          if (!parsed.success) return c.json({ error:'Confirm the Kinshi identity shown.' },400);
          return c.json(FinanceStatusSchema.parse(await partner(`/${link.session}/activate`,parsed.data)));
        }
        const status = FinanceStatusSchema.parse(await partner(`/${link.session}/status`));
        if (action === 'accounts') {
          if (status.state !== 'connected') return c.json({ error:'Confirm an active Kinshi connection first.' },409);
          const accounts = z.object({ accounts:z.array(FinanceAccountSchema).max(1000) }).parse(await partner(`/${link.session}/accounts`));
          await financeAccess(store,identity,workspace);
          return c.json(accounts);
        }
        await financeAccess(store,identity,workspace);
        return c.json(status);
      });
    } catch (error) {
      if (error instanceof FinanceError) return c.json({ error:error.message,code:error.code },error.status);
      console.error('finance_request_failed',{ action,kind:error instanceof Error ? error.name:'unknown' });
      return c.json({ error:'Finance is temporarily unavailable. Your connection has been kept; try again.' },502);
    }
  });
}
