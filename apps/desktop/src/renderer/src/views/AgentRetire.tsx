// Retirement and rehire — the end of an agent's life on the roster, and its way back.
// Split out of views/AgentDetails.tsx: its three pieces of state, the two commands and the
// markup were the only things in that panel that touched each other and nothing else.
//
// Retiring is two-step on purpose, and the server's refusal (open work) is shown inline
// rather than swallowed — the agent stays on the roster and the human reads why.
import { useState } from 'react';
import { cleanCmdErr } from '../lib/text';
import { nm as nmBridge } from '../bridge/nm';
import type { AgentRow } from '../bridge/rows-crew';

const nm = nmBridge;

export function AgentRetire({ agent, isRetired, onSaved, onClose }: { agent: AgentRow; isRetired: boolean; onSaved: () => void; onClose: () => void }) {
  // Two-step confirm; the server's CONFLICT (open tasks) surfaces as the inline error.
  const [retireArm, setRetireArm] = useState(false);
  const [retireBusy, setRetireBusy] = useState(false);
  const [retireErr, setRetireErr] = useState('');
  const doRetire = async () => {
    if (!nm || retireBusy) return;
    setRetireBusy(true); setRetireErr('');
    try { await nm.agentRetire(agent.id); onSaved(); onClose(); }
    catch (e) { setRetireErr(cleanCmdErr(e)); setRetireArm(false); setRetireBusy(false); }
  };
  const rehireChannels = (agent.channel_ids ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const canRehire = agent.kind !== 'remote' && rehireChannels.length > 0;
  const doRehire = async () => {
    if (!nm || retireBusy || !canRehire) return;
    setRetireBusy(true); setRetireErr('');
    try { await nm.registerAgent({ name: agent.name, role: agent.role, model: agent.model, runtime: agent.runtime ?? 'claude-code', channels: rehireChannels }); onSaved(); onClose(); }
    catch (e) { setRetireErr(cleanCmdErr(e)); setRetireBusy(false); }
  };
  return (
    <>
      <div className="sect" style={{ padding: '16px 0 5px' }}>{isRetired ? 'Rehire' : 'Retirement'}</div>
    {isRetired ? (
      <>
        <p className="modalhint">Rehiring restores @{agent.name} to the roster with its history intact — same identity, same channels{canRehire ? '' : agent.kind === 'remote' ? '. External agents rejoin via their A2A card URL (Add external agent).' : '. This agent has no channel memberships left — recreate it via + Create agent.'}</p>
        {canRehire && <button className="btn primary" disabled={retireBusy} onClick={() => void doRehire()}>{retireBusy ? 'Rehiring…' : `Rehire @${agent.name}`}</button>}
      </>
    ) : (
      <>
        <p className="modalhint">Retiring removes @{agent.name} from the roster, pools, and A2A discovery. Its task history and lessons stay — and re-registering the same name rehires it. Refused while it has open work.</p>
        {!retireArm
          ? <button className="btn danger" onClick={() => setRetireArm(true)}>Retire @{agent.name}…</button>
          : (
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn danger" disabled={retireBusy} onClick={() => void doRetire()}>{retireBusy ? 'Retiring…' : 'Confirm — retire now'}</button>
              <button className="btn" disabled={retireBusy} onClick={() => setRetireArm(false)}>Keep</button>
            </div>
          )}
      </>
    )}
    {retireErr && <div className="acterr" style={{ marginTop: 8 }}>{retireErr}</div>}
    </>
  );
}
