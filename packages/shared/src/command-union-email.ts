// The email draft verbs (docs/design/inbox-sales-2026-11/plan.md I8 to I10), spread into both command unions the
// command-union-replies.ts way: the server's union and the client set sit at their size caps. There is no send
// verb: Send is POST /v1/email/send, because it needs the person's own Gmail token, which only the API holds.
import { z } from 'zod';
import { EMAIL_CARD_CAP, EMAIL_SHAPE } from './email-drafts';
import { MAIL_READ_SEARCH } from './mail-grants';

const TO_NAME = z.string().trim().max(120);
const TO_EMAIL = z.string().trim().toLowerCase().max(320).regex(EMAIL_SHAPE, 'one email address');
const SUBJECT = z.string().trim().min(1).max(300);
const BODY = z.string().trim().min(1).max(20_000);
const REASON = z.string().trim().max(300);

export const EMAIL_COMMANDS = [
  // a new card in a session: one email per person, lettered a, b, c in this order. An agent or a person. A newer
  // card replaces the session's earlier drafts to the same address, so nobody gets two drafts that wait for Send
  z.object({
    type: z.literal('email.draft'),
    channel: z.string().uuid(),
    thread: z.string().uuid(),
    // outreach (plan S3): `deal` is the deal an email writes for. The deal's session becomes this session when it has none
    emails: z.array(z.object({ toName: TO_NAME.default(''), toEmail: TO_EMAIL, subject: SUBJECT, body: BODY, reason: REASON.default(''), deal: z.string().uuid().optional() })).min(1).max(EMAIL_CARD_CAP),
  }),
  // a new version of one email: `version` is the one the writer read, and an older one is refused (EMAIL_STALE), so
  // the agent's next revision always starts from the person's newest edit
  z.object({
    type: z.literal('email.revise'),
    email: z.string().uuid(),
    version: z.number().int().min(1),
    toName: TO_NAME.optional(), toEmail: TO_EMAIL.optional(), subject: SUBJECT.optional(), body: BODY.optional(), reason: REASON.optional(),
  }),
  // the person's own edit of the text on the card (HUMAN_ONLY): it is the newest version
  z.object({ type: z.literal('email.edit'), email: z.string().uuid(), version: z.number().int().min(1), subject: SUBJECT.optional(), body: BODY.optional() }),
  // an agent asks to read the person's mail or calendar ONCE (plan I12): the read request card in the session. Only
  // the person allows it (POST /v1/mail/allow), and the agent reads through POST /v1/mail/read with a machine bearer
  z.object({ type: z.literal('mail.ask_read'), channel: z.string().uuid(), thread: z.string().uuid(), search: MAIL_READ_SEARCH, reason: z.string().trim().min(1).max(300) }),
  // Do not send (DS8): the person drops one waiting email, and it never sends (HUMAN_ONLY)
  z.object({ type: z.literal('email.drop'), email: z.string().uuid() }),
] as const;
