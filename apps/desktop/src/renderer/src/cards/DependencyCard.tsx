// The dependency card (docs/design/triage-preflight-2026-08) — what a run needs before it can
// be staffed, with the fix on the card rather than filed as work for the human to do later.
//
// It is the FIRST thing you see, not the last: run_playbook refuses to create a unit whose
// needs are unmet and posts this instead, so a missing connector can never resurface at the end
// of a run as four tasks asking you to go and connect one.
import { useState } from 'react';
import { nm as nmBridge } from '../bridge/nm';
import type { NmNeed } from '@neuramesh/shared';

const nm = nmBridge;

const LABEL: Record<string, string> = { x: 'X (Twitter)', linkedin: 'LinkedIn', instagram: 'Instagram', tiktok: 'TikTok' };
const GLYPH: Record<string, string> = { x: '𝕏', linkedin: 'in', instagram: '◫', tiktok: '♪' };

export function DependencyCard({ data }: { data: NmNeed }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const connect = async (provider: string) => {
    if (!nm) return;
    setBusy(provider);
    // the SAME external-browser round-trip Connections runs (AlertsBar's reconnect door) —
    // one path to authorize, so the card can never drift from the panel
    try { await nm.connectorStart(data.channel, provider as never); setDone(provider); }
    finally { setTimeout(() => setBusy(null), 2500); }
  };
  return (
    <div className="needcard">
      <div className="ndhead">⚠ Can't run yet — {data.ask} needs a connected account</div>
      <div className="ndwhy">{data.why}</div>
      {data.connect.map((p) => {
        const readable = data.readable?.includes(p);
        return (
          <button key={p} className={`ndopt${readable ? ' primary' : ''}`} disabled={busy === p} onClick={() => void connect(p)}>
            <span className="g" aria-hidden>{GLYPH[p] ?? '•'}</span>
            <span className="ndtxt">
              <b>{busy === p ? 'Opening browser…' : done === p ? `Finish in the browser — ${LABEL[p] ?? p}` : `Connect ${LABEL[p] ?? p}`}</b>
              <span>{readable
                ? 'one minute in the browser · real conversations and real engagement numbers'
                : 'publishing today; its conversations are covered by public research, without measured reach'}</span>
            </span>
          </button>
        );
      })}
      <div className="ndfoot">Nothing was created — no task, no subtask, no offer. Connect one and ask again.</div>
    </div>
  );
}
