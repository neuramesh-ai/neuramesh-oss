// THE PIPELINE READ FOR AN AGENT (docs/design/inbox-sales-2026-11/plan.md S2). The replica gives the pipeline's rows
// only to a person with Sales access (local-sync-scope.ts), so the sales agent reads them here, on its own grant:
// the machine's owner may have access that the agent does not, and an agent never borrows it.
import { LeadDraftSchema, SALES_LEADS_MAX, leadDuplicate, type Actor, type CheckedLead } from '@neuramesh/shared';
import { z } from 'zod';
import { checkAddresses } from './address-check';
import { salesSetupView } from './sales-setup-run';
import type { Hono } from 'hono';
import { DomainError } from './errors';
import { assertSalesAccess } from './handler/sales';
import { localMode } from './localmode';
import type { Store } from './store';
import { salesOf } from './store/sales';
import { UUID } from './store/scope-rows';

export function salesRoutes<E extends { Variables: { actor: Actor; machine?: unknown } }>(app: Hono<E>, store: Store): void {
  app.get('/v1/sales', async (c) => {
    c.header('Cache-Control', 'no-store');
    if (localMode()) return c.json({ error: 'not found', code: 'NOT_FOUND' }, 404);
    const workspace = c.req.query('workspace') ?? '';
    if (!UUID.test(workspace)) return c.json({ error: 'Name a workspace.', code: 'BAD_REQUEST' }, 400);
    const actor = c.get('actor');
    const machine = c.get('machine') as { workspaceId?: string } | undefined;
    // a machine reads as one of its agents, never as its owner, and only inside its own workspace
    if (machine && (actor.kind !== 'agent' || machine.workspaceId !== workspace)) return c.json({ error: 'An agent reads Sales with its own grant.', code: 'NOT_PERMITTED' }, 403);
    try {
      await assertSalesAccess(store, actor, workspace);
    } catch (e) {
      if (e instanceof DomainError) return c.json({ error: e.message, code: e.code }, 403);
      throw e;
    }
    const sales = salesOf(store);
    const [contacts, deals, setup] = await Promise.all([sales.contacts(workspace), sales.deals(workspace), salesSetupView(store, workspace)]);
    // Sales setup: the company's answers and the run, so the sales agent reads the offer, the customer and the skips
    return c.json({ contacts, deals, setup });
  });

  // the gate of both routes below: a person with Sales access, or an agent on its own grant inside its own workspace
  const gate = async (c: { get: (k: 'actor' | 'machine') => unknown }, workspace: string): Promise<{ error: string; code: string; status: 400 | 403 | 404 } | null> => {
    if (localMode()) return { error: 'not found', code: 'NOT_FOUND', status: 404 };
    if (!UUID.test(workspace)) return { error: 'Name a workspace.', code: 'BAD_REQUEST', status: 400 };
    const actor = c.get('actor') as Actor, machine = c.get('machine') as { workspaceId?: string } | undefined;
    if (machine && (actor.kind !== 'agent' || machine.workspaceId !== workspace)) return { error: 'An agent reads Sales with its own grant.', code: 'NOT_PERMITTED', status: 403 };
    try { await assertSalesAccess(store, actor, workspace); } catch (e) {
      if (e instanceof DomainError) return { error: e.message, code: e.code, status: 403 };
      throw e;
    }
    return null;
  };

  // SALES SETUP (docs/design/sales-onboarding-2026-11 SO6): the run, where it stands for the person who asks (the Gmail
  // step reads their own mail link), and the company's answers. Not synced: hq asks again after each change
  app.get('/v1/sales/setup', async (c) => {
    c.header('Cache-Control', 'no-store');
    const workspace = c.req.query('workspace') ?? '';
    const no = await gate(c, workspace);
    if (no) return c.json({ error: no.error, code: no.code }, no.status);
    return c.json(await salesSetupView(store, workspace));
  });

  // the address check and the duplicates of a lead list (SO11, SO12): what the review card shows before Add. pike's
  // propose_leads calls it before it posts the card, and hq calls it for a pasted list. It stores nothing
  const CheckBody = z.object({ workspace: z.string(), leads: z.array(LeadDraftSchema).min(1).max(SALES_LEADS_MAX) });
  app.post('/v1/sales/leads/check', async (c) => {
    const body = CheckBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'Send a workspace and up to 100 leads, each with a company.', code: 'BAD_REQUEST', issues: body.error.issues }, 400);
    const no = await gate(c, body.data.workspace);
    if (no) return c.json({ error: no.error, code: no.code }, no.status);
    const sales = salesOf(store);
    const [contacts, deals, checks] = await Promise.all([sales.contacts(body.data.workspace), sales.deals(body.data.workspace), checkAddresses(body.data.leads.flatMap((l) => (l.email ? [l.email] : [])))]);
    const leads: CheckedLead[] = body.data.leads.map((l) => ({ ...l, check: l.email ? checks.get(l.email) ?? 'risky' : 'none', dup: leadDuplicate(l, contacts, deals) }));
    return c.json({ leads });
  });
}
