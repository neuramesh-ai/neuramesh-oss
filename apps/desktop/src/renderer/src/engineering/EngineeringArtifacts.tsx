import { useState } from 'react';
import { useCodingArtifacts } from '../thread/CodingArtifacts';
import { WFileView } from '../wtabs/filetree';
import type { WTabMode } from '../wtabs';

/** The legacy Code workspace uses the same inventory and reader as the thread's right pane. */
export function EngineeringArtifacts({ threadId, revision }: { threadId: string; revision: number }) {
  const [selected, setSelected] = useState<{ owner: string; name: string; content: string } | null>(null);
  const [mode, setMode] = useState<WTabMode>('preview');
  const artifacts = useCodingArtifacts(threadId, revision, doc => { setMode('preview'); setSelected({ owner: threadId, name: doc.file, content: doc.doc }); });
  const doc = selected?.owner === threadId ? selected : null;
  return doc ? <>
    <button onClick={() => setSelected(null)}>← All artifacts</button>
    <WFileView tab={{ id: doc.name, kind: 'file', title: doc.name, readOnly: true, mode }} doc={doc} onMode={setMode} onDirty={() => {}} />
  </> : artifacts.pane;
}
