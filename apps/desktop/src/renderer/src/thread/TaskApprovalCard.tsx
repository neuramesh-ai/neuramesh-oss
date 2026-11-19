import { createContext, useContext, useEffect, useState } from 'react';
import { normalizeTaskMarkdown } from '@neuramesh/shared';
import type { TaskAllRow } from '../bridge/rows-board';
import { nm } from '../bridge/nm';
import { PlanReviewCard } from '../cards/PlanReviewCard';

/** Opens the canonical artifact with its existing versioned approval controls. */
export const TaskApprovalEnvironment = createContext<((task: TaskAllRow, name?: string) => void) | null>(null);

export function TaskApprovalCard({ taskId, version, onOpenTask }: { taskId: string; version: number; onOpenTask?: (id: string) => void }) {
  const open = useContext(TaskApprovalEnvironment);
  const [task, setTask] = useState<TaskAllRow | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    setTask(null); setLoaded(false);
    return nm?.watchTasksAll(rows => { setTask(rows.find(row => row.id === taskId) ?? null); setLoaded(true); });
  }, [taskId]);
  if (!task) return <div className="fomini" role="status">{loaded ? 'This task is no longer available.' : 'Loading the implementation plan…'}</div>;
  let preview = '';
  try { const p = JSON.parse(task.work_plan ?? '{}'); if (p.version === version) preview = normalizeTaskMarkdown(String(p.approach ?? '')).replace(/^#+\s*/gm, '').slice(0, 280); } catch { /* the card retains the task door */ }
  return <section className="task-approval-card" aria-label={`Review plan for task #${task.number}`}>
    <b>#{task.number} · {task.title}</b>
    {preview && !task.plan_approved_at && task.state === 'plan_review' && <p>{preview}{preview.length === 280 ? '…' : ''}</p>}
    <PlanReviewCard task={task} version={version} onOpenPlan={name => open ? open(task, name) : onOpenTask?.(taskId)} />
  </section>;
}
