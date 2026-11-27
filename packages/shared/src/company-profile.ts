// The company profile: the first run's card 1 answers (docs/design/onboarding-2026-11/plan.md O2).
//
// One shape for the command (`workspace.set_profile`), the store (`workspaces.profile`) and every
// client. The answers decide three things and nothing else: the order of the connect rows (O3), the
// team's switches (O4) and the first brief's message (O5). They never hide an area: every area stays
// in the rail whatever the answers say (George, 2026-11-23).
import { z } from 'zod';

export const COMPANY_SELLS = ['software', 'store', 'services', 'agency', 'other'] as const;
export const COMPANY_SIZES = ['solo', '2-5', '6-10', '11+'] as const;
/** what the person wants help with first, in the order card 1 shows them */
export const COMPANY_HELP = ['product', 'mail', 'money', 'customers'] as const;

export type CompanySells = (typeof COMPANY_SELLS)[number];
export type CompanySize = (typeof COMPANY_SIZES)[number];
export type CompanyHelp = (typeof COMPANY_HELP)[number];

/** what the company sells, as Sales setup step 1 writes it (docs/design/sales-onboarding-2026-11 SO5). Marketing and
 *  Finance read the same facts later, so they live on the company profile, not in Sales */
export const CompanyOfferSchema = z.object({
  sells: z.string().trim().max(400).default(''),
  buyers: z.string().trim().max(400).default(''),
  why: z.string().trim().max(400).default(''),
});
export type CompanyOffer = z.infer<typeof CompanyOfferSchema>;
const CHIPS = z.array(z.string().trim().min(1).max(80)).max(12).default([]);
/** who buys from the company, as Sales setup step 2 writes it: each part a short list of chips */
export const CompanyCustomerSchema = z.object({ industries: CHIPS, sizes: CHIPS, roles: CHIPS, places: CHIPS, signs: CHIPS, like: CHIPS });
export type CompanyCustomer = z.infer<typeof CompanyCustomerSchema>;
export const CUSTOMER_PARTS: ReadonlyArray<readonly [keyof CompanyCustomer, string]> = [
  ['industries', 'Industry'], ['sizes', 'Company size'], ['roles', 'Roles'], ['places', 'Places'], ['signs', 'Signs'], ['like', 'A customer like'],
];
/** the customer as one line: what a folded step and pike's prompt say */
export function customerLine(c: CompanyCustomer | null | undefined): string {
  if (!c) return '';
  const roles = c.roles.slice(0, 2).join(' and '), where = c.industries.slice(0, 2).join(' and ');
  return [roles && where ? `${roles} at ${where}` : roles || where, c.sizes[0] ?? ''].filter(Boolean).join(', ');
}

export const CompanyProfileSchema = z.object({
  sells: z.enum(COMPANY_SELLS).optional(),
  size: z.enum(COMPANY_SIZES).optional(),
  help: z.array(z.enum(COMPANY_HELP)).max(COMPANY_HELP.length).default([]),
  website: z.string().trim().max(400).optional(),
  /** "Skip for now" on card 1: the first run still moves on, and resume reads a skip as an answer */
  skipped: z.boolean().optional(),
  /** Sales setup (0210): set through setup.answer, kept when card 1 is answered again */
  offer: CompanyOfferSchema.optional(),
  customer: CompanyCustomerSchema.optional(),
});
export type CompanyProfile = z.infer<typeof CompanyProfileSchema>;

/** the command a client sends with card 1's answers (commands.ts HumanCommandSchema): the server's shape */
export const workspaceSetProfileCommand = z.object({ type: z.literal('workspace.set_profile'), workspace: z.string().min(1), name: z.string().trim().min(1).max(60).optional(), profile: CompanyProfileSchema });

/** the tools card 2 can connect, by job (one row each) */
export const FIRST_RUN_TOOLS = ['mail', 'github', 'bank', 'social', 'posthog'] as const;
export type FirstRunTool = (typeof FIRST_RUN_TOOLS)[number];

const HELP_TOOL: Record<CompanyHelp, FirstRunTool> = { product: 'github', mail: 'mail', money: 'bank', customers: 'social' };

/**
 * The order of card 2's rows: the help picks first, in the order card 1 shows them, then mail (every
 * founder has mail), then GitHub when the company sells software, then money, then social, then
 * PostHog (a pasted key is the heaviest step). A company that sells no software sees GitHub last.
 * `available` drops a tool this server cannot connect,
 * such as Gmail where the server serves no Google client: a row exists only where it can act.
 */
export function connectOrder(profile: CompanyProfile | null, available: readonly FirstRunTool[] = FIRST_RUN_TOOLS): FirstRunTool[] {
  const help = profile?.help ?? [];
  const picked = COMPANY_HELP.filter((h) => help.includes(h)).map((h) => HELP_TOOL[h]);
  const rest: FirstRunTool[] = profile?.sells === 'software'
    ? ['mail', 'github', 'bank', 'social', 'posthog']
    : ['mail', 'bank', 'social', 'posthog', 'github'];
  const out: FirstRunTool[] = [];
  for (const t of [...picked, ...rest]) if (available.includes(t) && !out.includes(t)) out.push(t);
  return out;
}

/** card 3's switches. rex is always on and is not a switch. */
export interface TeamPicks { ledger: boolean; product: boolean; plume: boolean }

export function teamFromProfile(profile: CompanyProfile | null): TeamPicks {
  const help = profile?.help ?? [];
  return {
    ledger: help.includes('money'),
    // the product crew is today's default team, so a skip keeps it
    product: help.includes('product') || profile?.sells === 'software' || !profile || !!profile.skipped || help.length === 0,
    plume: help.includes('customers'),
  };
}

/** what the person connected before the first brief, as the brief reads it */
export interface FirstBriefInput {
  company: string;
  website?: string | undefined;
  connected: readonly FirstRunTool[];
}

/**
 * The first brief's message (O5). The person sends it with "Make my first brief", so it is THEIR
 * message, in their words: rex answers it like any other. Every sentence names one source, so the
 * reply has one card per connected tool. With nothing connected, rex works from the website, and
 * with no website either, rex asks.
 */
export function firstBriefPrompt(input: FirstBriefInput): string {
  const company = input.company.trim() || 'my company';
  const has = (t: FirstRunTool) => input.connected.includes(t);
  const reads: string[] = [];
  if (has('mail')) reads.push('my mail from the last 7 days');
  if (has('github')) reads.push('what shipped on GitHub in the last 14 days');
  if (has('bank')) reads.push('my bank');
  const lines = [`Make my first brief for ${company}.`];
  if (reads.length) lines.push(`Read ${joinAnd(reads)}.`);
  const site = input.website?.trim();
  if (has('social') && site) lines.push(`Draft three posts from ${site}.`);
  if (!reads.length) lines.push(site ? `Read ${site} and write a one-page company brief.` : 'Ask me what the company does, then write a one-page company brief.');
  lines.push('Tell me what needs me today.');
  return lines.join(' ');
}

function joinAnd(parts: string[]): string {
  if (parts.length < 2) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}
