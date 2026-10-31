import type { ComponentProps } from 'react';
import { CodingThread } from '../../views/CodingThread';
import type { TaskRow, TaskAllRow } from '../../bridge/rows-board';
import type { ThreadRow, CodeSessionRow, ChannelRow } from '../../bridge/rows-rooms';

type CodingProps = ComponentProps<typeof CodingThread>;
type Props = Omit<CodingProps, 'embedded' | 'threadId' | 'thread' | 'channelId' | 'channelSlug' | 'projectId' | 'codeSession' | 'pickedRepoId' | 'onClose'> & {
  task: Pick<TaskRow, 'id' | 'state' | 'channel_id'>;
  threads: ThreadRow[];
  sessions: CodeSessionRow[];
  channels: ChannelRow[];
  tasks: TaskAllRow[];
};

/** The task pane subscribes to the same native conversation that the dispatcher owns. */
export function CodingTaskSurface({ task, threads, sessions, channels, tasks, defaultMachineId, ...props }: Props) {
  const thread = threads.find(t => t.task_id === task.id);
  const session = thread && sessions.find(c => c.thread_id === thread.id || c.id === thread.id);
  if (thread?.kind !== 'coding' || !session) return null;
  const channel = channels.find(c => c.id === task.channel_id);
  const projectId = tasks.find(t => t.id === task.id)?.project_id ?? channel?.project_id ?? null;
  return <CodingThread {...props} key={`${thread.id}:${task.state}`} embedded threadId={thread.id} thread={thread}
    channelId={task.channel_id} channelSlug={channel?.slug ?? ''} projectId={projectId} codeSession={session}
    pickedRepoId={session.repo_id} defaultMachineId={session.machine_id ?? defaultMachineId} onClose={() => {}} />;
}


/** An empty React element is truthy: check readiness before replacing the task transcript. */
export function codingTaskReady(task: Pick<TaskRow, 'id' | 'state' | 'plan_approved_at'>, threads: ThreadRow[], sessions: CodeSessionRow[]) {
  if (task.state === 'plan_review' && !task.plan_approved_at) return false;
  const thread = threads.find(row => row.task_id === task.id && row.kind === 'coding');
  return !!thread && sessions.some(row => row.thread_id === thread.id || row.id === thread.id);
}
