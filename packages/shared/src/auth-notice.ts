import type { CardNotification, NmAuth } from './cards';

/** One explanation for thread cards, Needs You and notifications. A recorded fallback is never
 * called a failed run: it records a provider failure, not the outcome of the continued work. */
export function authNoticeCopy(card: NmAuth, where = 'this machine') {
  const label = ({ anthropic: 'Claude Code', openai: 'Codex', gemini: 'Gemini CLI' } as Record<string, string>)[card.provider] ?? card.provider;
  const work = card.work?.kind ?? (card.taskNumber ? 'task' : 'conversation');
  const subject = work === 'routine' ? 'Routine' : work === 'task' ? `Task${card.taskNumber ? ` #${card.taskNumber}` : ''}` : 'Reply';
  const title = card.switched ? `${subject} continuing on NeuraMesh brain` : `${subject} could not run`;
  const missing = !card.why || /^(?:This machine has no .+ login\.|The .+ login on this machine expired\.)$/.test(card.why);
  const reason = missing
    ? `${label} login ${card.reason === 'expired' ? 'expired' : 'unavailable'} on ${where}.`
    : card.why!;
  const action = card.switched
    ? 'This turn continues on NeuraMesh credits. Reconnect the original provider on a machine you own before switching back.'
    : card.starter === false
      ? 'NeuraMesh credits are unavailable. Add credits, or reconnect the provider on a machine you own and run it there.'
      : 'Use NeuraMesh brain on credits, or reconnect the provider on a machine you own and run it there.';
  return { title, reason, action };
}


export function authDecisionQuestion(card: NmAuth): string {
  const copy = authNoticeCopy(card);
  return `${copy.title}. ${copy.reason} ${copy.action}`.slice(0, 400);
}


export function authCardNotification(card: NmAuth, where: string): CardNotification {
  const copy = authNoticeCopy(card, 'the cloud machine');
  return { kind: 'nmauth', title: `${copy.title} · ${where}`, body: `${copy.reason} ${card.switched ? 'Continuing on NeuraMesh brain.' : 'Open NeuraMesh to choose how to continue.'}` };
}

export function authWorkOf(value: unknown): NmAuth['work'] {
  if (!value || typeof value !== 'object') return undefined;
  const work = value as { kind?: unknown; title?: unknown };
  if (work.kind !== 'routine' && work.kind !== 'task' && work.kind !== 'conversation') return undefined;
  return { kind: work.kind, ...(typeof work.title === 'string' ? { title: work.title.slice(0, 160) } : {}) };
}
