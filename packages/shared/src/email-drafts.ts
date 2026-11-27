// EMAIL DRAFTS IN A SESSION (docs/design/inbox-sales-2026-11/plan.md I8 to I11). The rules every side reads: the
// card's limit, its letters, the row a client sees, and how one card's emails group. Pure, so the server, the agent
// tools and hq cannot disagree about a letter or a count.

/** New email in Inbox opens the New session composer with this start, the routine writer's way (ROUTINE_ASK) */
export const EMAIL_ASK = 'Draft an email: ';

/** a card holds up to 50 emails, each to one person (I11) */
export const EMAIL_CARD_CAP = 50;

/** the letters of a card, in order: a … z, then aa … ax (50 in all) */
export function emailLetter(i: number): string {
  if (i < 26) return String.fromCharCode(97 + i);
  return `${String.fromCharCode(97 + Math.floor(i / 26) - 1)}${String.fromCharCode(97 + (i % 26))}`;
}

/** an address one email goes to: one person, no list, no name part */
export const EMAIL_SHAPE = /^[^\s@<>"(),;:]+@[^\s@<>"(),;:]+\.[^\s@<>"(),;:]+$/;

/** `dropped` is Do not send (DS8): the person chose not to send it */
export type EmailDraftStatus = 'draft' | 'sent' | 'replaced' | 'dropped';

/** one email of a card, as the replica holds it (0197) */
export interface EmailDraftRow {
  id: string;
  workspace_id: string;
  channel_id: string;
  thread_id: string;
  card_id: string;
  letter: string;
  version: number;
  to_name: string;
  to_email: string;
  subject: string;
  body: string;
  reason: string;
  status: EmailDraftStatus | string;
  author_kind: 'agent' | 'human' | string;
  author_id: string;
  edited_by_kind: 'agent' | 'human' | string;
  edited_by: string;
  sent_by: string | null;
  sent_from: string | null;
  sent_at: string | null;
  /** the deal an outreach email writes for (0201), else null */
  deal_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface EmailCard {
  id: string;
  threadId: string;
  channelId: string;
  authorKind: string;
  authorId: string;
  createdAt: string;
  /** the newest change to any email of the card */
  updatedAt: string;
  emails: EmailDraftRow[];
}

/** a send in flight holds its row for at most this long: a claim older than this is free again */
export const EMAIL_SEND_CLAIM_MS = 10 * 60_000;

/** waits for a person: a draft that no send holds */
export const emailWaits = (r: Pick<EmailDraftRow, 'status' | 'sent_at'>): boolean => r.status === 'draft' && !r.sent_at;

/** the rows grouped into cards, oldest card first, each card's emails by letter */
export function emailCards(rows: readonly EmailDraftRow[]): EmailCard[] {
  const byCard = new Map<string, EmailDraftRow[]>();
  for (const r of rows) byCard.set(r.card_id, [...(byCard.get(r.card_id) ?? []), r]);
  const cards: EmailCard[] = [];
  for (const [id, emails] of byCard) {
    const sorted = [...emails].sort((a, b) => a.letter.length - b.letter.length || a.letter.localeCompare(b.letter));
    const first = sorted[0]!;
    cards.push({
      id, threadId: first.thread_id, channelId: first.channel_id, authorKind: first.author_kind, authorId: first.author_id,
      createdAt: sorted.reduce((at, e) => (e.created_at < at ? e.created_at : at), first.created_at),
      updatedAt: sorted.reduce((at, e) => (e.updated_at > at ? e.updated_at : at), first.updated_at),
      emails: sorted,
    });
  }
  return cards.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** where a card sits in its session: under the first agent message after its newest change (the agent calls the
 *  tool, then says what it did), else at the change itself */
export function emailCardAnchor(card: Pick<EmailCard, 'updatedAt'>, rows: ReadonlyArray<{ author_kind: string; created_at: string }>): string {
  const after = rows.find((m) => m.author_kind === 'agent' && m.created_at >= card.updatedAt);
  return after ? new Date(Date.parse(after.created_at) + 1).toISOString() : card.updatedAt;
}

/** the words a person sees for the card's state: what waits, and what went */
export function emailCardState(card: Pick<EmailCard, 'emails'>): { waiting: number; sent: number; replaced: number; dropped: number } {
  let waiting = 0, sent = 0, replaced = 0, dropped = 0;
  for (const e of card.emails) {
    if (e.status === 'sent') sent += 1;
    else if (e.status === 'replaced') replaced += 1;
    else if (e.status === 'dropped') dropped += 1;
    else waiting += 1;
  }
  return { waiting, sent, replaced, dropped };
}
