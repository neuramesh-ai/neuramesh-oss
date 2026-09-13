// THE HOSTED GATE CARD — a cloud workspace on the Free plan (the source-release round, review F6,
// artboard E; docs/33 §8). It docks where the composer stood, in the thread and on Home, and the
// composer does not render beside it: a typed message on a `free` hosted workspace is refused by
// the upload lane and vanishes at the next checkpoint, so a box that accepts text there is a trap.
// Reads stay. Get Pro opens the one upgrade sheet through its own door (lib/toast.ts). Export
// asks main for the workspace zip; before the U1b route lands a 404 says one sentence and no more.
import { useEffect, useState } from 'react';
import { nm as nmBridge } from '../bridge/nm';
import { openUpgrade } from '../lib/toast';

// Imported bindings lose control-flow narrowing inside closures, so re-bind (same as App.tsx).
const nm = nmBridge;

/** every sentence a person reads on this card (CLAUDE.md #11) — the artboard's words */
export const HOSTED_GATE_COPY = {
  eyebrow: 'Pro',
  title: 'This workspace needs Pro',
  sub: 'Your threads and files stay readable. Pro turns writes back on.',
  get: 'Get Pro',
  export: 'Export workspace',
  busy: 'Please wait…',
  foot: 'Files on your cloud machine are not in the export',
  notAvailable: 'The export is not available yet.',
  saved: (path: string) => `Saved to ${path}`,
} as const;

export function HostedGate({ variant = 'thread' }: { variant?: 'thread' | 'stage' }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // said out loud (main sees it under --enable-logging): the gate docked, and the composer is back
  useEffect(() => { console.log(`hosted_gate docked variant=${variant}`); return () => console.log(`hosted_gate lifted variant=${variant}`); }, [variant]);
  const exportWs = async () => {
    if (busy) return;
    setBusy(true); setNote(null);
    try {
      const r = await nm?.workspaceExport?.();
      if (!r) return;
      if (r.ok) setNote(HOSTED_GATE_COPY.saved(r.path));
      else if (r.code === 'NOT_AVAILABLE') setNote(HOSTED_GATE_COPY.notAvailable);
      else if (r.code === 'FAILED') setNote(r.message ?? 'The export failed.');
    } catch (e) {
      setNote(e instanceof Error ? e.message.replace(/^Error invoking remote method.*?: Error: /, '') : 'The export failed.');
    } finally { setBusy(false); }
  };
  return (
    <div className={`hgate ${variant}`} role="group" aria-label={HOSTED_GATE_COPY.title}>
      <span className="hgateeye">{HOSTED_GATE_COPY.eyebrow}</span>
      <h2 className="hgateh">{HOSTED_GATE_COPY.title}</h2>
      <p className="hgatep">{HOSTED_GATE_COPY.sub}</p>
      <div className="hgateacts">
        <button type="button" className="btn primary" onClick={() => openUpgrade()}>{HOSTED_GATE_COPY.get}</button>
        <button type="button" className="btn" disabled={busy} onClick={() => void exportWs()}>{busy ? HOSTED_GATE_COPY.busy : HOSTED_GATE_COPY.export}</button>
        {note && <span className="hgatenote" role="status">{note}</span>}
      </div>
      <div className="hgatefoot"><span className="hgatemono">{HOSTED_GATE_COPY.foot}</span></div>
    </div>
  );
}
