// Only actionable approvals, GitHub connection and Plan → Act handoffs sit above the composer.
import { canContinueEngineering, type EngineeringSession } from '@neuramesh/shared';
import type { RepoUI } from '../bridge/rows-board';
import { ApprovalCard } from '../views/EngineeringOS';
import { IconCode } from '../ui/icons';
import { GitHubGate } from './GitHubGate';

function HandoffCard({ session, onContinue, onDismiss }: { session: EngineeringSession; onContinue: () => void; onDismiss: () => void }) {
  const command = session.pendingModeHandoff?.category === 'command';
  return (
    <section className="engmodegate" data-state="open" aria-label="Continue in Act mode">
      <div className="engmodegatetop">
        <span className="engmodegateico"><IconCode s={14} /></span>
        <span><b>{command ? 'Ready to continue' : 'Ready to implement'}</b><small>{command ? 'The proposed command needs Act mode.' : 'Review the proposed work, then continue in Act.'}</small></span>
      </div>
      <div className="engmodegateactions">
        <button className="btn sm" onClick={onDismiss}>Keep planning</button>
        <button className="btn primary sm" onClick={onContinue}><span>Continue in Act</span></button>
      </div>
    </section>
  );
}

export function CodingGate({ inlineFileApproval = false, session, channelId, room, repoRow, repoName, onApproval, onReviewChanges, onContinueInAct, onDismissHandoff, onReopen }: {
  inlineFileApproval?: boolean;
  session: EngineeringSession; channelId: string; room: string; repoRow: RepoUI | null; repoName: string;
  onApproval: (approved: boolean) => void; onReviewChanges: (path?: string) => void; onContinueInAct: () => void; onDismissHandoff: () => void;
  /** the GitHub grant landed: open the session again (useEngineeringRuntime reopen) */
  onReopen: () => void;
}) {
  // a live approval outranks a stored GitHub wait: the machine that asks it reached the code
  if (!inlineFileApproval && session.pendingApproval?.changes?.length) return null; // File approvals live with their durable inline change set.
  if (session.pendingApproval) return <ApprovalCard session={session} onResolve={onApproval} onReview={onReviewChanges} />;
  // the machine cannot reach the code until GitHub is connected: the card leads (docs/design/repo-connect-2026-10)
  if (session.blockedOn === 'github') return <GitHubGate channelId={channelId} room={room} repoName={repoName} folder={repoRow?.org_name === 'local' || repoRow?.provider === 'local'} onConnected={onReopen} />;
  if (canContinueEngineering(session)) return <HandoffCard session={session} onContinue={onContinueInAct} onDismiss={onDismissHandoff} />;
  return null;
}
