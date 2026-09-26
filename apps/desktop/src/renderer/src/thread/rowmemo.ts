// WHAT A MESSAGE ROW DRAWS FROM — its props, and the comparison its memo runs (render round, 2026-09-24).
//
// Both thread parents rebuild the row's callbacks and its md / planCtx objects on every render: a
// keystroke in the composer, a roster heartbeat, a run tick. Unmemoized, each of those redrew every
// row and re-parsed its markdown — measured in the harness on a 200-message thread at 4x CPU: a
// median of about one second from keystroke to paint, and half-second freezes while scrolling.
// The row now renders from its DATA only; its callbacks go through stable doors (ThreadMessage.tsx)
// that call whatever the parent passed last.
import type { Md } from '../md/Md';
import { authorLabel } from '../views/SkillsView';
import type { ArticleOpen } from './ArticleCard';
import type { TaskRefInfo } from '../cards/parse';
import type { AgentRow, MemberRow } from '../bridge/rows-crew';
import type { AttachmentRow, DecisionAllRow, TaskRow } from '../bridge/rows-board';
import type { MessageRow } from '../bridge/rows-rooms';

export type ThreadMessageProps = {
  m: MessageRow;
  agents: AgentRow[];
  members: MemberRow[];
  selfId?: string | null;
  selfEmail?: string | null;
  channelId: string;
  atts: AttachmentRow[];
  onOpenAtt: (a: AttachmentRow) => void;
  answers: Map<string, string>;
  decisions: DecisionAllRow[];
  /** how THIS surface posts an answer back (a task thread and a conversation address differently) */
  onAnswerPost: (text: string) => void;
  taskRef?: (n: number) => TaskRefInfo | null;
  onOpenTask?: (id: string) => void;
  onOpenWhiteboard?: (b: { id: string; title: string }) => void;
  onOpenDoc?: (d: { label: string; file: string; doc: string }) => void;
  /** the ‹article:id› card's door — Open lands the article in a reading tab (article round) */
  onOpenArticle?: (a: ArticleOpen) => void;
  /** the plan-review card's world (task threads only): the thread's own task + its doors —
   *  absent on conversations, where a ‹plan:vN› marker degrades to its readable line */
  planCtx?: { task: TaskRow; onOpenPlan: (name?: string) => void; onArmRevise: () => void; handsOff?: boolean } | null;
  /** the extra Md powers a task thread has and a conversation has no use for */
  md?: Partial<React.ComponentProps<typeof Md>>;
  /** null = this row is not the suggestion target, or the surface is suppressing them */
  suggestions?: { onPick: (t: string) => void; onEdit: (t: string) => void } | null;
};

const sameList = <T,>(a: readonly T[], b: readonly T[]) => a === b || (a.length === b.length && a.every((x, i) => x === b[i]));
const sameMap = (a: Map<string, string>, b: Map<string, string>) => a === b || (a.size === b.size && [...a].every(([k, v]) => b.get(k) === v));
const sameFields = (a: MessageRow, b: MessageRow) => {
  if (a === b) return true;
  const ka = Object.keys(a) as Array<keyof MessageRow>;
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
};
const sameAuthor = (a: ThreadMessageProps, b: ThreadMessageProps) => {
  const x = authorLabel(a.m, a.agents, a.members, a.selfId ?? null, a.selfEmail ?? null);
  const y = authorLabel(b.m, b.agents, b.members, b.selfId ?? null, b.selfEmail ?? null);
  return x.name === y.name && x.initial === y.initial && x.agent === y.agent && x.role === y.role && x.self === y.self;
};
const has = (f: unknown) => typeof f === 'function';
const sameVerdict = (a: ThreadMessageProps['md'], b: ThreadMessageProps['md']) => {
  const x = a?.verdictTask; const y = b?.verdictTask;
  return x === y || (!!x && !!y && x.id === y.id && x.state === y.state && x.isSubtask === y.isSubtask && x.repoBacked === y.repoBacked);
};
/**
 * What a row DRAWS from; everything else it only calls, through its doors. The parents rebuild
 * their callbacks and the md and planCtx objects on every render (a keystroke in the composer, a
 * roster heartbeat, a run tick), which used to redraw every row and re-parse its markdown. The two
 * functions a row renders WITH (taskRef resolves #refs, fileRef resolves file names) compare by
 * identity; every other callback only has to exist or not.
 */
export function sameRow(a: ThreadMessageProps, b: ThreadMessageProps): boolean {
  return sameFields(a.m, b.m) && sameAuthor(a, b) && a.channelId === b.channelId
    && sameList(a.atts, b.atts) && sameMap(a.answers, b.answers)
    && a.taskRef === b.taskRef && has(a.onOpenTask) === has(b.onOpenTask)
    && has(a.onOpenWhiteboard) === has(b.onOpenWhiteboard) && has(a.onOpenDoc) === has(b.onOpenDoc) && has(a.onOpenArticle) === has(b.onOpenArticle)
    && !!a.planCtx === !!b.planCtx && a.planCtx?.task === b.planCtx?.task && a.planCtx?.handsOff === b.planCtx?.handsOff
    && !!a.md === !!b.md && a.md?.fileRef === b.md?.fileRef && a.md?.designTaskId === b.md?.designTaskId && sameVerdict(a.md, b.md)
    && has(a.md?.onOpenPlan) === has(b.md?.onOpenPlan) && has(a.md?.onOpenFile) === has(b.md?.onOpenFile) && has(a.md?.onDismissCard) === has(b.md?.onDismissCard)
    && !!a.suggestions === !!b.suggestions;
}

