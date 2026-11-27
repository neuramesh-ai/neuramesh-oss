// The email draft verbs (docs/design/inbox-sales-2026-11/plan.md I8 to I10). An agent or a person writes a card of
// emails in a session, the agent writes one again by letter, and the person edits the text on the card. Nothing here
// sends: Send is POST /v1/email/send, the person's own request with their own Gmail token. An agent only drafts.
// mail.ask_read is the agent's ask to read the person's mail once (plan I12): it writes the ask and reads nothing.
import { bodyRefusal, type Actor } from '@neuramesh/shared';
import type { Command } from '../commands';
import { DomainError } from '../errors';
import { assertMarketingCommand } from '../marketing-access';
import type { Store } from '../store';
import { emailDraftsOf } from '../store/email-drafts';
import { mailGrantsOf } from '../store/mail-grants';
import { salesOf } from '../store/sales';
import { advanceSalesSetup } from '../sales-setup-run';
import { assertSalesAccess } from './sales';
import type { CommandOutcome } from '../handler';

type EmailCommand = Extract<Command, { type: 'email.draft' | 'email.revise' | 'email.edit' | 'email.drop' | 'mail.ask_read' }>;
const isEmail = (c: Command): c is EmailCommand => c.type === 'email.draft' || c.type === 'email.revise' || c.type === 'email.edit' || c.type === 'email.drop' || c.type === 'mail.ask_read';

const writer = (actor: Actor): { kind: 'agent' | 'human'; id: string } => {
  if (actor.kind !== 'agent' && actor.kind !== 'human') throw new DomainError('NOT_PERMITTED', 'a person or an agent writes an email');
  return { kind: actor.kind, id: actor.id };
};

export async function emailCommands(store: Store, actor: Actor, cmd: Command): Promise<CommandOutcome | undefined> {
  if (!isEmail(cmd)) return undefined;
  const drafts = emailDraftsOf(store);
  if (cmd.type === 'mail.ask_read') {
    if (actor.kind !== 'agent') throw new DomainError('NOT_PERMITTED', 'an agent asks to read the mail. A person reads their own mail in Inbox');
    const room = await drafts.threadRoom(cmd.thread);
    if (!room) throw new DomainError('NOT_FOUND', `session ${cmd.thread} not found`);
    if (room.channelId !== cmd.channel) throw new DomainError('INVALID_INPUT', 'that session is not in that room');
    const out = await mailGrantsOf(store).ask({ workspaceId: room.workspaceId, channelId: room.channelId, threadId: cmd.thread, agentId: actor.id, search: cmd.search, reason: cmd.reason });
    if (!out) throw new DomainError('CONFLICT', 'your earlier read request in this session still waits for the person');
    return { ok: true, grant: out.id } as never;
  }
  if (cmd.type === 'email.draft') {
    const by = writer(actor);
    // the scope guard put the channel and the session in one workspace. The session must be in that room too
    const room = await drafts.threadRoom(cmd.thread);
    if (!room) throw new DomainError('NOT_FOUND', `session ${cmd.thread} not found`);
    if (room.channelId !== cmd.channel) throw new DomainError('INVALID_INPUT', 'that session is not in that room');
    // a rich body (plan I13): at most 10 assets, and alt text on each one
    for (const e of cmd.emails) { const no = bodyRefusal(e.body); if (no) throw new DomainError('INVALID_INPUT', `${e.toEmail}: ${no}`); }
    const to = cmd.emails.map((e) => e.toEmail);
    if (new Set(to).size !== to.length) throw new DomainError('INVALID_INPUT', 'one email for each person: an address is on the card twice');
    // outreach (S3): the writer must be able to open Sales, and each deal's session becomes this one when it has none
    const deals = [...new Set(cmd.emails.map((e) => e.deal).filter((d): d is string => !!d))];
    if (deals.length) await assertSalesAccess(store, actor, room.workspaceId);
    const out = await drafts.draft({ workspaceId: room.workspaceId, channelId: room.channelId, threadId: cmd.thread, by, emails: cmd.emails });
    for (const deal of deals) await salesOf(store).linkSession(deal, cmd.thread);
    // Sales setup: a first note for a lead of the run moves it past First note (sales-setup-run.ts)
    if (deals.length) await advanceSalesSetup(store, room.workspaceId);
    return { ok: true, ...out } as never;
  }
  if (cmd.type === 'email.edit' && actor.kind !== 'human') throw new DomainError('HUMAN_ONLY', 'only a person edits the text on the card. An agent writes it again with email.revise');
  if (cmd.type === 'email.drop' && actor.kind !== 'human') throw new DomainError('HUMAN_ONLY', 'only a person decides not to send an email');
  const row = await drafts.get(cmd.email);
  if (!row) throw new DomainError('NOT_FOUND', 'that email is not on a card');
  // the email's session decides who may see it, as for the rest of the session (a restricted Marketing room)
  await assertMarketingCommand(store, actor, { type: 'email.revise', thread: row.threadId, channel: row.channelId } as never);
  if (cmd.type === 'email.drop') {
    const dropped = await drafts.drop(cmd.email);
    return { ok: true, email: dropped.id, letter: dropped.letter, status: dropped.status } as never;
  }
  const patch = cmd.type === 'email.edit'
    ? { subject: cmd.subject, body: cmd.body }
    : { toName: cmd.toName, toEmail: cmd.toEmail, subject: cmd.subject, body: cmd.body, reason: cmd.reason };
  const no = patch.body === undefined ? null : bodyRefusal(patch.body);
  if (no) throw new DomainError('INVALID_INPUT', no);
  if (Object.values(patch).every((v) => v === undefined)) throw new DomainError('INVALID_INPUT', 'name what changes: the subject, the body, the address or the reason');
  const next = await drafts.revise(cmd.email, cmd.version, patch, writer(actor));
  return { ok: true, email: next.id, letter: next.letter, version: next.version } as never;
}
