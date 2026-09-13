// Workspace Voice (docs/design/agent-comm-rules-2026-08) — how agents write, everywhere.
// Two shipped rules (defaults ON; the toggle is the opt-out), a single-line house-rules
// list, and a live preview of the exact block agents receive: the preview renders the SAME
// shared houseStyleBlock() the daemon injects, so what you toggle is what they read.
import { COMM_RULE_CAPS, commRulesFrom, type CommRules } from '@neuramesh/shared';
import { Switch } from '../ui/Switch';
import { nm as nmBridge } from '../bridge/nm';
import { useEffect, useState } from 'react';

const nm = nmBridge;

export function VoicePanel() {
  const [rules, setRules] = useState<Required<CommRules> | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void nm?.workspaceSettings().then((s) => setRules(commRulesFrom(s.commRules))).catch(() => setRules(commRulesFrom(null)));
  }, []);
  const save = async (next: Required<CommRules>) => {
    if (!nm || busy) return;
    const prev = rules;
    setBusy(true); setRules(next);
    try { await nm.workspaceUpdate({ commRules: next }); } catch { setRules(prev); } finally { setBusy(false); }
  };
  if (!rules) return null;
  return (
    <>
      <div className="sect" style={{ padding: '6px 0 5px' }}>Voice — how agents write, everywhere</div>
      <div className="failover">
        <div className="failoverrow">
          <div className="failovertxt">
            <b>No em dashes</b>
            <span>Agents use a comma, a period, or parentheses instead of — in everything they write. Titles and replies are also scrubbed server-side.</span>
          </div>
          <Switch on={rules.noEmdash} onToggle={() => void save({ ...rules, noEmdash: !rules.noEmdash })} title={rules.noEmdash ? 'On' : 'Off'} />
        </div>
        <div className="failoverrow">
          <div className="failovertxt">
            <b>STE-100 writing style</b>
            <span>Short sentences, one idea each, active voice, the same word for the same thing. Applies to task names, descriptions, replies, and documents. (The principles of ASD-STE100 — not its controlled dictionary.)</span>
          </div>
          <Switch on={rules.ste100} onToggle={() => void save({ ...rules, ste100: !rules.ste100 })} title={rules.ste100 ? 'On' : 'Off'} />
        </div>
      </div>
      <div className="sect" style={{ padding: '12px 0 5px' }}>House rules — one line each, verbatim to every agent</div>
      {rules.custom.map((c, i) => (
        <div key={i} className="kvline"><span style={{ flex: 1, minWidth: 0 }}>{c}</span>
          <button className="btn sm" disabled={busy} title="Remove this rule"
            onClick={() => void save({ ...rules, custom: rules.custom.filter((_, j) => j !== i) })}>✕</button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <input value={draft} maxLength={COMM_RULE_CAPS.chars} placeholder="Add a rule — one sentence, applies to every agent in this workspace"
          onChange={(e) => setDraft(e.target.value)}
          style={{ flex: 1, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '7px 11px', font: '12.5px var(--fbody)', color: 'var(--text)', outline: 'none' }} />
        <button className="btn" disabled={busy || !draft.trim() || rules.custom.length >= COMM_RULE_CAPS.rules}
          onClick={() => { const c = draft.trim(); setDraft(''); void save({ ...rules, custom: [...rules.custom, c] }); }}>Add</button>
      </div>
    </>
  );
}
