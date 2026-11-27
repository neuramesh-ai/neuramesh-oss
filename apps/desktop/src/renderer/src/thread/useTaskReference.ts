import { useCallback } from 'react';
import type { TaskAllRow } from '../bridge/rows-board';
import type { TaskRefInfo } from '../cards/parse';

type RefTask = Pick<TaskAllRow, 'id' | 'number' | 'title' | 'state' | 'assignee_kind' | 'assignee_id' | 'branch' | 'pr_number'>;

/** Stable link resolvers preserve hover-card state across roster and task updates. */
export function useTaskReference(tasks: RefTask[], all: RefTask[], agents: { id: string; name: string }[]) {
  return useCallback((number: number): TaskRefInfo | null => {
    const task = tasks.find(row => row.number === number) ?? all.find(row => row.number === number);
    if (!task) return null;
    const assignee = task.assignee_kind === 'agent' ? agents.find(row => row.id === task.assignee_id)?.name ?? null : null;
    return { id: task.id, number: task.number, title: task.title, state: task.state, assignee, branch: task.branch, pr: task.pr_number };
  }, [tasks, all, agents]);
}
