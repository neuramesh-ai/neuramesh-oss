// Playbook recommendations (nmplays) rendered as Run-shaped rows — the SchedRecsCard
// family's sibling (marketing-os round). Run › posts the ONE pre-drafted ask into this
// thread as the human (the suggestion-pill semantic); rex triages it and the plan gate
// stays the consent. Without a post path (a preview surface), the rows read but carry no
// button — an absent control beats a disabled one.
import { useState } from 'react';
import { playbookAsk, playbookById } from '@neuramesh/shared';
import type { NmPlays } from './parse';

export function PlaybookRecsCard({ plays, onRun }: { plays: NmPlays; onRun?: (text: string) => void }) {
  const [sent, setSent] = useState<Record<string, boolean>>({});
  const rows = plays.plays
    .map((r) => ({ rec: r, pb: playbookById(r.id) }))
    .filter((r): r is { rec: { id: string; why: string }; pb: NonNullable<ReturnType<typeof playbookById>> } => !!r.pb);
  if (!rows.length) return null;
  return (
    <div className="schedrecs">
      <div className="schedrecshead">First playbooks — the baseline your work moves</div>
      {rows.map(({ rec, pb }) => (
        <div key={pb.id} className="playrecrow">
          <span className="playrecmeta">
            <b>{pb.title}</b>
            <span>{rec.why || pb.tagline}</span>
          </span>
          {sent[pb.id]
            ? <span className="playrecok">✓ asked</span>
            : onRun && (
              <button className="btn sm" onClick={() => { setSent((s) => ({ ...s, [pb.id]: true })); onRun(playbookAsk(pb)); }}>
                Run ›
              </button>
            )}
        </div>
      ))}
    </div>
  );
}
