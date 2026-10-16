import { parseArticleRef, parseBriefRef, parseReportRef, parseTaskUnitRef, parseWhiteboardRef } from '@neuramesh/shared';
import { Md, type MdLinks } from '../md/Md';
import { ArticleCard, type ArticleOpen } from './ArticleCard';
import { ReportCard } from './ReportCard';
import { ReleaseCard } from './ReleaseCard';
import { UnitCard, WbCard } from './ThreadMessage';

export interface CodingDisplayDoors extends MdLinks {
  onOpenDoc?: (doc: { label: string; file: string; doc: string }) => void;
  onOpenWhiteboard?: (board: { id: string; title: string }) => void;
  onOpenArticle?: (article: ArticleOpen) => void;
  onAnswer?: (text: string) => void;
  answers?: Map<string, string>;
}
export function codingDelivery(body: string): boolean {
  return !!(parseArticleRef(body) || parseBriefRef(body) || parseReportRef(body) || parseTaskUnitRef(body) || parseWhiteboardRef(body));
}

/** Coding replies use the existing NeuraMesh cards and their normal right-pane doors. */
export function CodingMessageBody({ text, ...doors }: { text: string } & CodingDisplayDoors) {
  const wb = parseWhiteboardRef(text), article = parseArticleRef(text), report = parseReportRef(text), brief = parseBriefRef(text), task = parseTaskUnitRef(text);
  const marker = wb ?? article ?? report ?? brief ?? task;
  return <>
    <Md text={marker?.prose ?? text} {...doors} />
    {wb ? <WbCard id={wb.id} onOpen={doors.onOpenWhiteboard} />
      : article ? <ArticleCard id={article.id} onOpen={doors.onOpenArticle ?? (doors.onOpenDoc ? item => doors.onOpenDoc!({ label: item.name, file: item.name, doc: item.content }) : undefined)} />
      : report ? <ReportCard id={report.id} onOpen={doors.onOpenDoc} />
      : brief ? <ReleaseCard id={brief.id} onOpen={doors.onOpenDoc} />
      : task ? <UnitCard id={task.id} onOpen={doors.onOpenTask} /> : null}
  </>;
}
