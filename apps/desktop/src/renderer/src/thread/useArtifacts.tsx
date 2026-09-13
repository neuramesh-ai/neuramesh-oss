// A conversation's own produced files — the Artifacts section of its rail. A chat writes real
// files (docs/34) and they used to card in the transcript and be reachable nowhere else; the
// rail is where standing reference lives, whether or not a task stands behind it.
// Split out of thread/ConvoThread.tsx.
import { useEffect, useState } from 'react';
import { nm as nmBridge } from '../bridge/nm';
import type { ChannelArtifactRow } from '../bridge/rows-rooms';
import type { RailSection } from './parts';

const nm = nmBridge;

export function useThreadArtifacts(threadId: string, rowCount: number) {
// This conversation's own produced files — the Artifacts section of its rail. A chat writes
// real files (docs/34) and until now they carded in the transcript and were reachable nowhere
// else; the rail is where standing reference lives, whether or not a task stands behind it.
const [convoArts, setConvoArts] = useState<ChannelArtifactRow[]>([]);
useEffect(() => {
  let dead = false;
  const load = () => { void nm?.threadArtifacts(threadId).then((r) => { if (!dead) setConvoArts(r.artifacts); }, () => {}); };
  load();
  const iv = setInterval(load, 5000);
  return () => { dead = true; clearInterval(iv); };
}, [threadId, rowCount]);
  return convoArts;
}

/**
 * The conversation's Artifacts section, for the Workbench's Details face (2026-08-17).
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
            <button className="artchip" onClick={() => a.inline_content && onOpenDoc?.({ label: a.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' '), file: a.name, doc: a.inline_content })}>
              <span className="akind">{a.kind}</span> <span className="aname">{a.name}</span>
            </button>
            <button className={`star${Number(a.promoted) === 1 ? ' on' : ''}`} title={Number(a.promoted) === 1 ? 'in the channel library' : 'promote to channel library'} disabled={Number(a.promoted) === 1} onClick={() => void nm?.promoteArtifact(a.id)}>
              {Number(a.promoted) === 1 ? '★' : '☆'}
            </button>
          </span>
        ))}
      </div>
    ),
  }];
}
