// THE SALES TOOLS (docs/design/inbox-sales-2026-11/plan.md S1 to S3, round 5): the sales agent keeps the pipeline. It
// reads the deals and contacts, writes them, and moves a deal to another stage. Outreach is draft_emails with a
// `deal` on each email (host/tools-email.ts): the card in the session, and only the person sends it.
//
// The pipeline is not in this machine's replica: its rows reach only a person with Sales access. So list_deals reads
// GET /v1/sales as this agent, and the server checks the agent's own Sales grant. Every write is a command that the
// server checks the same way, so an agent without the grant cannot touch the pipeline, whatever it is told.
import { DO_NOT_CONTACT, FIRST_NOTE_OPT_OUT, SALES_STAGES, SALES_STAGE_LABEL, customerLine, dealNeedsMove, localDay, salesDay, salesMoney, setupBlock, type CheckedLead, type CompanyCustomer, type CompanyOffer, type SalesContactRow, type SalesDealRow, type SalesStage } from '@neuramesh/shared';
import type { OrchTool, ToolCtx } from './orchtools';

export type SalesToolCtx = Pick<ToolCtx, 'z' | 'post' | 'log'> & {
  ch: { id: string; workspace_id: string };
  /** the session this turn answers: Sales setup's cards land in it */
  convoThreadId?: string | null;
  actor: { kind: string; id: string; role?: string };
  apiGet: (path: string, actor: { kind: string; id: string; role?: string }) => Promise<Response>;
};

/** one deal as one line the agent reads: its id, where it stands, and what it needs */
export function dealLine(d: SalesDealRow, contact: SalesContactRow | undefined, today: string): string {
  const next = d.next_step ? `${d.next_step}${d.next_date ? ` · ${salesDay(d.next_date)}` : ''}` : 'no next step';
  const move = dealNeedsMove(d, today);
  const who = contact ? ` · ${contact.name || contact.email} <${contact.email}>` : '';
  return `- ${d.id} · ${d.title} · ${d.company || 'no company'} · ${SALES_STAGE_LABEL[d.stage as SalesStage] ?? d.stage} · ${salesMoney(d.value_year, d.currency)} a year · next: ${next}${who}${move === 'late' ? ' · LATE' : ''}${d.thread_id ? ` · session ${d.thread_id}` : ''}`;
}

/** the company and Sales setup as list_deals opens: what pike writes from, and the steps the person skipped */
function companyNote(setup: { run: { skipped: string[]; completed_at: string | null; ended_at: string | null } | null; state: { now: string | null; reachable: number; bar: number } | null; profile: { website: string; offer: CompanyOffer | null; customer: CompanyCustomer | null } } | undefined): string {
  if (!setup) return '';
  const p = setup.profile, lines: string[] = [];
  if (p.offer?.sells) lines.push(`The company sells: ${p.offer.sells}${p.offer.buyers ? ` Buyers: ${p.offer.buyers}` : ''}${p.offer.why ? ` Why they buy: ${p.offer.why}` : ''}${p.website ? ` (${p.website})` : ''}`);
  if (p.customer) lines.push(`The customer: ${customerLine(p.customer)}${p.customer.places.length ? `, in ${p.customer.places.join(', ')}` : ''}${p.customer.signs.length ? `. Signs: ${p.customer.signs.join(', ')}` : ''}${p.customer.like.length ? `. Like: ${p.customer.like.join(', ')}` : ''}`);
  const run = setup.run, st = setup.state;
  if (run && st && !run.completed_at && !run.ended_at) lines.push(`Sales setup is open: the step now is ${st.now ?? 'none'}, ${st.reachable} of ${st.bar} leads a note can reach.${run.skipped.length ? ` The person skipped: ${run.skipped.join(', ')}. Do not ask for those again.` : ''}`);
  else if (run?.skipped.length) lines.push(`The person skipped these setup steps: ${run.skipped.join(', ')}. Do not ask for them again.`);
  lines.push(`Rules: end each first note to a new person with this line, word for word: "${FIRST_NOTE_OPT_OUT}" When a contact says no, move the deal to lost with the next step "${DO_NOT_CONTACT}", and never write to them again.`);
  return lines.join('\n');
}

export function salesTools(tc: SalesToolCtx): OrchTool[] {
  const { z, post, ch, actor, apiGet, log, convoThreadId } = tc;
  const workspace = ch.workspace_id;
  type SetupRead = { run: { skipped: string[]; completed_at: string | null; ended_at: string | null } | null; state: { now: string | null; reachable: number; bar: number } | null; profile: { website: string; offer: CompanyOffer | null; customer: CompanyCustomer | null } };
  const read = async (): Promise<{ contacts: SalesContactRow[]; deals: SalesDealRow[]; setup?: SetupRead } | string> => {
    const res = await apiGet(`/v1/sales?workspace=${workspace}`, actor).catch(() => null);
    if (!res?.ok) return `Sales did not answer: ${((await res?.json().catch(() => null)) as { error?: string } | null)?.error ?? 'the server did not answer'}. Say so plainly.`;
    return res.json() as Promise<{ contacts: SalesContactRow[]; deals: SalesDealRow[]; setup?: SetupRead }>;
  };
  const send = async (cmd: Record<string, unknown>): Promise<{ ok: true; out: Record<string, unknown> } | { ok: false; error: string }> => {
    const res = await post('/v1/commands', actor, { workspace, ...cmd }).catch(() => null);
    const out = (await res?.json().catch(() => ({}))) as Record<string, unknown>;
    return res?.ok ? { ok: true, out } : { ok: false, error: String(out?.['error'] ?? 'the server did not answer') };
  };
  const stage = z.enum(SALES_STAGES).describe('lead, talked, trial, proposal, won or lost');
  return [
    { name: 'list_deals', description: 'Read the Sales pipeline: every deal with its id, stage, value a year, next step and contact, then the contacts with no deal. Read it before you answer about deals, move one, or draft outreach, and use the ids it gives. LATE marks a next step past its date.', schema: {
      stage: stage.optional().describe('only the deals in this stage'),
      query: z.string().max(120).optional().describe('only deals or contacts whose name, company or email has these words'),
    }, run: async (input: { stage?: SalesStage; query?: string }) => {
      const got = await read();
      if (typeof got === 'string') return got;
      const q = input.query?.trim().toLowerCase();
      const byId = new Map(got.contacts.map((c) => [c.id, c]));
      const hit = (...s: Array<string | undefined>) => !q || s.some((x) => x?.toLowerCase().includes(q));
      const deals = got.deals.filter((d) => (!input.stage || d.stage === input.stage) && hit(d.title, d.company, byId.get(d.contact_id ?? '')?.name, byId.get(d.contact_id ?? '')?.email));
      const withDeal = new Set(got.deals.map((d) => d.contact_id));
      const loose = got.contacts.filter((c) => !withDeal.has(c.id) && hit(c.name, c.company, c.email));
      const today = localDay(new Date());
      return [
        input.stage || input.query ? '' : companyNote(got.setup),
        deals.length ? `Deals (${deals.length}):\n${deals.map((d) => dealLine(d, byId.get(d.contact_id ?? ''), today)).join('\n')}` : 'No deal matches.',
        input.stage ? '' : loose.length ? `Contacts with no deal (${loose.length}):\n${loose.slice(0, 60).map((c) => `- ${c.id} · ${c.name || c.email} <${c.email}> · ${c.company || 'no company'}`).join('\n')}` : '',
      ].filter(Boolean).join('\n\n');
    } },
    { name: 'upsert_contact', description: 'Add a contact to Sales, or change one: `contact` names a contact from list_deals, else the email address finds the contact or makes it. Only an address the person gave or that you read, never a guess.', schema: {
      contact: z.string().uuid().optional(), name: z.string().max(120).optional(),
      email: z.string().max(320).optional(), company: z.string().max(120).optional(),
    }, run: async (input: { contact?: string; name?: string; email?: string; company?: string }) => {
      const r = await send({ type: 'sales.upsert_contact', ...input });
      if (!r.ok) return `The contact was not saved: ${r.error}.`;
      log?.({ kind: 'tool', phase: 'call', summary: `upsert_contact — ${input.email ?? input.contact}` });
      return `${r.out['created'] ? 'Added' : 'Changed'} the contact ${r.out['contact']}.`;
    } },
    { name: 'upsert_deal', description: 'Add a deal, or change one by `deal` id from list_deals. A new deal needs a title (what is sold, e.g. "Annual plan, 8 seats"). Give the contact by `contactEmail` (and `contactName`): the tool finds or adds the contact. `value` is the value a year in whole units. `nextStep` and `nextDate` (YYYY-MM-DD) say what happens next. When the person says yes to Lead deals for new contacts, make one Lead deal for each.', schema: {
      deal: z.string().uuid().optional(), title: z.string().max(200).optional(), company: z.string().max(120).optional(), stage: stage.optional(),
      value: z.number().int().min(0).optional(), nextStep: z.string().max(200).optional(), nextDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      contactEmail: z.string().max(320).optional(), contactName: z.string().max(120).optional(),
    }, run: async (input: { deal?: string; title?: string; company?: string; stage?: SalesStage; value?: number; nextStep?: string; nextDate?: string | null; contactEmail?: string; contactName?: string }) => {
      const { contactEmail, contactName, ...deal } = input;
      let contact: string | undefined;
      if (contactEmail) {
        const c = await send({ type: 'sales.upsert_contact', email: contactEmail.trim().toLowerCase(), ...(contactName ? { name: contactName } : {}), ...(input.company ? { company: input.company } : {}) });
        if (!c.ok) return `The contact was not saved, so the deal was not either: ${c.error}.`;
        contact = String(c.out['contact']);
      }
      const r = await send({ type: 'sales.upsert_deal', ...deal, ...(contact ? { contact } : {}) });
      if (!r.ok) return `The deal was not saved: ${r.error}.`;
      log?.({ kind: 'tool', phase: 'call', summary: `upsert_deal — ${input.title ?? input.deal}` });
      return `${r.out['created'] ? 'Added' : 'Changed'} the deal ${r.out['deal']}. It shows on the Sales canvas now: say in one line what you did.`;
    } },
    { name: 'move_deal', description: 'Move a deal to another stage, by its id from list_deals. The board shows that you moved it. Move a deal on the person\'s word or on clear facts (a signed order is Won), and say why in your reply.', schema: {
      deal: z.string().uuid(), stage,
    }, run: async (input: { deal: string; stage: SalesStage }) => {
      const r = await send({ type: 'sales.move_deal', deal: input.deal, stage: input.stage });
      if (!r.ok) return `The deal did not move: ${r.error}.`;
      log?.({ kind: 'tool', phase: 'call', summary: `move_deal — ${SALES_STAGE_LABEL[input.stage]}` });
      return `Moved the deal to ${SALES_STAGE_LABEL[input.stage]}.`;
    } },
    // SALES SETUP (docs/design/sales-onboarding-2026-11 SO3): the cards of the Set up Sales session. Only these tools
    // post them (setupCard), so the server drops a card an agent writes into a reply. The person saves or adds
    { name: 'propose_company', description: 'Sales setup, step 1. After you read the person\'s website (open its home, product and pricing pages), post what the company sells, who buys it and why, as the company card. The person edits it and saves it. Each part is one or two plain sentences from the site, never a guess.', schema: {
      website: z.string().max(400), sells: z.string().min(1).max(400), buyers: z.string().max(400), why: z.string().max(400),
      note: z.string().max(400).describe('one line to the person above the card, for example how many pages you read'),
    }, run: (i: { website: string; sells: string; buyers: string; why: string; note: string }) => card(i.note, setupBlock({ kind: 'company', website: i.website.trim(), offer: { sells: i.sells.trim(), buyers: i.buyers.trim(), why: i.why.trim() } }), 'propose_company') },
    { name: 'propose_customer', description: 'Sales setup, step 2. Post who buys from the company as the customer card of chips: industries, company sizes, roles, places, signs that a company needs the product now, and customers like the ones they want (a domain or a name). Work from the company the person saved (list_deals shows it). Each chip is two to five words. The person removes and adds chips, then saves.', schema: {
      industries: z.array(z.string().max(80)).max(8), sizes: z.array(z.string().max(80)).max(4), roles: z.array(z.string().max(80)).max(8),
      places: z.array(z.string().max(80)).max(8), signs: z.array(z.string().max(80)).max(6), like: z.array(z.string().max(80)).max(6),
      note: z.string().max(400).describe('one line to the person above the card'),
    }, run: (i: CompanyCustomer & { note: string }) => card(i.note, setupBlock({ kind: 'customer', customer: { industries: i.industries, sizes: i.sizes, roles: i.roles, places: i.places, signs: i.signs, like: i.like } }), 'propose_customer') },
    { name: 'propose_leads', description: 'Sales setup, step 4. Post the leads you found as the review card, where the person picks the ones to add. A lead is a company that fits the customer, with a named person when you found one. Give an email only when you read it on a public page or in the person\'s own mail, never a guessed pattern. Say in `fit` why it fits, in one line with a fact (a job post, a size, a place). Give `sourceUrl` for each web lead. The API checks each address and marks the people and companies Sales holds already. Post 3 to 10 leads at once.', schema: {
      leads: z.array(z.object({
        name: z.string().max(120).default(''), email: z.string().max(320).optional(), title: z.string().max(120).default(''), company: z.string().min(1).max(120),
        fit: z.string().max(280), source: z.enum(['gmail', 'web']), sourceUrl: z.string().max(500).optional(),
      })).min(1).max(20),
      note: z.string().max(400).describe('one line to the person above the card, for example how many you found and from where'),
    }, run: async (i: { leads: Array<Omit<CheckedLead, 'check' | 'dup'>>; note: string }) => {
      const res = await post('/v1/sales/leads/check', actor, { workspace, leads: i.leads.map((l) => ({ ...l, email: l.email?.trim().toLowerCase() || undefined })) }).catch(() => null);
      const out = (await res?.json().catch(() => null)) as { leads?: CheckedLead[]; error?: string } | null;
      if (!res?.ok || !out?.leads) return `The leads were not checked: ${out?.error ?? 'the server did not answer'}. Try once more, then say so plainly.`;
      return card(i.note, setupBlock({ kind: 'leads', leads: out.leads }), `propose_leads ${out.leads.length}`);
    } },
  ];

  async function card(note: string, block: string, what: string): Promise<string> {
    if (!convoThreadId) return 'This card belongs in the Set up Sales session. Say what you found in words instead.';
    const res = await post('/v1/messages', actor, { workspace, channel: ch.id, threadId: convoThreadId, body: [note.trim(), block].filter(Boolean).join('\n\n'), setupCard: true }).catch(() => null);
    if (!res?.ok) return `The card was not posted: ${((await res?.json().catch(() => null)) as { error?: string } | null)?.error ?? 'the server did not answer'}.`;
    log?.({ kind: 'tool', phase: 'call', summary: what });
    return 'The card is in the session. Do not repeat what it holds. Stop here, and wait for the person.';
  }
}
