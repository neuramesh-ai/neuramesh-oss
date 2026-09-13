// An external A2A agent, added by its card URL. Extracted from App.tsx (track A4).
import { ChannelPicker } from './CreateAgent';
import { Modal } from '../ui/Modal';
import { anchorPoint } from '../ui/anchor';
import { nm as nmBridge } from '../bridge/nm';
import { type ChannelRow } from '../bridge/rows-rooms';
import { type WorkspaceProjectRow } from '../bridge/rows-board';
import { useEffect, useRef, useState } from 'react';

// Imported bindings lose control-flow narrowing inside closures, so re-bind (same as App.tsx).
const nm = nmBridge;

// Connect an external A2A agent by its card URL — it joins the roster as a
// 'remote' agent the orchestrator can offer tasks to (delegated over A2A).
export function AddRemoteAgent({ channels, projects, onDone, onClose }: { channels: ChannelRow[]; projects: WorkspaceProjectRow[]; onDone: () => void; onClose: () => void }) {
  const [url, setUrl] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const seeded = useRef(false);
  // default an external agent into #general only (channel IDS — slugs collide across projects), matching
  // CreateAgent's isolation-by-default; the human widens its rooms here. Was seeding slugs, which the
  // id-keyed picker couldn't match and the server resolved to the default project's room.
  useEffect(() => { if (!seeded.current && channels.length) { seeded.current = true; setPicked(new Set(channels.filter((c) => c.slug === 'general').map((c) => c.id))); } }, [channels]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const valid = /^https?:\/\/.+/.test(url.trim());
  const submit = async () => {
    if (!nm || !valid || busy || !picked.size) return;
    setBusy(true); setErr('');
    try { await nm.agentConnectRemote(url.trim(), [...picked]); onDone(); onClose(); }
    catch (e) { setErr(e instanceof Error ? e.message.replace(/^Error invoking remote method.*?: Error: /, '').slice(0, 200) : 'could not connect'); setBusy(false); }
  };
  return (
    <Modal
      title="Add external agent"
      onClose={onClose}
      // a FORM, so it keeps the measure and merely pivots out of the row that opened it — and it
      // drops the veil, like every other surface that is a step rather than a decision (docs/33 §2)
      anchored
      origin={anchorPoint()}
    >
      <p className="modalhint">Connect an agent hosted elsewhere by its A2A Agent Card URL (its <code>/.well-known/a2a/agent-card.json</code>). It joins the roster and the orchestrator can offer it tasks — delegated over A2A; only the task + requirements are sent, never your code or keys.</p>
      <div className="fld"><label>Agent Card URL</label>
        <input autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/.well-known/a2a/agent-card.json" onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }} /></div>
      <div className="fld"><label>Channels (where it can receive work)</label>
        <ChannelPicker channels={channels} picked={picked} onChange={setPicked} projects={projects} /></div>
      {err && <div className="acterr" style={{ marginTop: 8 }}>{err}</div>}
      <button className="btn primary" disabled={!valid || busy || !picked.size} onClick={() => void submit()}>{busy ? 'Connecting…' : 'Connect agent'}</button>
    </Modal>
  );
}
