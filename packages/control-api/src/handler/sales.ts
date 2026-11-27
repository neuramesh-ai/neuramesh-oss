// The Sales pipeline verbs (docs/design/inbox-sales-2026-11/plan.md S1, round 5). A person with Sales access or an
// agent with the Sales grant writes contacts and deals. The check is the destination's own (destinationPermission),
// so an agent never borrows its machine owner's access, and a Local connection never serves Sales at all.
import { SALES_ADD_CAP, type Actor, type CheckedLead } from '@neuramesh/shared';
import { checkAddresses } from '../address-check';
import { advanceSalesSetup, openSalesRun } from '../sales-setup-run';
import type { Command } from '../commands';
import { DomainError } from '../errors';
import { localMode } from '../localmode';
import type { Store } from '../store';
import { destinationPermission } from '../store/destinations';
import { salesOf, type Writer } from '../store/sales';
import type { CommandOutcome } from '../handler';

type SalesCommand = Extract<Command, { type: 'sales.upsert_contact' | 'sales.add_contacts' | 'sales.upsert_deal' | 'sales.move_deal' | 'sales.add_leads' }>;
const isSales = (c: Command): c is SalesCommand => c.type.startsWith('sales.');

const writer = (actor: Actor): Writer => {
  if (actor.kind !== 'agent' && actor.kind !== 'human') throw new DomainError('NOT_PERMITTED', 'a person or an agent writes in Sales');
  return { kind: actor.kind, id: actor.id };
};

/** refuses anyone who cannot open Sales in this workspace: the owner, the people the owner adds, and agents with the grant */
export async function assertSalesAccess(store: Store, actor: Actor, workspace: string): Promise<void> {
  if (localMode()) throw new DomainError('NOT_PERMITTED', 'Sales is on the hosted plans only');
  writer(actor);
  if (!store.destinations) throw new DomainError('AUTH_UNAVAILABLE', 'Sales access is unavailable, try again');
  const access = await destinationPermission(store.destinations, actor, workspace, 'sales');
  if (!access.canView) throw new DomainError('NOT_PERMITTED', actor.kind === 'agent' ? 'this agent has no Sales access. The workspace owner adds it in Sales' : 'you have no Sales access. Ask the workspace owner');
}

export async function salesCommands(store: Store, actor: Actor, cmd: Command): Promise<CommandOutcome | undefined> {
  if (!isSales(cmd)) return undefined;
  await assertSalesAccess(store, actor, cmd.workspace);
  const by = writer(actor);
  const sales = salesOf(store);
  if (cmd.type === 'sales.upsert_contact') {
    if (!cmd.contact && !cmd.email) throw new DomainError('INVALID_INPUT', 'name the contact, or give its email address');
    const out = await sales.upsertContact(cmd.workspace, cmd, by.kind === 'agent' ? 'agent' : 'human', by);
    return { ok: true, ...out } as never;
  }
  if (cmd.type === 'sales.add_contacts') {
    // the person's own pick from their own mail: an agent adds one contact at a time, with upsert_contact
    if (actor.kind !== 'human') throw new DomainError('HUMAN_ONLY', 'only a person brings in contacts from their own mail');
    const people = [...new Map(cmd.contacts.map((p) => [p.email, p])).values()].slice(0, SALES_ADD_CAP);
    return { ok: true, ...(await sales.addContacts(cmd.workspace, people, by)) } as never;
  }
  if (cmd.type === 'sales.add_leads') {
    // the review card's Add (SO12): pike proposes, and only a person adds. The address check runs here again, so a
    // card cannot carry a check that the server did not make
    if (actor.kind !== 'human') throw new DomainError('HUMAN_ONLY', 'only a person adds leads. Propose them with propose_leads');
    const checks = await checkAddresses(cmd.leads.flatMap((l) => (l.email ? [l.email] : [])));
    const leads: CheckedLead[] = cmd.leads.map((l) => ({ ...l, check: l.email ? checks.get(l.email) ?? 'risky' : 'none', dup: null }));
    const results = await sales.addLeads(cmd.workspace, leads, await openSalesRun(store, cmd.workspace), by);
    await advanceSalesSetup(store, cmd.workspace);
    return { ok: true, results, added: results.filter((r) => r.outcome === 'added').length } as never;
  }
  if (cmd.type === 'sales.upsert_deal') {
    const { type: _t, workspace, ...input } = cmd;
    return { ok: true, ...(await sales.upsertDeal(workspace, input, by)) } as never;
  }
  const deal = await sales.moveDeal(cmd.workspace, cmd.deal, cmd.stage, by);
  return { ok: true, deal: deal.id, stage: deal.stage } as never;
}
