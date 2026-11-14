import type { Actor } from '@neuramesh/shared';
import { createHmac } from 'node:crypto';
import { FinanceBudgetDraftSchema, FinanceBudgetProposalSchema, FinanceQuerySchema, FinanceSnapshotSchema } from '@neuramesh/shared';
import type { Hono } from 'hono';
import { z } from 'zod';
import type { Store } from './store';
import { activeFinance, financeAccess, FinanceError, kinshiConfig } from './finance-gateway';
export function financeWorkspaceRoutes<E extends { Variables: { actor: Actor; machine?: unknown; memberId?: string } }>(app: Hono<E>, store: Store, options: { fetch?: typeof fetch } = {}) {
  for (const action of ['overview','refresh','budget-prepare','budget-commit','budget-dismiss'] as const) app.post(`/v1/finance/${action}`,async c => {
    c.header('Cache-Control','no-store');
    try {
      const input = await c.req.json().catch(() => null);
      const scope = z.object({ workspace:z.string().uuid() }).safeParse(input);
      if (!scope.success) return c.json({ error:'Choose a workspace.' },400);
      const identity = { actor:c.get('actor'),machine:c.get('machine'),memberId:c.get('memberId') };
      if (action.startsWith('budget-')) await financeAccess(store,identity,scope.data.workspace,true);
      if (action === 'refresh' && identity.actor.kind !== 'human') return c.json({ error:'Bank refresh is started by a person.' },403);
      let body: unknown;
      if (action === 'overview') body = FinanceQuerySchema.parse(input);
      else if (action === 'budget-prepare') body = FinanceBudgetDraftSchema.parse(input);
      else if (action.startsWith('budget-')) body = z.object({ proposalId:z.string().uuid() }).parse(input);
      else body = {};
      const ctx = await activeFinance(store,identity,scope.data.workspace,options.fetch);
      // Only this owner-authenticated human route can sign a budget confirmation.
      // Model generation and agent reads never receive this capability.
      const approval = action === 'budget-commit' ? createHmac('sha256',kinshiConfig()!.key).update(`budget-commit\n${ctx.link.session}\n${(body as { proposalId:string }).proposalId}`).digest('hex') : undefined;
      const result = await ctx.partner(`/${ctx.link.session}/${action}`,body,action === 'refresh' ? 120_000 : 15_000,approval);
      await ctx.recheck();
      if (action === 'overview') return c.json(FinanceSnapshotSchema.parse(result));
      if (action === 'refresh') return c.json(z.object({ ok:z.literal(true),transactionsAt:z.string().datetime().nullable(),warnings:z.array(z.string()) }).parse(result));
      return c.json(FinanceBudgetProposalSchema.parse(result));
    } catch (error) {
      if (error instanceof FinanceError) return c.json({ error:error.message,code:error.code },error.status);
      if (error instanceof z.ZodError) return c.json({ error:'Finance received invalid values. Refresh and review your inputs.',code:'INVALID_INPUT' },400);
      console.error('finance_workspace_failed',{ action,kind:error instanceof Error ? error.name:'unknown' });
      return c.json({ error:'Finance could not complete the request. Try again.' },502);
    }
  });
}
