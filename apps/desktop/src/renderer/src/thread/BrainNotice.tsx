// THE BRAIN NOTICE — the docked bar above the composer (George, 2026-09-17: "the message '@rex
// cannot run…' is easily missed, so we should have a needs-you / warning item above the composer
// in the thread that the user can expand to view the issue and know what happened, the switch that
// happened and what they need to resolve").
//
// The attention bar's anatomy (views/AlertsBar.tsx), one conversation deep: a one-line head with a
// chevron, and an expanded panel of hairline rows — what happened, what to do, the actions. It
// renders from ONE pure derivation (packages/shared brainnotice.ts) over rows the thread already
// holds, so it stands exactly while the condition stands and leaves on its own: no ack state, no
// dismissal, nothing for the agent to write. `needs` wears the amber rule (nothing moved, the
// conversation waits on you); a `switched` record is quieter (the seat runs on Starter here).
import { brainNoticeLine, brainNoticeOf, brainNoticeText, type BrainNotice as Notice, type NoticeMessage } from '@neuramesh/shared';
import { useMemo, useState } from 'react';
import { AuthCard } from '../cards/AuthCard';

const Glyph = () => (
  <svg viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden>
    <path d="M7.5 1.8 14 13H1z" strokeLinejoin="round" /><path d="M7.5 6v3.4" strokeLinecap="round" /><circle cx="7.5" cy="11.1" r=".7" fill="currentColor" stroke="none" />
  </svg>
);
const Chevron = () => (
  <svg width="10" height="6" viewBox="0 0 10 6" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden><path d="m1 1 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" /></svg>
);

export function BrainNotice({ rows, override, onReset }: {
  /** the conversation's messages, as the thread already holds them */
  rows: readonly NoticeMessage[];
  /** the OWNING conversation's brain override (an anchored unit reads its owner's) */
  override: Readonly<Record<string, string>> | null | undefined;
  /** Reset is the WHOLE override (docs/10 §15 ruling 7) — the way back from a switch */
  onReset?: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // derived here, not by the parent: both threads sit at their size caps, and a bar that decides
  // for itself whether it stands costs each of them one line
  const notice: Notice | null = useMemo(() => brainNoticeOf(rows, override), [rows, override]);
  if (!notice) return null;
  const line = brainNoticeLine(notice);
  const text = brainNoticeText(notice);
  const head = (
    <button className="bnbar" data-open={open || undefined} data-state={notice.state} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
      <span className="bnglyph"><Glyph /></span>
      <span className="bntitle">{line.title}</span>
      {!open && <span className="bnsum">{line.summary}</span>}
      <span className="bnchev"><Chevron /></span>
    </button>
  );
  if (!open) return <div className="bnwrap">{head}</div>;
  return (
    <div className="bnwrap">
      <div className="bnpanel" data-state={notice.state} role="region" aria-label={notice.state === 'needs' ? 'Needs you' : 'The brain switched'}>
        {head}
        <div className="bnrow"><div className="bnk">What happened</div><div className="bnv">{text.happened}</div></div>
        <div className="bnrow"><div className="bnk">What to do</div><div className="bnv">{text.todo}</div></div>
        <div className="bnrow bnacts">
          {/* the same card the transcript shows, so the actions cannot drift between the two */}
          <AuthCard auth={notice.card} />
          {notice.state === 'switched' && onReset && (
            <button className="btn sm" disabled={busy} title="Every seat in this conversation returns to its own brain."
              onClick={() => { setBusy(true); void onReset().finally(() => setBusy(false)); }}>
              {busy ? 'Resetting…' : 'Reset the brain here'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
