// THE BRAIN NOTICE (George, 2026-09-17: "the message '@rex cannot run…' is easily missed, so we
// should have a needs-you / warning item above the composer in the thread that the user can expand
// to view the issue and know what happened, the switch that happened and what they need to resolve").
//
// ONE derivation, pure, from what already syncs: the newest auth card an agent posted in the
// conversation, and the conversation's brain override. The desktop's docked bar reads it, and the
// phone can read the same function. No new column and no ack state: the notice stands while the
// condition it describes stands, and leaves when the rows it reads from change — a reply the agent
// could give again, or a Reset that put the seat back on its own brain.
import { AUTH_LABEL, parseAuthCard, type NmAuth } from './cards';
import { STARTER_MODEL } from './rates';

export type BrainNoticeState = 'needs' | 'switched';

export interface NoticeMessage {
  id: string;
  author_kind: string;
  body: string;
  created_at: string;
}

export interface BrainNotice {
  /** `needs`: the seat cannot run and nothing moved · `switched`: the seat runs on the Starter brain here */
  state: BrainNoticeState;
  card: NmAuth;
  messageId: string;
  at: string;
  /** the seat moved by itself (a routine's conversation), as opposed to a person's tap */
  auto: boolean;
}

/** the notice for a conversation, or null when nothing stands */
export function brainNoticeOf(messages: readonly NoticeMessage[], override: Readonly<Record<string, string>> | null | undefined): BrainNotice | null {
  let last: { m: NoticeMessage; card: NmAuth } | null = null;
  for (const m of messages) {
    if (m.author_kind !== 'agent') continue;
    const card = parseAuthCard(m.body);
    if (card && (!last || m.created_at > last.m.created_at)) last = { m, card };
  }
  if (!last) return null;
  const { m, card } = last;
  const role = card.scope?.role;
  const onStarter = !!role && override?.[role] === STARTER_MODEL;
  if (onStarter) return { state: 'switched', card, messageId: m.id, at: m.created_at, auto: card.switched === true };
  // a recorded switch whose seat is no longer on Starter: the person reset it, nothing stands
  if (card.switched) return null;
  // an offer stands until the agent could speak again — a later reply that is not itself a card
  const answered = messages.some((x) => x.author_kind === 'agent' && x.created_at > m.created_at && !parseAuthCard(x.body));
  return answered ? null : { state: 'needs', card, messageId: m.id, at: m.created_at, auto: false };
}

/** the provider's name as the person knows it */
export function noticeProvider(n: BrainNotice): string {
  return AUTH_LABEL[n.card.provider] ?? n.card.provider;
}

/** why the seat could not run, in one sentence */
export function noticeWhy(n: BrainNotice): string {
  const label = noticeProvider(n);
  return n.card.why ?? (n.card.reason === 'expired' ? `The ${label} login on this machine expired.` : `This machine has no ${label} login.`);
}

/** the bar's one line: a title and the summary beside it */
export function brainNoticeLine(n: BrainNotice): { title: string; summary: string } {
  const who = n.card.agent ? `@${n.card.agent}` : 'An agent';
  return n.state === 'needs'
    ? { title: `${who} cannot run here`, summary: noticeWhy(n) }
    : { title: `${who} runs on the NeuraMesh brain here`, summary: noticeWhy(n) };
}

/** the expanded bar: what happened, then what to do (STE, one idea per sentence) */
export function brainNoticeText(n: BrainNotice): { happened: string; todo: string } {
  const who = n.card.agent ? `@${n.card.agent}` : 'The agent';
  const label = noticeProvider(n);
  const why = noticeWhy(n);
  if (n.state === 'needs') {
    return {
      happened: `${who} cannot run on ${label} here. ${why} Nothing moved, so this conversation waits.`,
      todo: n.card.starter === false
        ? `Sign in to ${label} again on this machine, or add credits. This workspace is out of credits, so the NeuraMesh brain cannot take it.`
        : `Sign in to ${label} again on this machine, or run this conversation on the NeuraMesh brain, on credits.`,
    };
  }
  return {
    happened: n.auto
      ? `${who} could not run on ${label} here. ${why} This routine continued on the NeuraMesh brain, on credits.`
      : `${who} could not run on ${label} here. ${why} You moved this conversation to the NeuraMesh brain, on credits.`,
    todo: `Sign in to ${label} again on this machine, then reset the brain in this conversation to go back.`,
  };
}
