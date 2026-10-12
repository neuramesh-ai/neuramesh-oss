import { useEffect, useRef, useState } from 'react';
import { nm } from '../bridge/nm';
import { IconFile } from '../ui/icons';
import { codingArtifactReference, latestCodingArtifacts } from './coding-artifacts';
import { useThreadArtifacts } from './useArtifacts';
import styles from '../engineering/EngineeringChangeCard.module.css';

/** Coding deliverables are cloud records, independent of an execution host or its checkout. */
export function useCodingArtifacts(threadId: string, rowCount: number, onOpenDoc?: (doc: { label: string; file: string; doc: string }) => void) {
  const artifacts = latestCodingArtifacts(useThreadArtifacts(threadId, rowCount));
  const currentThread = useRef(threadId);
  currentThread.current = threadId;
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { currentThread.current = threadId; setLoading(null); setError(null); return () => { currentThread.current = ''; }; }, [threadId]);
  const open = async (id: string) => {
    if (!onOpenDoc) return;
    setLoading(id); setError(null);
    try {
      // Always fetch by ID: brain metadata may intentionally contain no inline bytes.
      const artifact = (await nm?.artifact(id))?.artifact;
      if (currentThread.current !== threadId) return;
      if (artifact?.inline_content == null) throw new Error('The file content is unavailable.');
      onOpenDoc({ label: 'Thread artifact', file: artifact.name, doc: artifact.inline_content });
    } catch (reason) {
      if (currentThread.current === threadId) setError(reason instanceof Error ? reason.message : 'The file could not load.');
    } finally { if (currentThread.current === threadId) setLoading(null); }
  };
  const fileRef = (name: string) => !!onOpenDoc && !!codingArtifactReference(artifacts, name);
  const openFile = (name: string) => { const artifact = codingArtifactReference(artifacts, name); if (artifact) void open(artifact.id); };
  const card = artifacts.length && onOpenDoc ? <section className={styles.card} aria-label="Thread artifacts">
    <header className={styles.header}><span className={styles.icon}><IconFile s={16} /></span><span className={styles.heading}><b>Artifacts · {artifacts.length}</b></span></header>
    <div className={styles.files}>{artifacts.map(artifact => <button key={artifact.id} className={styles.file} disabled={loading !== null} aria-busy={loading === artifact.id} onClick={() => void open(artifact.id)} aria-label={`Open artifact ${artifact.name}`}>
      <IconFile s={14} /><span className={styles.path}>{artifact.name}</span><span>Open ↗</span>
    </button>)}</div>
    {error ? <p className={styles.note} role="alert">{error}</p> : null}
  </section> : null;
  return { card, fileRef, openFile, rows: artifacts };
}
