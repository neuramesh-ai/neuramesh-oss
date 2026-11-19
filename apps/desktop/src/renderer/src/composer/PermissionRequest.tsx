import { useState } from 'react';
import { parseQuestions } from '@neuramesh/shared';
import { nm } from '../bridge/nm';
import type { DecisionAllRow } from '../bridge/rows-board';
import type { MessageRow } from '../bridge/rows-rooms';

/** Anchor a pending grant by its message and decision IDs. Equal command labels
 * in different cards, or two requests for the same command, remain independent. */
export function PermissionRequest({ rows, decisions }: { rows: MessageRow[]; decisions: DecisionAllRow[] }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const open = decisions.filter(d => d.status === 'open');
  if (!open.length) return null;
  const byId = new Map(open.map(d => [d.message_id,d]));
  for (const row of rows) {
    const decision = byId.get(row.id);
    if (!decision) continue;
    const question = parseQuestions(row.body).find(q => q.kind === 'permission' && q.question === decision.question);
    if (!question) continue;
    const resolve = async (answer: string) => {
      if (!nm || busy) return;
      setBusy(true); setError('');
      try { await nm.decisionAction('decision.answer', decision.id, answer); }
      catch { setError('Could not save your decision. Try again.'); }
      finally { setBusy(false); }
    };
    return <section className="perm-request" aria-label="Action awaiting approval"><b>{question.title || question.question}</b>
      {question.command && <pre>{question.command}</pre>}<small>{question.reason}</small>
      <div><button type="button" className="btn sm" disabled={busy} onClick={() => void resolve('Deny')}>Decline</button>
        <button type="button" className="btn primary sm" disabled={busy} onClick={() => void resolve('Approve')}>Allow once</button></div>
      {error && <small role="alert">{error}</small>}</section>;
  }
  return null;
}
