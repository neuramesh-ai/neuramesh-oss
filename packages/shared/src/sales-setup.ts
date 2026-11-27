// SALES SETUP (docs/design/sales-onboarding-2026-11/plan.md SO1 to SO17, approved 2026-11-26). The rules every side
// reads: where a run stands, the bar of 3 leads, the step markers the API posts, the cards pike's tools post, the
// leads a list holds, and the duplicates. Pure, so the API, pike's tools and hq cannot disagree about a step or a lead.
import { z } from 'zod';
import { customerLine, type CompanyCustomer, type CompanyOffer } from './company-profile';
import { EMAIL_SHAPE } from './email-drafts';
import { OPEN_STAGES, type AddressCheck, type SalesContactRow, type SalesDealRow } from './sales';
import { AREA_SETUP_FLOWS, SALES_SETUP_FLOW, type AreaSetupFlow } from './setupflows';

export type SalesSetupStep = 'company' | 'customer' | 'gmail' | 'find' | 'review' | 'note';
/** the web source's cost on the starter brain, as the card shows it, and where one run of it stops (George, 2026-11-26) */
export const WEB_SEARCH_CREDITS = 20;
export const WEB_SEARCH_CAP = 30;
/** first emails to new people, for each sender, in 24 hours (SO17). Gmail's own cap is far above a safe cold volume */
export const FIRST_NOTE_CAP = 30;
/** the last line of each first note (George, 2026-11-26): a plain way to say no */
export const FIRST_NOTE_OPT_OUT = 'If this is not for you, say so and I will not write again.';
/** the next step a lead gets, and the one a lead that said no gets */
export const LEAD_NEXT_STEP = 'First note';
export const DO_NOT_CONTACT = 'Do not contact';

/** a run as GET /v1/sales/setup returns it (0210) */
export interface SetupRunRow {
  id: string; workspace_id: string; flow: string; channel_id: string; thread_id: string | null; started_by: string;
  /** the steps the person skipped, in the order they did */
  skipped: string[];
  /** the last step card the API posted, so it posts each card once */
  step: string | null;
  ended_at: string | null; completed_at: string | null; hidden_at: string | null; created_at: string;
}

/** the facts a run's steps derive from, each read from the step's real home (SO6) */
export interface SalesSetupFacts {
  offer: boolean;
  customer: boolean;
  /** the viewer's own mail link is connected */
  gmail: boolean;
  /** a lead list exists in the session: pike's leads card, or a list the person added */
  found: boolean;
  /** leads this run added to Sales */
  added: number;
  /** a draft exists for one of those leads */
  noted: boolean;
  /** open deals a note can reach: the bar counts these */
  reachable: number;
}

export type SetupStepStatus = 'done' | 'skipped' | 'now' | 'next';
export interface SetupStepState { id: string; label: string; status: SetupStepStatus }
export interface SalesSetupState {
  steps: SetupStepState[];
  done: number; skipped: number;
  /** the step a card asks for now, null once the run completes or ends */
  now: string | null;
  reachable: number; bar: number; barMet: boolean;
  complete: boolean; ended: boolean;
}

const DONE: Record<SalesSetupStep, (f: SalesSetupFacts) => boolean> = {
  company: (f) => f.offer,
  customer: (f) => f.customer,
  gmail: (f) => f.gmail,
  find: (f) => f.found || f.added > 0,
  review: (f) => f.added > 0,
  note: (f) => f.noted,
};

/**
 * Where a run stands. A step is done when its fact holds, and a done step is never "skipped", so doing a skipped step
 * later clears the skip with no command. When every step is done or skipped and the bar fails, the run goes back to
 * Find leads (SO8). The run completes when every step is done or skipped and the bar holds, or when the API stamped it.
 */
export function salesSetupState(run: Pick<SetupRunRow, 'skipped' | 'ended_at' | 'completed_at'> | null, f: SalesSetupFacts, flow: AreaSetupFlow = SALES_SETUP_FLOW): SalesSetupState {
  const skipped = new Set(run?.skipped ?? []);
  const base = flow.steps.map((s) => ({ id: s.id, label: s.label, done: DONE[s.id as SalesSetupStep]?.(f) ?? false }));
  const open = base.filter((s) => !s.done && !skipped.has(s.id));
  const barMet = f.reachable >= flow.bar;
  const ended = !!run?.ended_at;
  const complete = !!run?.completed_at || (!open.length && barMet);
  const now = complete || ended ? null : open[0]?.id ?? 'find';
  const steps = base.map((s): SetupStepState => ({
    id: s.id, label: s.label,
    status: s.id === now ? 'now' : s.done ? 'done' : skipped.has(s.id) ? 'skipped' : 'next',
  }));
  return {
    steps, now, reachable: f.reachable, bar: flow.bar, barMet, complete, ended,
    done: base.filter((s) => s.done).length,
    skipped: base.filter((s) => !s.done && skipped.has(s.id)).length,
  };
}

/** a deal counts toward the bar when it is open and its contact has an address that is not bad (SO7) */
export function reachableLeads(deals: readonly Pick<SalesDealRow, 'stage' | 'contact_id'>[], contacts: readonly Pick<SalesContactRow, 'id' | 'address_check'>[]): number {
  const byId = new Map(contacts.map((c) => [c.id, c]));
  return deals.filter((d) => (OPEN_STAGES as readonly string[]).includes(d.stage) && d.contact_id && byId.has(d.contact_id) && byId.get(d.contact_id)!.address_check !== 'bad').length;
}

/** GET /v1/sales/setup: the run, where it stands, and the company's answers on its profile */
export interface SalesSetupView {
  flow: AreaSetupFlow; run: SetupRunRow | null; state: SalesSetupState | null;
  profile: { website: string; offer: CompanyOffer | null; customer: CompanyCustomer | null };
}

// ── the step markers: the API posts one for each step card, as the area's agent, and it wakes no agent ──
const MARKER = /‹setup:([a-z0-9.]+):([a-z]+)›/;
export const setupMarker = (flow: string, step: string): string => `‹setup:${flow}:${step}›`;
export function parseSetupMarker(body: string | null | undefined): { flow: string; step: string } | null {
  const m = MARKER.exec(body ?? '');
  return m ? { flow: m[1]!, step: m[2]! } : null;
}
/** the step marker's words: what an old desktop, the phone app and an agent's transcript show in its place */
export function setupMarkerText(body: string): string {
  return body.replace(new RegExp(MARKER.source, 'g'), (_m, flowId: string, step: string) => {
    const flow = AREA_SETUP_FLOWS[flowId];
    if (!flow) return '';
    if (step === 'done') return `[${flow.title}: complete]`;
    if (step === 'ended') return `[${flow.title}: ended by the person]`;
    const i = flow.steps.findIndex((s) => s.id === step);
    return i < 0 ? '' : `[${flow.title}, step ${i + 1} of ${flow.steps.length}: ${flow.steps[i]!.label}. Open Sales on the web to answer.]`;
  }).trim();
}

// ── the cards pike's tools post (propose_company, propose_customer, propose_leads) ──
export const LeadSourceSchema = z.enum(['gmail', 'web', 'list', 'human']);
export type LeadSource = z.infer<typeof LeadSourceSchema>;
/** a lead before it is in Sales: a company, and a person when one is known */
export const LeadDraftSchema = z.object({
  name: z.string().trim().max(120).default(''),
  email: z.string().trim().toLowerCase().max(320).optional(),
  title: z.string().trim().max(120).default(''),
  company: z.string().trim().min(1).max(120),
  fit: z.string().trim().max(280).default(''),
  source: LeadSourceSchema,
  sourceUrl: z.string().trim().max(500).optional(),
});
export type LeadDraft = z.infer<typeof LeadDraftSchema>;
/** a lead after the API checked it: the address check, and whether Sales holds it already */
export type LeadCheck = AddressCheck | 'none';
export interface CheckedLead extends LeadDraft { check: LeadCheck; dup: 'person' | 'company' | null }
export const SALES_LEADS_MAX = 100;

export type SetupBlock =
  | { kind: 'company'; website: string; offer: CompanyOffer }
  | { kind: 'customer'; customer: CompanyCustomer }
  | { kind: 'leads'; leads: CheckedLead[] };
/** the step each card fills */
export const BLOCK_STEP: Record<SetupBlock['kind'], SalesSetupStep> = { company: 'company', customer: 'customer', leads: 'review' };

const FENCE = /```nmsetup\n([\s\S]*?)\n```/;
export const setupBlock = (b: SetupBlock): string => '```nmsetup\n' + JSON.stringify(b) + '\n```';
export function parseSetupBlock(body: string | null | undefined): SetupBlock | null {
  const m = FENCE.exec(body ?? '');
  if (!m) return null;
  try {
    const b = JSON.parse(m[1]!) as SetupBlock;
    return b && (b.kind === 'company' || b.kind === 'customer' || b.kind === 'leads') ? b : null;
  } catch { return null; }
}
export const stripSetupBlocks = (body: string): string => body.replace(new RegExp(FENCE.source, 'g'), '').trim();
/** a setup card comes only from pike's tools, which check it first: the server drops one an agent wrote into a reply */
export function setupCardGuard(body: string, fromTool: boolean): string {
  return fromTool || !body.includes('```nmsetup') ? body : stripSetupBlocks(body);
}
/** a setup card and a step marker as an agent's transcript shows them: readable, never a block to copy */
export function setupCardText(body: string): string {
  const b = parseSetupBlock(body);
  const words = setupMarkerText(stripSetupBlocks(body));
  if (!b) return words;
  const card = b.kind === 'company'
    ? `[the company card, posted with propose_company: sells "${b.offer.sells}", buyers "${b.offer.buyers}"]`
    : b.kind === 'customer'
      ? `[the customer card, posted with propose_customer: ${customerLine(b.customer)}]`
      : `[the leads card, posted with propose_leads: ${b.leads.length} leads, ${b.leads.map((l) => l.company).slice(0, 8).join(', ')}]`;
  return [words, card].filter(Boolean).join('\n');
}

// ── duplicates ──
/** mail domains that name no company */
export const FREE_MAIL = new Set(['gmail.com', 'googlemail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'live.com', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'yandex.com']);
export const domainOf = (email: string | null | undefined): string => (email?.split('@')[1] ?? '').trim().toLowerCase();
/** a company's name as a key: lower case, no legal suffix, no punctuation */
export const companyKey = (name: string): string => name.toLowerCase().replace(/[.,'"&()]/g, ' ').replace(/\b(inc|llc|ltd|limited|gmbh|co|corp|corporation|company|plc|sa|bv)\b/g, ' ').replace(/\s+/g, ' ').trim();

/** a person in Sales already (the address), or a company with an open deal already (its name, or its mail domain) */
export function leadDuplicate(lead: Pick<LeadDraft, 'email' | 'company'>, contacts: readonly Pick<SalesContactRow, 'id' | 'email'>[], deals: readonly Pick<SalesDealRow, 'company' | 'stage' | 'contact_id'>[]): 'person' | 'company' | null {
  if (lead.email && contacts.some((c) => c.email === lead.email)) return 'person';
  const key = companyKey(lead.company), domain = domainOf(lead.email);
  const mail = new Map(contacts.map((c) => [c.id, domainOf(c.email)]));
  const open = deals.filter((d) => (OPEN_STAGES as readonly string[]).includes(d.stage));
  if (key && open.some((d) => companyKey(d.company) === key)) return 'company';
  if (domain && !FREE_MAIL.has(domain) && open.some((d) => d.contact_id && mail.get(d.contact_id) === domain)) return 'company';
  return null;
}

// ── the address check, its pure half: the API adds the MX lookup (address-check.ts) ──
const ROLE = new Set(['info', 'sales', 'support', 'admin', 'contact', 'hello', 'team', 'office', 'help', 'billing', 'hr', 'jobs', 'careers', 'marketing', 'press', 'enquiries', 'inquiries']);
const NO_REPLY = /^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|bounce[s]?)$/;
const THROWAWAY = new Set(['mailinator.com', 'guerrillamail.com', '10minutemail.com', 'tempmail.com', 'temp-mail.org', 'yopmail.com', 'trashmail.com', 'getnada.com', 'dispostable.com', 'sharklasers.com']);
/** 'bad' and 'risky' that need no lookup, else null: the API then asks DNS for the domain's mail server */
export function addressCheckFirst(email: string): AddressCheck | null {
  const e = email.trim().toLowerCase();
  if (!EMAIL_SHAPE.test(e)) return 'bad';
  const [local, domain] = e.split('@') as [string, string];
  if (NO_REPLY.test(local) || THROWAWAY.has(domain)) return 'bad';
  if (ROLE.has(local)) return 'risky';
  return null;
}

// ── a pasted list, or a CSV file (SO10): parsed in hq with no agent ──
const HEAD: Array<[keyof Omit<LeadDraft, 'source'> | 'first' | 'last' | 'site', RegExp]> = [
  ['email', /^e-?mail( address)?$/], ['first', /^first( name)?$/], ['last', /^(last|sur)( ?name)?$/], ['name', /^(full )?name$|^contact$|^person$/],
  ['title', /^(job )?(title|role|position)$/], ['company', /^(company|organi[sz]ation|account|business)( name)?$/], ['site', /^(website|domain|url|site)$/], ['fit', /^(notes?|why|fit)$/],
];
function cells(line: string, sep: string): string[] {
  const out: string[] = []; let cur = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') quoted = false; else cur += ch; }
    else if (ch === '"') quoted = true;
    else if (ch === sep) { out.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
}
const companyFromDomain = (domain: string): string => {
  const label = domain.replace(/^www\./, '').split('.')[0] ?? '';
  return label ? label.charAt(0).toUpperCase() + label.slice(1) : '';
};
const EMAIL_IN = /[^\s<>"(),;:]+@[^\s<>"(),;:]+\.[^\s<>"(),;:]+/;

/** the leads in a list: a CSV or TSV with a header row, or lines that each hold an address. Each address once */
export function parseLeadList(text: string): { leads: LeadDraft[]; skipped: number } {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim());
  if (!lines.length) return { leads: [], skipped: 0 };
  const first = lines[0]!;
  const sep = first.includes('\t') ? '\t' : (first.split(';').length > first.split(',').length ? ';' : ',');
  const head = cells(first, sep).map((h) => h.toLowerCase());
  const cols = new Map<string, number>();
  head.forEach((h, i) => { const hit = HEAD.find(([, re]) => re.test(h)); if (hit && !cols.has(hit[0])) cols.set(hit[0], i); });
  const seen = new Set<string>(); const leads: LeadDraft[] = []; let skipped = 0;
  const push = (l: Omit<LeadDraft, 'source'>) => {
    const email = l.email && EMAIL_SHAPE.test(l.email) ? l.email : undefined;
    const company = l.company || (email && !FREE_MAIL.has(domainOf(email)) ? companyFromDomain(domainOf(email)) : '');
    if (!company && !email) { skipped++; return; }
    if (email && seen.has(email)) { skipped++; return; }
    if (email) seen.add(email);
    leads.push({ name: l.name, email, title: l.title, company: (company || l.name || email!).slice(0, 120), fit: l.fit, source: 'list' });
  };
  if (cols.has('email') || cols.has('company')) {
    for (const line of lines.slice(1)) {
      const c = cells(line, sep), at = (k: string) => (cols.has(k) ? c[cols.get(k)!] ?? '' : '');
      const site = at('site').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      push({
        name: (at('name') || [at('first'), at('last')].filter(Boolean).join(' ')).slice(0, 120), email: at('email').toLowerCase() || undefined,
        title: at('title').slice(0, 120), company: (at('company') || (site ? companyFromDomain(site) : '')).slice(0, 120), fit: at('fit').slice(0, 280),
      });
    }
  } else {
    for (const line of lines) {
      const email = EMAIL_IN.exec(line)?.[0]?.toLowerCase();
      if (!email) { skipped++; continue; }
      const rest = line.replace(EMAIL_IN, '').replace(/[<>"]/g, ' ').split(new RegExp(`[${sep === '\t' ? '\\t' : sep}]`)).map((s) => s.trim()).filter(Boolean);
      push({ name: (rest[0] ?? '').slice(0, 120), email, title: '', company: (rest[1] ?? '').slice(0, 120), fit: '' });
    }
  }
  return { leads: leads.slice(0, SALES_LEADS_MAX), skipped: skipped + Math.max(0, leads.length - SALES_LEADS_MAX) };
}
