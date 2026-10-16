import { useState } from 'react';
import { DEFAULT_ENGINEERING_AGENT, engineeringApprovalCommands } from '@neuramesh/shared';
import type { EngineeringSession } from './domain';
import { IconLock } from '../ui/icons';
import { reviewFiles } from './change-review';
import { ChangeCounts } from './EngineeringReview';
import { highlightCode } from '../lib/highlight';
import styles from './EngineeringApproval.module.css';

export function ApprovalCard({ session, onResolve, onReview }: {
  session: EngineeringSession;
  onResolve: (approved: boolean) => void;
  onReview?: ((path?: string) => void) | undefined;
}) {
  const approval = session.pendingApproval;
  const [submitted, setSubmitted] = useState<string | null>(null);
  if (!approval) return null;
  const files = reviewFiles(approval.changes ?? []);
  const commands = engineeringApprovalCommands(approval);
  const busy = submitted === approval.id;
  const resolve = (approved: boolean) => { if (!busy) { setSubmitted(approval.id); onResolve(approved); } };
  return <section className="engapproval" data-state="open" aria-label="Pending approval">
    <div className="engapprovaltop"><span className="engapprovalico"><IconLock s={13} /></span>
      <span><b>{files.length ? 'Review file changes' : approval.category === 'command' && commands.length > 1 ? 'Execute commands' : approval.title}</b>
        <small>{files.length ? `${files.length} ${files.length === 1 ? 'file' : 'files'} proposed. Review the diff before approving.` : approval.category === 'command' ? `Requested by ${session.agent?.name || DEFAULT_ENGINEERING_AGENT.name}` : approval.detail}</small></span>
    </div>
    {!files.length && commands.length > 0 && <div className={styles.commands} role="region" aria-label="Commands awaiting approval" tabIndex={0}>
      {commands.map((command, index) => <div className={styles.commandFrame} key={index}>
        <div className={styles.commandLabel}>{commands.length > 1 ? `Command ${index + 1} of ${commands.length}` : 'Shell command'}</div>
        <pre className={styles.commandPre}><code className={styles.command} aria-label={approval.category === 'command' ? `Command ${index + 1} of ${commands.length}` : undefined} dangerouslySetInnerHTML={{ __html: highlightCode(command, 'command.sh') }} /></pre>
      </div>)}
    </div>}
    {!!files.length && <div className={styles.files}>
      {files.map((file) => <button className={styles.file} disabled={!onReview} key={file.change.path}
        title={file.change.path} aria-label={`Review proposed ${file.change.path}`} onClick={() => onReview?.(file.change.path)}>
        <span className={styles.kind}>{file.kind === 'added' ? 'A' : file.kind === 'deleted' ? 'D' : file.kind === 'renamed' ? 'R' : 'M'}</span>
        <span className={styles.path}>{file.change.path}</span><ChangeCounts additions={file.additions} deletions={file.deletions} />
      </button>)}
    </div>}
    <div className="engapprovalactions">
      {onReview && !!files.length && <button className="btn sm" onClick={() => onReview()}>Review changes</button>}
      <button className="btn sm" disabled={busy} onClick={() => resolve(false)}>Decline</button>
      <button className="btn primary sm" disabled={busy} onClick={() => resolve(true)}>{busy ? 'Sending…' : files.length ? 'Approve changes' : 'Approve once'}</button>
    </div>
  </section>;
}
