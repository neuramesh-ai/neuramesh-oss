// The Sales pipeline verbs (docs/design/inbox-sales-2026-11/plan.md S1, round 5), spread into both command unions the
// command-union-email.ts way. A person with Sales access or an agent with the Sales grant sends them, and the server
// checks that access (handler/sales.ts). sales.add_contacts is the person's own pick in Bring in contacts, so only a
// person sends it.
import { z } from 'zod';
import { EMAIL_SHAPE } from './email-drafts';
import { SALES_ADD_CAP, SALES_STAGES } from './sales';
import { LeadDraftSchema, SALES_LEADS_MAX } from './sales-setup';

const NAME = z.string().trim().max(120);
const EMAIL = z.string().trim().toLowerCase().max(320).regex(EMAIL_SHAPE, 'one email address');
const COMPANY = z.string().trim().max(120);
const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'a date as YYYY-MM-DD');

export const SALES_COMMANDS = [
  // a new contact, or a change to one: `contact` names the row, else the address finds it or makes it
  z.object({ type: z.literal('sales.upsert_contact'), workspace: z.string().min(1), contact: z.string().uuid().optional(), name: NAME.optional(), email: EMAIL.optional(), company: COMPANY.optional() }),
  // Bring in contacts (DS7): the people the person picked, as contacts only. An address in Sales already is skipped
  z.object({ type: z.literal('sales.add_contacts'), workspace: z.string().min(1), contacts: z.array(z.object({ name: NAME.default(''), email: EMAIL, company: COMPANY.default('') })).min(1).max(SALES_ADD_CAP) }),
  // a new deal, or a change to one: `deal` names the row. A stage given here moves the deal as sales.move_deal does
  z.object({
    type: z.literal('sales.upsert_deal'), workspace: z.string().min(1), deal: z.string().uuid().optional(), contact: z.string().uuid().nullable().optional(),
    title: z.string().trim().min(1).max(200).optional(), company: COMPANY.optional(), stage: z.enum(SALES_STAGES).optional(),
    value: z.number().int().min(0).max(1_000_000_000).optional(), currency: z.string().regex(/^[A-Z]{3}$/).optional(),
    nextStep: z.string().trim().max(200).optional(), nextDate: DAY.nullable().optional(),
  }),
  // a deal to another stage: a drag on the board, the stage chip, or the sales agent
  z.object({ type: z.literal('sales.move_deal'), workspace: z.string().min(1), deal: z.string().uuid(), stage: z.enum(SALES_STAGES) }),
  // Add on the review card (Sales setup SO12): the leads the person picked, each a contact when it has an address and a
  // Lead deal. A person in Sales already and a company with an open deal are skipped, and the answer names each row
  z.object({ type: z.literal('sales.add_leads'), workspace: z.string().min(1), leads: z.array(LeadDraftSchema).min(1).max(SALES_LEADS_MAX) }),
] as const;
