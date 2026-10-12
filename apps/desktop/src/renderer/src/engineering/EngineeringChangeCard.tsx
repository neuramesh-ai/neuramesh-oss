import { useState } from 'react';
import type { EngineeringChangeReview } from '@neuramesh/shared';
import { IconChevron, IconFile } from '../ui/icons';
import { reviewFiles } from './change-review';
import { ChangeCounts } from './EngineeringReview';
import styles from './EngineeringChangeCard.module.css';

export type OpenChangeReview = (review: EngineeringChangeReview, path?: string) => void;
export const changeReviewLabel = (status: EngineeringChangeReview['status']): string => ({ proposed: 'Proposed changes', approved: 'Approved · applying', applied: 'Edited', declined: 'Declined changes', failed: 'Edit failed', interrupted: 'Unconfirmed changes', recorded: 'Recorded changes' })[status];

/** A batch stays at its original position, with its own immutable file snapshots, after the approval gate closes. */
export function EngineeringChangeCard({ review, pending = false, onOpen, onResolve }: { review: EngineeringChangeReview; pending?: boolean; onOpen?: OpenChangeReview; onResolve?: (approved: boolean) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const files = reviewFiles(review.changes);
  const shown = expanded ? files : files.slice(0, 3);
  const additions = files.reduce((n, file) => n + file.additions, 0);
  const deletions = files.reduce((n, file) => n + file.deletions, 0);
  const resolve = (approved: boolean) => { setSubmitted(true); onResolve?.(approved); };
  return <section className={styles.card} aria-label="File change set" data-change-review={review.id} data-status={review.status}>
    <header className={styles.header}>
      <span className={styles.icon}><IconFile s={16} /></span>
      <span className={styles.heading}><b>{review.status === 'applied' ? 'Edited' : changeReviewLabel(review.status)}{review.status === 'applied' ? ' ' : ' · '}<span>{files.length} file{files.length === 1 ? '' : 's'}</span></b><ChangeCounts additions={additions} deletions={deletions} /></span>
      {onOpen ? <button className={styles.view} onClick={() => onOpen(review)}>View changes</button> : null}
    </header>
    <div className={styles.files}>{shown.map((file) => <button key={file.change.path} className={styles.file} onClick={() => onOpen?.(review, file.change.path)} disabled={!onOpen} aria-label={`Review ${file.change.path} in this change set`}>
      <span className={styles.kind} title={file.kind}>{file.kind === 'added' ? 'A' : file.kind === 'deleted' ? 'D' : file.kind === 'renamed' ? 'R' : 'M'}</span>
      <span className={styles.path} title={file.change.path}>{file.change.path}</span><ChangeCounts additions={file.additions} deletions={file.deletions} />
    </button>)}</div>
    {files.length > 3 ? <button className={styles.more} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? 'Show fewer files' : `Show ${files.length - 3} more file${files.length === 4 ? '' : 's'}`}<IconChevron s={12} /></button> : null}
    {review.status === 'failed' || review.status === 'interrupted' ? <p className={styles.note}>{review.status === 'failed' ? 'The edit did not finish successfully. This card preserves the proposed diff.' : 'The outcome was not confirmed. This card preserves the proposed diff.'}</p> : null}
    {pending && onResolve ? <footer className={styles.actions}><span>Review this diff before approving.</span><button className="btn sm" disabled={submitted} onClick={() => resolve(false)}>Decline</button><button className="btn primary sm" disabled={submitted} onClick={() => resolve(true)}><span>{submitted ? 'Submitting…' : 'Approve changes'}</span></button></footer> : null}
  </section>;
}
