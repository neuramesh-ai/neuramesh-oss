// A conversation's own produced files — the Artifacts section of its rail. A chat writes real
// files (docs/34) and they used to card in the transcript and be reachable nowhere else; the
// rail is where standing reference lives, whether or not a task stands behind it.
// Split out of thread/ConvoThread.tsx.
import { useEffect, useState } from 'react';
import { nm as nmBridge } from '../bridge/nm';
import type { ChannelArtifactRow } from '../bridge/rows-rooms';
import type { RailSection } from './parts';

const nm = nmBridge;

function ArtifactOpenButton({ artifact: a, onOpenDoc }: { artifact: ChannelArtifactRow; onOpenDoc?: (d: { label: string; file: string; doc: string }) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const open = async () => {
    setLoading(true); setError(null);
    try {
      const row = a.storage_path?.startsWith('brain:') || !a.inline_content ? (await nm?.artifact(a.id))?.artifact : a;
      if (!row?.inline_content) throw new Error('The file content is unavailable.');
      onOpenDoc?.({ label: a.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' '), file: a.name, doc: row.inline_content });
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The file could not load.'); }
    finally { setLoading(false); }
  };
  return <><button className="artchip" disabled={loading} aria-busy={loading} onClick={() => void open()}>
    <span className="akind">{a.kind}</span> <span className="aname">{a.name}</span>
  </button>{error && <span role="alert">{error}</span>}</>;
}

export function useThreadArtifactInventory(threadId: string, rowCount: number) {
  const [loaded, setLoaded] = useState<{ threadId: string; rows: ChannelArtifactRow[]; error: string | null } | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let dead = false, busy = false;
    const load = async () => {
      if (busy) return;
      busy = true;
      try {
        if (!nm) throw new Error('The artifact service is unavailable.');
        const result = await nm.threadArtifacts(threadId);
        if (!dead) setLoaded({ threadId, rows: result.artifacts, error: null });
      } catch (reason) {
        if (!dead) setLoaded(previous => ({ threadId, rows: previous?.threadId === threadId ? previous.rows : [], error: reason instanceof Error ? reason.message : 'Artifacts could not load.' }));
      } finally { busy = false; }
    };
    void load();
    const interval = setInterval(() => void load(), 5000);
    return () => { dead = true; clearInterval(interval); };
  }, [threadId, rowCount, retry]);
  const current = loaded?.threadId === threadId ? loaded : null;
  return { rows: current?.rows ?? [], error: current?.error ?? null, loading: !current, retry: () => setRetry(n => n + 1) };
}
export function useThreadArtifacts(threadId: string, rowCount: number) {
  return useThreadArtifactInventory(threadId, rowCount).rows;
}

/**
 * The conversation's Artifacts section, for the side panel's Overview tab (2026-08-17; the
 * Workbench's Details face until 2026-10-03).
 *
 * It lives beside the hook that loads the rows rather than inside `ConvoThread`, which is where
 * it was written and where it pushed the file past the size gate. Same markup, same star: `☆`
 * promotes to the channel library, `★` says a human already shelved it (the Files ruling —
 * curation is a marker, not a gate).
 */
export function convoArtifactSection(
  arts: ChannelArtifactRow[],
  onOpenDoc?: (d: { label: string; file: string; doc: string }) => void,
): RailSection[] {
  if (!arts.length) return [];
  return [{
    key: 'artifacts',
    head: 'Artifacts',
    meta: String(arts.length),
    body: (
      <div className="tarts">
        {arts.map((a) => (
          <span key={a.id} className="artgroup">
            <ArtifactOpenButton artifact={a} {...(onOpenDoc ? { onOpenDoc } : {})} />
            <button className={`star${Number(a.promoted) === 1 ? ' on' : ''}`} title={Number(a.promoted) === 1 ? 'in the channel library' : 'promote to channel library'} disabled={Number(a.promoted) === 1} onClick={() => void nm?.promoteArtifact(a.id)}>
              {Number(a.promoted) === 1 ? '★' : '☆'}
            </button>
          </span>
        ))}
      </div>
    ),
  }];
}
