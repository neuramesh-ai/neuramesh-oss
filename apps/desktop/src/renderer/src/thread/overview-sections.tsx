import type { RefObject } from 'react';
import type { EngineeringSession } from '../engineering/domain';
import type { AttachmentRow } from '../bridge/rows-board';
import type { ChannelArtifactRow } from '../bridge/rows-rooms';
import type { RunTree } from '../runs/runs';
import { nm } from '../bridge/nm';
import { IconAgents, IconAlert, IconBranch, IconCode, IconFile, IconPaperclip } from '../ui/icons';
import { overviewChanges, overviewPlan, overviewRuns } from './overview-model';
import type { OverviewSection } from './ThreadOverview';

export function codingOverviewSections(session: EngineeringSession | null, branch: string | null, actions: { plan: () => void; changes: () => void; files: () => void; approval: () => void }): OverviewSection[] {
  const sections: OverviewSection[] = [];
  if (session?.pendingApproval) sections.push({ id: 'attention', label: 'Needs you', items: [{ id: session.pendingApproval.id, label: session.pendingApproval.title, icon: <IconAlert s={14} />, tone: 'attention', open: actions.approval }] });
  if (session?.workPlan?.trim()) {
    const progress = overviewPlan(session);
    sections.push({ id: 'progress', label: 'Progress', items: [{ id: 'plan', label: 'Work plan', detail: progress ? `${progress.done} of ${progress.total} steps${progress.current ? ` · ${progress.current}` : ''}` : 'No step started', icon: <IconFile s={14} />, open: actions.plan }] });
  }
  const proposed = session?.pendingApproval?.changes?.length ? session.pendingApproval.changes : session?.proposedChanges;
  const changes = overviewChanges(proposed?.length ? proposed : session?.changes ?? []);
  sections.push({ id: 'code', label: 'Code', items: [
    ...(changes.files ? [{ id: 'changes', label: proposed?.length ? 'Proposed changes' : 'Session changes', detail: `${changes.files} ${changes.files === 1 ? 'file' : 'files'}${changes.additions !== null ? ` · +${changes.additions} −${changes.deletions}` : ' · no line counts'}`, icon: <IconCode s={14} />, open: actions.changes }] : []),
    ...(branch ? [{ id: 'branch', label: branch, icon: <IconBranch s={14} />, open: actions.files }] : []),
  ] });
  return sections;
}
export function artifactOverviewSection(artifacts: ChannelArtifactRow[], onOpenDoc?: (doc: { label: string; file: string; doc: string }) => void): OverviewSection {
  return { id: 'artifacts', label: 'Artifacts', items: [...new Map(artifacts.map((a) => [a.id, a])).values()].map((a) => ({
    id: a.id, label: a.name, icon: <IconFile s={14} />, open: onOpenDoc ? async () => {
      const row = ('storage_path' in a && typeof a.storage_path === 'string' && a.storage_path.startsWith('brain:')) || !a.inline_content ? (await nm?.artifact(a.id))?.artifact : a;
      if (!row?.inline_content) throw new Error('The file content is unavailable.');
      // Return navigation separately: the row checks it still belongs to the visible owner.
      return () => onOpenDoc({ label: a.name, file: a.name, doc: row.inline_content! });
    } : undefined,
  })) };
}
export function sourceOverviewSection(attachments: AttachmentRow[], open: (attachment: AttachmentRow) => void): OverviewSection {
  return { id: 'sources', label: 'Sources', items: [...new Map(attachments.map((a) => [a.id, a])).values()].map((a) => ({ id: a.id, label: a.name, focus: 'attachment', icon: <IconPaperclip s={14} />, open: () => open(a) })) };
}
export function runOverviewSection(trees: RunTree[], scroll: RefObject<HTMLDivElement | null>): OverviewSection {
  const rollup = overviewRuns(trees);
  return { id: 'subagents', label: 'Subagents', items: rollup.total ? [{ id: 'runs', label: rollup.label, focus: 'preserve', icon: <IconAgents s={14} />, tone: rollup.failed ? 'attention' : undefined, open: () => {
    const target = trees.findLast((tree) => tree.legs.length > 0);
    const card = target && [...(scroll.current?.querySelectorAll<HTMLElement>('[data-run]') ?? [])].find((el) => el.dataset.run === target.run.id);
    if (card) { card.scrollIntoView({ block: 'center' }); card.tabIndex = -1; card.focus({ preventScroll: true }); }
  } }] : [] };
}
