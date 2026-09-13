// The reviewer's verdict card.
import { useEffect, useState } from 'react';
import type { VerdictCardData } from '@neuramesh/shared';
import { nm } from '../bridge/nm';
import { IconCheck } from '../ui/icons';
import type { NmQuestion } from './parse';

export function VerdictCard({ q, answers, onAnswer, onDismiss, task }: { q: NmQuestion; answers?: Map<string, string>; onAnswer?: (text: string) => void; onDismiss?: (question: string) => void; task?: { id: string; state: string; isSubtask?: boolean; repoBacked?: boolean } | null }) {
  const data = q.verdict as VerdictCardData;
  const [busy, setBusy] = useState<'' | 'approve' | 'changes'>('');
  const [err, setErr] = useState('');
  const [sent, setSent] = useState(false);
  // the live state wins over the card's snapshot — a reviewer may have moved it since
  const state = task?.state ?? data.state;
  const isDone = state === 'done';
  // ACCEPT IS THE HUMAN'S WORD (George, 2026-09-08): a done task's card asks for the word, never
  // carries a button. The orchestrator applies it (accept_task), on the server's proof you spoke.
  const label = isDone ? `#${data.number} passed review` : `Approve #${data.number}`;
  // COMPOSED, never authored. On live #1043 the orchestrator wrote "Accept #1043 — …?" above a
  // button that fired approve; the human read Accept, clicked, and believed the task was closed
  // while the real accept sat waiting in the needs-you queue. The headline is the action.
  const heading = isDone ? `${label} — ${data.title}` : `${label} — ${data.title}?`;
  // each gate keys its own answered-state off its own heading, so approving does not collapse
  // the accept step that follows it
  const answered = answers?.get(heading);
  // in_review → done → accepted is TWO human gates. When the first lands, the state changes
  // underneath us; drop `sent` so the card re-renders as the next one rather than dying answered
  // and sending the human to Home to finish.
  useEffect(() => { setSent(false); setBusy(''); }, [state]);

  if (sent || answered) {
    return (
      <div className="focard sent">
        <span className="fotick">✓</span>
        <span className="foq">{heading}</span>
        <span className="foa">{answered ?? label}</span>
      </div>
    );
  }
  // the card outlived its gate (reviewer approved, someone accepted, work bounced back)
  if (state !== 'in_review' && state !== 'done') {
    return <div className="fomini" role="note"><IconCheck s={12} /> #{data.number} has moved on — this verdict is no longer needed.</div>;
  }

  const apply = async (): Promise<void> => {
    if (!nm || busy) return;
    setBusy('approve'); setErr('');
    try {
      // as the HUMAN, from their own client — the click IS the verdict, so the gate stays
      // structural rather than being relayed through an agent that is not allowed to hold it
      await nm.taskAction(isDone ? 'task.accept' : 'task.approve', data.task);
      setSent(true);
      onAnswer?.(`**${heading}** → ${label}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message.replace(/^Error invoking remote method.*?: Error: /, '').slice(0, 140) : 'could not apply the verdict');
      setBusy('');
    }
  };
  // changes are WORDS, not a button: the agent needs to know what to change, so this arms the
  // reply instead of firing a transition with an empty reason
  const requestChanges = (): void => { setSent(true); onAnswer?.(`**${heading}** → Request changes`); };

  // A SUBTASK has no accept — its parent's gates cover it, and the server is required to
  // refuse (the #1044 red error). The card once explained that in prose; the founder's ruling
  // (rerun round): a disclaimer about FSM internals helps nobody — render nothing at all.
  if (isDone && task?.isSubtask) return null;

  return (
    <div className="verdictcard" role="group" aria-label={heading}>
      {/* every card that asks for an action can be put down (2026-08-07): dismissing flips the
          decision row, so the card collapses here AND leaves the needs-you queue — the same
          command the queue's own ✕ fires, not a local hide that returns on reload. */}
      {onDismiss && <button className="verdictx" aria-label="Dismiss this card" title="Dismiss" onClick={() => onDismiss(heading)}>✕</button>}
      <div className="verdicthead">{heading}</div>
      {data.note && <div className="verdictnote">{data.note}</div>}
      {data.artifacts && data.artifacts.length > 0 && (
        <ul className="verdictarts">
          {data.artifacts.map((a, i) => (
            <li key={i}><span className="vakind">{a.kind ?? 'file'}</span><span className="vaname">{a.name}</span></li>
          ))}
        </ul>
      )}
      {err && <div className="scheduerr">{err}</div>}
      {/* the standard in-thread option rows (founder, rerun round): the verdict rides the same
          qopt idiom every agent-posted card uses — the oversized action bar read as the task's
          own chrome instead of a card an agent handed over. Each row carries its consequence
          as the description, so the schednote explainer folded in rather than trailing. */}
      {isDone ? (
        // the consequence is the TASK'S, so it reads from the live row — a scratch research unit
        // was told about squash-merging a PR it never had (founder, rerun round)
        <div className="fomini">{task?.repoBacked ? 'Say merge in this thread to land it.' : 'Say accept in this thread to close it.'}</div>
      ) : (
        <button className="qopt vyes" disabled={!!busy} onClick={() => void apply()}>
          <b>{busy === 'approve' ? 'Applying…' : `✓ ${label}`}</b>
          <span>Moves it to done. Then say merge in the thread to land it.</span>
        </button>
      )}
      <button className="qopt" disabled={!!busy} onClick={requestChanges}>
        <b>Request changes</b>
        <span>Arms your reply — tell the agent what to change.</span>
      </button>
    </div>
  );
}
