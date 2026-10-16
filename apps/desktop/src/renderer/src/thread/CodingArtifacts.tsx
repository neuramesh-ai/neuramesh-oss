import { useEffect, useMemo, useRef, useState } from 'react';
import { artifactMime } from '@neuramesh/shared';
import type { ChannelArtifactRow } from '../bridge/rows-rooms';
import { useArtifactContent } from './useArtifactContent';
import { artifactContent } from '../wtabs/artifact-content';
import { useArtifactUrl } from '../wtabs/ArtifactMedia';
import { nm } from '../bridge/nm';
import { IconFile } from '../ui/icons';
import { codingArtifactReference, latestCodingArtifacts } from './coding-artifacts';
import { useThreadArtifactInventory } from './useArtifacts';
import styles from '../engineering/EngineeringChangeCard.module.css';

function ArtifactImage({ row, open }: { row: ChannelArtifactRow; open: () => void }) {
  const { artifact, error } = useArtifactContent(row);
  const media = useMemo(() => artifact?.inline_content ? artifactContent(row.name, artifact.inline_content) : null, [row.name, artifact?.inline_content]);
  const url = useArtifactUrl(media?.kind === 'image' ? media.blob : null);
  return url ? <button className="msgimg" title={`Open ${row.name}`} onClick={open}><img src={url} alt={row.name} loading="lazy" /></button>
    : error ? <span role="alert">{error}</span> : null;
}

/** Coding deliverables are cloud records, independent of an execution host or its checkout. */
export function useCodingArtifacts(threadId: string, rowCount: number, onOpenDoc?: (doc: { label: string; file: string; doc: string }) => void) {
  const inventory = useThreadArtifactInventory(threadId, rowCount);
  const artifacts = latestCodingArtifacts(inventory.rows);
  const request = useRef(0);
  const currentThread = useRef(threadId);
  currentThread.current = threadId;
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { currentThread.current = threadId; setLoading(null); setError(null); return () => { currentThread.current = ''; request.current++; }; }, [threadId]);
  const open = async (id: string) => {
    if (!onOpenDoc) return;
    const ticket = ++request.current;
    const current = () => currentThread.current === threadId && ticket === request.current;
    setLoading(id); setError(null);
    try {
      // Always fetch by ID: brain metadata may intentionally contain no inline bytes.
      const artifact = (await nm?.artifact(id))?.artifact;
      if (!current()) return;
      if (artifact?.inline_content == null) throw new Error('The file content is unavailable.');
      onOpenDoc({ label: 'Thread artifact', file: artifact.name, doc: artifact.inline_content });
    } catch (reason) {
      if (current()) setError(reason instanceof Error ? reason.message : 'The file could not load.');
    } finally { if (current()) setLoading(null); }
  };
  const fileRef = (name: string) => !!onOpenDoc && !!codingArtifactReference(artifacts, name);
  const openFile = (name: string) => { const artifact = codingArtifactReference(artifacts, name); if (artifact) void open(artifact.id); };
  const list = (rows: ChannelArtifactRow[]) => <div className={styles.files}>{rows.map(artifact => <button key={artifact.id} className={styles.file} disabled={loading !== null} aria-busy={loading === artifact.id} onClick={() => void open(artifact.id)} aria-label={`Open artifact ${artifact.name}`}>
    <IconFile s={14} /><span className={styles.path} title={artifact.name}>{artifact.name}</span><span>Open ↗</span>
  </button>)}</div>;
  const feedback = <>
    {inventory.error ? <p className={styles.note} role="alert">{inventory.error} <button onClick={inventory.retry}>Retry</button></p> : null}
    {error ? <p className={styles.note} role="alert">{error}</p> : null}
  </>;
  const cardFor = (rows: ChannelArtifactRow[]) => rows.length > 0 && onOpenDoc ? <section className={styles.card} aria-label="Thread artifacts">
    <header className={styles.header}><span className={styles.icon}><IconFile s={16} /></span><span className={styles.heading}><b>Artifacts · {rows.length}</b></span></header>
    <div className="msgatts" style={{ margin: '10px 14px' }}>{rows.filter(row => artifactMime(row.name).startsWith('image/')).map(row => <ArtifactImage key={row.id} row={row} open={() => void open(row.id)} />)}</div>
    {list(rows)}{error ? <p className={styles.note} role="alert">{error}</p> : null}
  </section> : null;
  const pane = <section className="engcheckpoints" aria-label="Thread artifacts">
    <div className="engcheckpointintro"><b>Artifacts · {artifacts.length}</b>
    <span>Open a file to preview or download it.</span></div>
    {inventory.loading ? <p role="status">Loading artifacts…</p> : null}
    {!inventory.loading && !inventory.error && !artifacts.length ? <p>No saved artifacts yet. Deliverables appear here when the agent saves them.</p> : null}
    {list(artifacts)}{feedback}
  </section>;
  return { card: cardFor(artifacts), cardFor, timelineRows: inventory.rows, pane, fileRef, openFile, rows: artifacts, error: inventory.error };
}
