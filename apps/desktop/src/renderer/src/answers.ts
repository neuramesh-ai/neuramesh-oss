// The answered-state of nmq cards — PER CARD, not per question (the re-ask fix, 2026-08-10).
//
// Answers post back as `**question** → answer` lines; that convention is the answered-state
// store, layered under the synced `decisions` rows. Both layers used to key by QUESTION TEXT
// alone, thread-wide — so one "Not now" answered every future card that dared re-ask the same
// question: rex re-sent a fresh proposal and it rendered born-checked, with nothing left to
// click (found live). The server was never the bug — a re-ask supersedes only OPEN rows and
// inserts a fresh open one — the client just never asked WHICH card an answer belonged to.
//
// Two rules make the state per-card:
//   · the string-match floor is ORDER-AWARE: an answer line only answers cards ABOVE it in the
//     transcript (an answer that predates a question cannot be its answer), last word wins;
//   · the synced rows overlay BY MESSAGE — a decision row names the message that asked it
//     (`message_id`), so each card collapses on its own row and no other. This is exactly the
//     identity the server's supersede already writes.
//
// Kept in its own module so the rules are assertable (answers.test.ts) — App.tsx renders it.

export interface AnswerSourceMessage {
  id: string;
  author_kind: string;
  body: string;
}

export interface AnswerDecisionRow {
  message_id: string | null;
  question: string;
  status: string;
  answer: string | null;
}

const ANSWER_LINE = /^\*\*(.+?)\*\*\s*→\s*(.+)$/;

/** every `**q** → a` line in the given HUMAN bodies (order-blind — used for outbound replies) */
export function answersFrom(messages: Array<{ author_kind: string; body: string }>): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of messages) {
    if (m.author_kind !== 'human') continue;
    for (const line of m.body.split('\n')) {
      const hit = ANSWER_LINE.exec(line.trim());
      if (hit) map.set(hit[1]!, hit[2]!);
    }
  }
  return map;
}

/**
 * A resolver: `answersFor(messageId)` → the question→answer map AS SEEN BY the card living in
 * that message. Build once per (rows, decisions) change; cheap per-message lookups after.
 */
export function answersResolver(
  rows: AnswerSourceMessage[],
  decisions: AnswerDecisionRow[],
): (messageId: string) => Map<string, string> {
  const at = new Map<string, number>();
  rows.forEach((m, i) => at.set(m.id, i));
  const lines: Array<{ q: string; a: string; i: number }> = [];
  rows.forEach((m, i) => {
    if (m.author_kind !== 'human') return;
    for (const line of m.body.split('\n')) {
      const hit = ANSWER_LINE.exec(line.trim());
      if (hit) lines.push({ q: hit[1]!, a: hit[2]!, i });
    }
  });
  const rowsByMsg = new Map<string, AnswerDecisionRow[]>();
  for (const d of decisions) {
    if (!d.message_id) continue;
    const g = rowsByMsg.get(d.message_id);
    if (g) g.push(d);
    else rowsByMsg.set(d.message_id, [d]);
  }
  const cache = new Map<string, Map<string, string>>();
  return (messageId: string) => {
    const hit = cache.get(messageId);
    if (hit) return hit;
    // a message we can't place (not in this row set) degrades to the old whole-thread reading
    // rather than to "nothing answered" — showing an open card twice beats losing an answer
    const i = at.get(messageId) ?? -1;
    const map = new Map<string, string>();
    for (const l of lines) if (l.i > i) map.set(l.q, l.a);
    for (const d of rowsByMsg.get(messageId) ?? []) {
      if (d.status === 'answered') map.set(d.question, d.answer ?? '');
      else if (d.status === 'dismissed' && !map.has(d.question)) map.set(d.question, 'dismissed');
    }
    cache.set(messageId, map);
    return map;
  };
}
