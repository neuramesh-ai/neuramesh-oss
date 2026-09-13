// Archived chats — the room's put-away conversations. Extracted from App.tsx (track A2).
import { nm as nmBridge } from '../bridge/nm';
import { plainTitle } from '../room-tabs';
import { timeAgoShort } from '../lib/time';
import { type ArchivedThreadRow } from '../bridge/rows-infra';
import { useEffect, useState } from 'react';

// Imported bindings lose control-flow narrowing inside closures, so re-bind (same as App.tsx).
const nm = nmBridge;

/**
 * Settings › Archived chats (0108) — the only way back.
 *
 * Every other list in the app filters `archived_at is not null` out, which is what makes archiving
 * different from a read-state: an archived conversation is genuinely unreachable until it is
 * brought back here. Unarchiving restores it exactly where it was, because nothing was destroyed.
 */
export function ArchivedChatsPanel() {
  const [rows, setRows] = useState<ArchivedThreadRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => (nm ? nm.watchArchivedThreads((r) => setRows(r)) : undefined), []);
  const unarchive = async (id: string) => {
    setBusy(id);
    try { await nm?.threadUnarchive(id); } finally { setBusy(null); }
  };
  if (rows === null) return <div className="archempty">Loading…</div>;
  return (
    <>
      <div className="sect" style={{ padding: '6px 0 8px' }}>
        {rows.length ? `${rows.length} archived` : 'Archived chats'}
      </div>
      <p className="setnote" style={{ marginTop: 0 }}>
        Hidden from Home, from every room and from search. Unarchive to bring one back — nothing is deleted.
      </p>
      {!rows.length && <div className="archempty">No archived chats. Archive one from its row in any session list.</div>}
      {rows.map((r) => (
        <div key={r.id} className="archrow">
          <span className="ab">
            <span className="at">{plainTitle(r.title)}</span>
            <span className="asub">#{r.channel_slug} · archived {timeAgoShort(r.archived_at)} ago</span>
          </span>
          <button type="button" className="aun" disabled={busy === r.id} onClick={() => void unarchive(r.id)}>
            {busy === r.id ? 'Unarchiving…' : 'Unarchive'}
          </button>
        </div>
      ))}
    </>
  );
}
