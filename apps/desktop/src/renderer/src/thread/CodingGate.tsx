// THE GATE SEAT (coding threads §5, docs/25): exactly ONE card docked above the composer — the
// approval card while an edit or a command waits, else the Act handoff ("Ready to implement"),
// else the valve on a RESTING thread with something to carry (§5.2), else nothing.
//
// The valve is HUMAN_ONLY by construction: a button on a person's screen, and rex holds no tool
// for it. The click creates a plan-first unit ANCHORED to this conversation (originThread: the
// ‹task:id› unit card lands here and the thread stays a coding thread, docs/41). The branch, the
// root ask, the work plan and the diff ride the description, and the repository makes the review
// leg non-declinable (validateWorkPlanLegs).
import { useState } from 'react';
import { combinedDiff, type EngineeringSession } from '@neuramesh/shared';
import type { RepoUI } from '../bridge/rows-board';
import { nm } from '../bridge/nm';
import { ApprovalCard } from '../views/EngineeringOS';
import { IconCode } from '../ui/icons';
import { GitHubGate } from './GitHubGate';

const RESTING = new Set<EngineeringSession['state']>(['idle', 'completed', 'resumable']);
const DIFF_CAP = 24_000;
const valveKey = (threadId: string) => `nm:codingvalve:${threadId}`;

function HandoffCard({ session, onContinue, onDismiss }: { session: EngineeringSession; onContinue: () => void; onDismiss: () => void }) {
  const command = session.pendingModeHandoff?.category === 'command';
  return (
    <section className="engmodegate" data-state="open" aria-label="Continue in Act mode">
      <div className="engmodegatetop">
        <span className="engmodegateico"><IconCode s={14} /></span>
        <span><b>{command ? 'Ready to continue' : 'Ready to implement'}</b><small>{command ? 'Continue in Act to apply the plan and run its checks.' : 'The plan is complete. Continue in Act to apply it.'}</small></span>
      </div>
      <div className="engmodegateactions">
        <button className="btn sm" onClick={onDismiss}>Keep planning</button>
        <button className="btn primary sm" onClick={onContinue}><span>Continue in Act</span></button>
      </div>
    </section>
  );
}

function CodingValve({ session, threadId, channelId, title, repoRow, repoName, root, onMade }: {
  session: EngineeringSession; threadId: string; channelId: string; title: string; repoRow: RepoUI; repoName: string; root: string | null; onMade: (taskId: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // "Keep it here" is remembered per thread in this browser — a resting thread must not re-ask on every open
  const [kept, setKept] = useState(() => { try { return localStorage.getItem(valveKey(threadId)) === '1'; } catch { return false; } });
  if (kept) return null;
  const changes = session.changes;
  const keep = () => { setKept(true); try { localStorage.setItem(valveKey(threadId), '1'); } catch { /* a per-viewer convenience only */ } };
  const make = async () => {
    if (!nm) return;
    setBusy(true); setErr(null);
    try {
      const diff = combinedDiff(changes);
      const clipped = diff.length > DIFF_CAP ? `${diff.slice(0, DIFF_CAP)}\n… ${diff.length - DIFF_CAP} more characters. The full diff stays in the coding thread.` : diff;
      const description = [
        `From the coding thread **${title}** on ${repoName} (branch \`${session.repo.branch}\`).`,
        root ? `\n> ${root.trim().split('\n').join('\n> ')}` : '',
        session.workPlan ? `\n${session.workPlan}` : '',
        changes.length ? `\n### Changes (${changes.length})\n${changes.map((c) => `- ${c.kind} \`${c.path}\``).join('\n')}\n\n\`\`\`diff\n${clipped}\n\`\`\`` : '',
      ].filter(Boolean).join('\n');
      const approach = session.workPlan ?? `Continue the work the coding thread started on ${repoName}: land the changes on the unit's branch, open the pull request, and pass review.`;
      const { task } = await nm.createTask(channelId, title, { description, repoId: repoRow.id, baseRef: repoRow.default_branch || 'main', originThread: threadId, plan: { legs: ['build', 'review'], subtasks: [], approach } });
      onMade(task.id);
    } catch (e) { setErr(e instanceof Error ? e.message : 'The unit was not created.'); }
    finally { setBusy(false); }
  };
  const carry = changes.length ? `${changes.length} ${changes.length === 1 ? 'change' : 'changes'}` : 'a work plan';
  return (
    <div className="hgate coding" role="group" aria-label="Make this a unit">
      <span className="hgateeye">coding · {carry} · ⎇ {session.repo.branch} · not a unit</span>
      <h2 className="hgateh">Make this a unit?</h2>
      <p className="hgatep">The unit keeps the branch and the diff. It starts in plan review. Then it takes the normal road: build, review, ship, accept.</p>
      <div className="hgateacts">
        <button className="btn primary" disabled={busy} onClick={make}><span>Make it a unit</span></button>
        <button className="btn" disabled={busy} onClick={keep}>Keep it here</button>
        {err && <span className="hgatenote" role="status">{err}</span>}
      </div>
    </div>
  );
}

export function CodingGate({ session, threadId, channelId, room, title, repoRow, repoName, root, unitId, hasTask, onApproval, onReviewChanges, onContinueInAct, onDismissHandoff, onMade, onReopen }: {
  session: EngineeringSession; threadId: string; channelId: string; room: string; title: string; repoRow: RepoUI | null; repoName: string; root: string | null;
  unitId: string | null; hasTask: boolean;
  onApproval: (approved: boolean) => void; onReviewChanges: () => void; onContinueInAct: () => void; onDismissHandoff: () => void; onMade: (taskId: string) => void;
  /** the GitHub grant landed: open the session again (useEngineeringRuntime reopen) */
  onReopen: () => void;
}) {
  // a live approval outranks a stored GitHub wait: the machine that asks it reached the code
  if (session.pendingApproval) return <ApprovalCard session={session} onResolve={onApproval} onReview={onReviewChanges} />;
  // the machine cannot reach the code until GitHub is connected: the card leads (docs/design/repo-connect-2026-10)
  if (session.blockedOn === 'github') return <GitHubGate channelId={channelId} room={room} repoName={repoName} folder={repoRow?.org_name === 'local' || repoRow?.provider === 'local'} onConnected={onReopen} />;
  if (session.pendingModeHandoff && session.mode === 'plan') return <HandoffCard session={session} onContinue={onContinueInAct} onDismiss={onDismissHandoff} />;
  const carries = session.changes.length > 0 || !!session.workPlan;
  if (repoRow && channelId && !unitId && !hasTask && RESTING.has(session.state) && carries) {
    return <CodingValve session={session} threadId={threadId} channelId={channelId} title={title} repoRow={repoRow} repoName={repoName} root={root} onMade={onMade} />;
  }
  return null;
}
