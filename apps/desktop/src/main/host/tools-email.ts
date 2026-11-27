// THE EMAIL TOOLS (docs/design/inbox-sales-2026-11/plan.md I8 to I10): an agent drafts emails as one card in this
// conversation, and writes one again by letter. They write text only: no tool here sends, reads mail or touches a
// token. Send is the person's own request from hq, from their own Gmail (POST /v1/email/send, HUMAN_ONLY).
//
// Why tools and not a prompt rule (the draft_posts lesson): an agent asked to "email our leads" with no tool would
// paste the emails into its reply, where nothing can send them and nobody can change one by letter.
//
// A revision names the version it read, and the server refuses an older one (EMAIL_STALE). So when the person
// edited an email on the card, the agent's next revision starts from the person's text: the tool gives it back.
import { EMAIL_CARD_CAP, emailCards, emailWaits, type EmailDraftRow } from '@neuramesh/shared';
import type { OrchTool, ToolCtx } from './orchtools';
import { mailReadTools } from './tools-mail-read';
import { emailMediaTools } from './tools-email-media';

export type EmailToolCtx = Pick<ToolCtx, 'z' | 'db' | 'post' | 'log'> & {
  ch: { id: string; workspace_id: string };
  actor: { kind: string; id: string; role?: string };
  /** the conversation this turn answers in: a card lives in a session */
  convoThreadId?: string | null;
  /** the room the conversation is in now (auto-filing can move it), else ch.id */
  here?: () => string;
  /** draws a picture from a brief on this machine (generateShareImage), for an email's image (add_email_media) */
  draw?: (brief: string) => Promise<{ bytes?: Buffer; mime?: string; error?: string }>;
};

const NO_SESSION = 'Email drafts live in a conversation. Reply in the conversation and draft there.';

/** the waiting email with this letter on the newest card that has one */
export function emailByLetter(rows: readonly EmailDraftRow[], letter: string): EmailDraftRow | null {
  const want = letter.trim().toLowerCase();
  for (const card of emailCards(rows).reverse()) {
    const hit = card.emails.find((e) => e.letter === want && emailWaits(e));
    if (hit) return hit;
  }
  return null;
}

/** why this revision must start again from the card, or null when it may land */
export function revisionGate(row: Pick<EmailDraftRow, 'letter' | 'version' | 'edited_by_kind' | 'subject' | 'body'>, version: number | undefined): string | null {
  if (version !== undefined && version === row.version) return null;
  if (version === undefined && row.edited_by_kind !== 'human') return null;
  return `Not yet: email ${row.letter} is at v${row.version}${row.edited_by_kind === 'human' ? ', and the person wrote that version' : ''}. Start from this text and call revise_emails again with version ${row.version}.\nSubject: ${row.subject}\n\n${row.body}`;
}

/** the email card's tools, the pictures and videos in an email (tools-email-media.ts), and the approved read of the person's mail (tools-mail-read.ts) that the emails rest on */
export function emailTools(tc: EmailToolCtx): OrchTool[] {
  return [...emailDraftTools(tc), ...emailMediaTools(tc), ...mailReadTools(tc)];
}

function emailDraftTools(tc: EmailToolCtx): OrchTool[] {
  const { z, db, post, ch, actor, convoThreadId, log } = tc;
  const cardRows = async () => (convoThreadId
    ? await db.getAll<EmailDraftRow>('select * from email_drafts where thread_id = ? order by created_at', [convoThreadId]).catch(() => [] as EmailDraftRow[])
    : []);
  const commandError = async (res: Response | null) => {
    const j = (await res?.json().catch(() => null)) as { error?: string } | null;
    return j?.error ?? 'the server did not answer';
  };
  return [
    { name: 'draft_emails', description: `Hand over new emails as ONE CARD in this conversation, one email per person, lettered a, b, c. Use it whenever the human asks you to write, draft or prepare an email, an outreach or a follow-up. NEVER paste an email into your reply: the card is the delivery, and the human changes it by talk or on the card. Write each email personal to its person, in plain words, with a subject. \`reason\` is one short line on what you based it on. Nothing sends until the human selects Send on the card, from their own Gmail, so never say an email went. Up to ${EMAIL_CARD_CAP} people. Calling again makes a NEW card that replaces the waiting drafts to the same people; to change an email, use revise_emails.`, schema: {
      emails: z.array(z.object({
        toName: z.string().max(120).describe('the person\'s name, as it shows in To'),
        toEmail: z.string().max(320).describe('the person\'s one email address. Only an address you were given or read, never a guess'),
        subject: z.string().min(1).max(300),
        body: z.string().min(1).max(20_000).describe('the email text, greeting to sign-off, plain text with blank lines between paragraphs'),
        reason: z.string().max(300).optional().describe('one short line on what this email rests on, e.g. "read 2 threads with Lena and your calendar"'),
        deal: z.string().uuid().optional().describe('outreach for a Sales deal: its id from list_deals'),
      })).min(1).max(EMAIL_CARD_CAP).describe('one entry per person, in the order they should read'),
    }, run: async (input: { emails: Array<{ toName: string; toEmail: string; subject: string; body: string; reason?: string; deal?: string }> }) => {
      if (!convoThreadId) return NO_SESSION;
      const res = await post('/v1/commands', actor, {
        type: 'email.draft', channel: tc.here?.() ?? ch.id, thread: convoThreadId,
        emails: input.emails.map((e) => ({ toName: e.toName, toEmail: e.toEmail, subject: e.subject, body: e.body, reason: e.reason ?? '', ...(e.deal ? { deal: e.deal } : {}) })),
      }).catch(() => null);
      if (!res?.ok) return `The emails were not saved: ${await commandError(res)}. Say so plainly, and do not paste the emails into your reply.`;
      const out = (await res.json().catch(() => ({}))) as { emails?: Array<{ letter: string }>; replaced?: number };
      const letters = (out.emails ?? []).map((e) => e.letter);
      log?.({ kind: 'tool', phase: 'call', summary: `draft_emails — ${letters.length} email${letters.length === 1 ? '' : 's'}` });
      return `${letters.length} email${letters.length === 1 ? '' : 's'} delivered as one card in this thread (${letters.join('/')}, each at v1)${out.replaced ? `. It replaces ${out.replaced} waiting draft${out.replaced === 1 ? '' : 's'} to the same people` : ''}. The human reads them there, changes them by talk or on the card, and selects Send. Nothing is sent. Do NOT repeat the emails in your reply: one short line on what you wrote, and say they can ask for changes by letter.`;
    } },
    { name: 'revise_emails', description: 'Write emails ALREADY on the card here again, in place, by letter: use it whenever the human asks to change one ("b is too long", "add the pricing link to all of them"). The email keeps its letter and its version goes up. Give `version`, the version you change (the card and your last result show it). If the human edited the email on the card, the tool gives you their text: write your change from it. draft_emails again would make a second card, which is the wrong answer to "change this".', schema: {
      revisions: z.array(z.object({
        letter: z.string().min(1).max(2).describe('the email letter on the card: a, b, c'),
        version: z.number().int().min(1).optional().describe('the version you read and change'),
        subject: z.string().max(300).optional().describe('the new subject, in full'),
        body: z.string().max(20_000).optional().describe('the new email text, in full'),
        toName: z.string().max(120).optional(),
        toEmail: z.string().max(320).optional().describe('a corrected address, only one the human gave'),
        reason: z.string().max(300).optional().describe('one short line on what changed, e.g. "Shorter, with the pricing link."'),
      })).min(1).max(EMAIL_CARD_CAP),
    }, run: async (input: { revisions: Array<{ letter: string; version?: number; subject?: string; body?: string; toName?: string; toEmail?: string; reason?: string }> }) => {
      if (!convoThreadId) return NO_SESSION;
      const rows = await cardRows();
      if (!rows.length) return 'There is no email card in this thread to change. draft_emails first.';
      const done: string[] = [], missed: string[] = [], gates: string[] = [];
      for (const r of input.revisions) {
        const row = emailByLetter(rows, r.letter);
        if (!row) { missed.push(r.letter); continue; }
        const gate = revisionGate(row, r.version);
        if (gate) { gates.push(gate); continue; }
        const change = Object.fromEntries(Object.entries({ subject: r.subject, body: r.body, toName: r.toName, toEmail: r.toEmail, reason: r.reason }).filter(([, v]) => v !== undefined && v !== ''));
        if (!Object.keys(change).length) { missed.push(r.letter); continue; }
        const res = await post('/v1/commands', actor, { type: 'email.revise', email: row.id, version: row.version, ...change }).catch(() => null);
        if (res?.ok) done.push(`${row.letter} (v${row.version + 1})`); else gates.push(`Email ${row.letter}: ${await commandError(res)}`);
      }
      if (done.length) log?.({ kind: 'tool', phase: 'call', summary: `revise_emails — ${done.join('/')}` });
      const parts = [
        done.length ? `Revised ${done.join(', ')} in place on the card. Nothing is sent.` : 'Nothing was revised.',
        missed.length ? `No waiting email matched ${missed.join(', ')}, or the revision changed nothing (sent and replaced emails do not change).` : '',
        ...gates,
        done.length ? 'Do NOT repeat the emails in your reply: one short line on what you changed.' : 'Say so plainly. Never claim a change that did not land.',
      ];
      return parts.filter(Boolean).join('\n\n');
    } },
  ];
}
