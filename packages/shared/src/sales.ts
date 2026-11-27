// THE SALES PIPELINE (docs/design/inbox-sales-2026-11/plan.md S1 to S4, round 5). The rules every side reads: the
// stages, the rows a client sees, the summary of the Canvas tab and the deals that need a move. Pure, so the server,
// pike's tools and hq cannot disagree about a stage, a sum or a late date.

export const SALES_STAGES = ['lead', 'talked', 'trial', 'proposal', 'won', 'lost'] as const;
export type SalesStage = (typeof SALES_STAGES)[number];
/** the stages a deal is still open in: the board's columns before Won */
export const OPEN_STAGES: readonly SalesStage[] = ['lead', 'talked', 'trial', 'proposal'];
export const SALES_STAGE_LABEL: Record<SalesStage, string> = { lead: 'Lead', talked: 'Talked', trial: 'Trial', proposal: 'Proposal', won: 'Won', lost: 'Lost' };
export const isSalesStage = (s: unknown): s is SalesStage => typeof s === 'string' && (SALES_STAGES as readonly string[]).includes(s);

// Sales setup adds the web (pike found it) and a list (the person pasted it or added a CSV file)
export const SALES_SOURCES = ['gmail', 'human', 'site', 'agent', 'web', 'list'] as const;
export type SalesSource = (typeof SALES_SOURCES)[number];

/** the sales agent the workspace gets when Sales first opens (plan S2), seeded the way ledger is */
export const SALES_AGENT = { name: 'pike', emoji: '🐟', brief: 'Keeps the Sales pipeline: contacts, deals and their next steps, and drafts the outreach emails that a person approves and sends. It never sends an email.' } as const;
/** the room the Sales chat lives in (DS15): one for each workspace, in the default project */
export const SALES_ROOM_SLUG = 'sales';
/** Bring in contacts reads this far back in the person's own mail (George, 2026-11-23) */
export const SALES_PEOPLE_DAYS = 90;
/** Bring in contacts adds at most this many people at once */
export const SALES_ADD_CAP = 100;

/** what the free address check said (0210, sales-setup.ts): null for a contact added before the check */
export type AddressCheck = 'ok' | 'risky' | 'bad';
/** a contact as the replica holds it (0201, 0210 adds the role and the address check) */
export interface SalesContactRow {
  id: string; workspace_id: string; name: string; email: string; company: string;
  source: SalesSource | string; created_by_kind: string; created_by: string; created_at: string; updated_at: string;
  title?: string; address_check?: AddressCheck | string | null;
}
/** a deal as the replica holds it (0201): `next_date` is YYYY-MM-DD, `value_year` whole units of the currency */
export interface SalesDealRow {
  id: string; workspace_id: string; contact_id: string | null; title: string; company: string; stage: SalesStage | string;
  value_year: number; currency: string; next_step: string; next_date: string | null; thread_id: string | null;
  moved_by_kind: string | null; moved_by: string | null; moved_at: string | null; closed_at: string | null;
  created_by_kind: string; created_by: string; created_at: string; updated_at: string;
  /** 0210: why the lead fits the customer, where pike found it, its source, and the setup run that added it */
  fit?: string; source_url?: string; source?: SalesSource | string; setup_run?: string | null;
}

/** "$9,600": whole units, the currency's own sign */
export function salesMoney(value: number, currency = 'USD'): string {
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value); } catch { return `${currency} ${Math.round(value)}`; }
}

/** today as YYYY-MM-DD in the viewer's own time */
export const localDay = (now: Date): string => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

export interface StageTile { stage: SalesStage; count: number; value: number }
export interface PipelineSummary { openValue: number; openCount: number; wonThisMonth: number; tiles: StageTile[]; lost: StageTile; currency: string }

/** the Canvas tab's summary line and its five tiles (DS3): open stages and Won, with Lost folded apart */
export function pipelineSummary(deals: readonly SalesDealRow[], now: Date): PipelineSummary {
  const sum = (stage: SalesStage): StageTile => {
    const of = deals.filter((d) => d.stage === stage);
    return { stage, count: of.length, value: of.reduce((n, d) => n + (d.value_year || 0), 0) };
  };
  const tiles = [...OPEN_STAGES, 'won' as const].map(sum);
  const open = deals.filter((d) => (OPEN_STAGES as readonly string[]).includes(d.stage));
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const wonThisMonth = deals.filter((d) => d.stage === 'won' && d.closed_at && localDay(new Date(d.closed_at)).startsWith(month)).reduce((n, d) => n + (d.value_year || 0), 0);
  return { openValue: open.reduce((n, d) => n + (d.value_year || 0), 0), openCount: open.length, wonThisMonth, tiles, lost: sum('lost'), currency: deals[0]?.currency ?? 'USD' };
}

export type DealMove = 'late' | 'none';
/** why an open deal needs a move (D10): its next step is late, or it has none. Null when it needs nothing */
export function dealNeedsMove(d: Pick<SalesDealRow, 'stage' | 'next_step' | 'next_date'>, today: string): DealMove | null {
  if (!(OPEN_STAGES as readonly string[]).includes(d.stage)) return null;
  if (!d.next_step.trim()) return 'none';
  return d.next_date && d.next_date < today ? 'late' : null;
}

/** "Tue, Nov 24" for a YYYY-MM-DD date, read as a day with no time zone */
export function salesDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1)).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}
