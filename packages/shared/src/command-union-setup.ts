// The area setup verbs (docs/design/sales-onboarding-2026-11/plan.md, approved 2026-11-26), spread into both command
// unions the command-union-sales.ts way. Each one is the person's own move in a setup run, so only a person sends it
// (HUMAN_ONLY, and refused for a machine), and the server checks the person's access to the flow's area.
import { z } from 'zod';
import { CompanyCustomerSchema, CompanyOfferSchema } from './company-profile';
import { AREA_SETUP_FLOWS } from './setupflows';

const FLOW = z.string().refine((f) => f in AREA_SETUP_FLOWS, 'an area setup flow');

export const SETUP_AREA_COMMANDS = [
  // start the run: the session in the area's room, with the agent's first line and the first step card. Idempotent
  z.object({ type: z.literal('setup.start'), workspace: z.string().min(1), flow: FLOW }),
  // a step's answer that lives on the company profile: the website and the offer (company), or the customer
  z.object({
    type: z.literal('setup.answer'), workspace: z.string().min(1), flow: FLOW, step: z.enum(['company', 'customer']),
    website: z.string().trim().max(400).optional(), offer: CompanyOfferSchema.optional(), customer: CompanyCustomerSchema.optional(),
  }),
  // Skip on a step line. Doing the step later clears it with no command (a done step is never skipped)
  z.object({ type: z.literal('setup.skip'), workspace: z.string().min(1), flow: FLOW, step: z.string().min(1).max(40) }),
  // End setup: the opt-out with fewer leads than the bar (SO8)
  z.object({ type: z.literal('setup.end'), workspace: z.string().min(1), flow: FLOW }),
  // Hide on Left from setup, once the run is over
  z.object({ type: z.literal('setup.hide'), workspace: z.string().min(1), flow: FLOW }),
  // look again after a change the API did not see (a mail link that the person connected in another tab)
  z.object({ type: z.literal('setup.check'), workspace: z.string().min(1), flow: FLOW }),
] as const;
