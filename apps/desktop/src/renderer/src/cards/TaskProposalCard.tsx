// propose_task's card — the ONE route a task reaches the board through.
import { useState } from 'react';
import type { TaskProposalCardData } from '@neuramesh/shared';
import { nm } from '../bridge/nm';
import type { NmQuestion } from './parse';

/**
 * Task-verdict card (2026-08-05). The orchestrator asks for a verdict; THIS applies it —
 * `task.approve` / `task.accept` fired from the human's own client, exactly as the schedule card
 * above fires `content.approve`. That is the entire point: approve is `by: ['reviewer','human']`
 * and accept is human-only, so an orchestrator holds neither. Before this the same card was
 * prose — clicking Accept posted a sentence and the task did not move (live #1043).
 *
 * It replaces the fixed Approve · Request changes · Review Artifacts row that used to dock above
 * every thread. A card can say WHICH artifacts a verdict is about, and appears only when a
 * verdict is actually wanted — neither of which a permanent task-level bar could do.
 *
 * `state` is checked against the task's CURRENT state before applying: a card raised on an
 * in_review task that a reviewer has since approved would otherwise fire a transition the FSM
 * refuses, and the human would read a raw error instead of "this already moved".
 */
/**
 * Task-proposal card (2026-08-06). The orchestrator asks for a board task; THIS creates it —
 * `nm.createTask` from the human's own client, the same shape as the schedule and verdict cards.
 *
 * The enforced half of "the board is not the default answer": `create_task` is no longer in the
 * orchestrator's registry at all, so this card is the only route from a proposal to a row. It
 * shows the REASON alongside the title, because the useful disagreement is usually with the
 * reasoning ("that doesn't need tracking") rather than with the wording.
 */
// STRIPPED to title · description · buttons (George live, 2026-08-10): the question head
// duplicated the title, the rationale row restated the description, and the footnote explained
// a thing the buttons already enforce. The description is the human's to SHAPE before it
// becomes the task: resting = a clamped preview, click = edit in place (the docs/33 composer
// idiom — a text field always looks like one place), and what they typed rides nm.createTask.
export function TaskProposalCard({ q, answers, onAnswer }: { q: NmQuestion; answers?: Map<string, string>; onAnswer?: (text: string) => void }) {
  const data = q.proposal as TaskProposalCardData;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [sent, setSent] = useState(false);
  const [desc, setDesc] = useState(() => (data.body ?? data.because ?? '').trim());
  const [editing, setEditing] = useState(false);
  const answered = answers?.get(q.question);

  if (sent || answered) {
    return (
      <div className="focard sent">
        <span className="fotick">✓</span>
        <span className="foq">{q.question}</span>
        <span className="foa">{answered ?? 'Created'}</span>
      </div>
    );
  }

  const create = async (): Promise<void> => {
    if (!nm || busy) return;
    setBusy(true); setErr('');
    try {
      const d = desc.trim();
      // NAME WHAT WAS CREATED (2026-08-11, George live): the card used to answer "Create the
      // task" and stop, so a task born from a card left no `#N` anywhere in the thread — no
      // link to click, no peek to open, and the only way to it was hunting the nav. The command
      // already returns the row; the answer line carries its number, which linkifies like every
      // other task ref (and so opens the peek right where the decision was made).
      const made = (await nm.createTask(data.channel, data.title, {
        ...(d ? { description: d } : {}),
        ...(data.kind ? { kind: data.kind } : {}),
        // plan-first (2026-08-17): the proposal's plan rides the create — the unit is born in
        // plan_review, and the human approves the plan in the unit's own thread (the peek)
        ...(data.plan ? { plan: { legs: data.plan.legs, subtasks: data.plan.subtasks ?? [], approach: data.plan.approach } } : {}),
        ...(data.origin ? { originThread: data.origin } : {}),
      })) as { task?: { number?: number } } | undefined;
      const n = made?.task?.number;
      setSent(true);
      onAnswer?.(n ? `**${q.question}** → Created #${n}` : `**${q.question}** → Create the task`);
    } catch (e) {
      setErr(e instanceof Error ? e.message.replace(/^Error invoking remote method.*?: Error: /, '').slice(0, 140) : 'could not create the task');
      setBusy(false);
    }
  };
  const decline = (): void => { setSent(true); onAnswer?.(`**${q.question}** → Not now`); };

  return (
    <div className="verdictcard proposal" role="group" aria-label={data.title}>
      <div className="proposaltitle">{data.title}</div>
      {editing ? (
        <textarea
          className="proposaledit"
          value={desc}
          rows={4}
          autoFocus
          placeholder="What and why — this becomes the task's description"
          onChange={(e) => setDesc(e.target.value)}
          onBlur={() => setEditing(false)}
        />
      ) : (
        <button type="button" className={`proposaldesc${desc ? '' : ' empty'}`} title="Edit the description" onClick={() => setEditing(true)}>
          {desc || 'Add a description…'}
        </button>
      )}
      {data.plan && (
        <div className="proposalplan">
          <div className="planlegs" aria-label="declared journey">
            {[...data.plan.legs, 'accept'].map((l) => (
              <span key={l} className={`jlegchip jl-${l}`}>{l === 'accept' ? 'accept · you' : l}</span>
            ))}
          </div>
          {(data.plan.subtasks?.length ?? 0) > 0 && (
            <div className="plansubs">{data.plan.subtasks!.length} subtask{data.plan.subtasks!.length === 1 ? '' : 's'} proposed — minted when you approve the plan</div>
          )}
          <div className="planhint">creates in <b>plan review</b> — you approve the plan in the task before work starts</div>
        </div>
      )}
      {err && <div className="scheduerr">{err}</div>}
      <div className="schedactions">
        <button className="btn accept" disabled={busy} onClick={() => void create()}>{busy ? 'Creating…' : '✓ Create the task'}</button>
        <button className="btn" disabled={busy} onClick={decline}>Not now</button>
      </div>
    </div>
  );
}
