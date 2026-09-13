// THE DOC-DROP CARD — an agent's library doc (or proposal) worn as a bounded, scrollable
// card (docdrop.ts owns the wire shape). Extracted from ThreadMessage.tsx in the
// marketing-os round to hold that file's line cap; the approve gate is unchanged — the
// human's shelf, the human's call.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Md } from '../md/Md';
import { nm as nmBridge } from '../bridge/nm';
import { reportFrom } from '@neuramesh/shared';
import { ReportBody } from './ReportCard';
import type { DocDrop } from '../docdrop';

const nm = nmBridge;

export function DocDropCard({ drop, channelId, onOpen }: {
  drop: DocDrop;
  channelId: string;
  onOpen?: (d: DocDrop) => void;
}) {
  // null = not looked up yet; never render the gate on an unknown, or an already-approved doc
  // flashes its Approve button on every mount.
  const [shelved, setShelved] = useState<boolean | null>(null);
  const refresh = useCallback(async () => {
    if (!nm) return;
    const { artifacts } = await nm.channelArtifacts(channelId).catch(() => ({ artifacts: [] as Array<{ name: string; promoted: number | null }> }));
    setShelved(artifacts.some((a) => a.name === drop.file && !!a.promoted));
  }, [channelId, drop.file]);
  useEffect(() => { void refresh(); }, [refresh]);
  const pending = drop.pending && shelved === false;
  // a doc that PARSES as a scored report wears the scorecard body (found live: the working
  // turn delivered the audit via propose_library_doc, the third door) — head + gate unchanged
  const report = useMemo(() => reportFrom(drop.file, drop.doc), [drop.file, drop.doc]);
  const approve = async () => {
    if (!nm) return;
    const { artifacts } = await nm.channelArtifacts(channelId).catch(() => ({ artifacts: [] as Array<{ id: string; name: string; created_at: string }> }));
    // newest of that name: proposing the same name again supersedes, so the freshest row is the offer
    const hit = artifacts.filter((a) => a.name === drop.file)
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
    if (hit) await nm.promoteArtifact(hit.id).catch(() => {});
    await refresh();
  };
  return (
    <div className={`mkdocdrop${pending ? ' pending' : ''}`}>
      <div className="mkdochead">
        <span aria-hidden>📄</span><b>{drop.label}</b><code>{drop.file}</code>
        {pending ? <span className="mkdocpend">proposed</span>
          : shelved ? <span className="mkdocshelved">in library</span> : null}
        {onOpen && <button className="mkdocopen" title="Open in a tab" aria-label={`Open ${drop.file} in a tab`} onClick={() => onOpen(drop)}>↗</button>}
      </div>
      {report
        ? <div className="repcard infile"><ReportBody meta={report} /></div>
        : <div className="mkdoccard"><div className="plBody"><Md text={drop.doc} /></div></div>}
      {/* The human's shelf, the human's call — an agent drafts, only this promotes. */}
      {pending && (
        <div className="mkdocgate">
          <span className="mkdocgatehint">Add it to the library?</span>
          <button className="mkdocapprove" onClick={() => void approve()}>✓ Add to library</button>
        </div>
      )}
    </div>
  );
}
