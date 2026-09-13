// The human-confirmed scheduling card (docs/marketing scheduling).
import { useState } from 'react';
import type { ScheduleCardData } from '@neuramesh/shared';
import { nm } from '../bridge/nm';
import type { NmQuestion } from './parse';

// Schedule-confirm card (marketing): the orchestrator proposes slots via schedule_posts/
// unschedule_posts and this draws them with one Confirm. Confirming APPLIES the change here, as
// the HUMAN (nm.contentApprove/contentUnschedule per post — the click IS the approval, so the
// publish gate stays structural), then posts the `**q** → label` line so the card collapses like
// any answered nmq. Degrades to an ordinary choice card if this renderer is ever absent.
export function ScheduleConfirmCard({ q, answers, onAnswer }: { q: NmQuestion; answers?: Map<string, string>; onAnswer?: (text: string) => void }) {
  const data = q.schedule as ScheduleCardData;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [sent, setSent] = useState(false);
  const answered = answers?.get(q.question);
  const isUn = data.action === 'unschedule';
  const confirmLabel = isUn ? 'Unschedule all' : 'Schedule all';

  if (sent || answered) {
    return (
      <div className="focard sent">
        <span className="fotick">✓</span>
        <span className="foq">{q.question}</span>
        <span className="foa">{answered ?? (isUn ? 'Unscheduled' : 'Scheduled')}</span>
      </div>
    );
  }

  const fmtSlot = (iso?: string | null): string => {
    if (!iso) return '';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  };

  const confirm = async (): Promise<void> => {
    if (!nm || busy) return;
    setBusy(true); setErr('');
    try {
      // each as the human — the loop IS the human approving every slot; a scheduled post whose
      // image isn't ready is still held at publish time by the server's own guard (v0.49.3).
      // Normalize the slot to UTC Z-form: rex proposes a local-offset ISO (…09:00:00-07:00) so 9am
      // means 9am, but content.approve's z.string().datetime() only accepts Z — toISOString() keeps
      // the same instant while satisfying the schema (the live test caught the raw offset 400ing).
      for (const it of data.items) {
        if (isUn) await nm.contentUnschedule(it.item);
        else await nm.contentApprove(it.item, it.slot ? new Date(it.slot).toISOString() : undefined);
      }
      setSent(true);
      onAnswer?.(`**${q.question}** → ${confirmLabel}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message.replace(/^Error invoking remote method.*?: Error: /, '').slice(0, 120) : 'could not apply the schedule');
      setBusy(false);
    }
  };
  const decline = (): void => { setSent(true); onAnswer?.(`**${q.question}** → Not now`); };

  return (
    <div className="schedcard" role="group" aria-label={q.question}>
      <div className="schedhead">{q.question}</div>
      <ul className="schedlist">
        {data.items.map((it) => (
          <li key={it.item} className="schedrow">
            <span className="schedletter">{it.letter}</span>
            <span className="schedplat">{it.platform}</span>
            <span className="schedprev">{it.preview}{it.preview.length >= 60 ? '…' : ''}</span>
            <span className="schedslot">{isUn ? 'unschedule' : fmtSlot(it.slot)}</span>
          </li>
        ))}
      </ul>
      {err && <div className="scheduerr">{err}</div>}
      <div className="schedactions">
        <button className="btn accept" disabled={busy} onClick={() => void confirm()}>{busy ? 'Applying…' : `✓ ${confirmLabel}`}</button>
        <button className="btn" disabled={busy} onClick={decline}>Not now</button>
      </div>
      <div className="schednote">{isUn ? 'Pulls these back to draft — nothing publishes.' : 'Sets the slots; neuramesh posts each at its time. Nothing publishes until you confirm.'}</div>
    </div>
  );
}
