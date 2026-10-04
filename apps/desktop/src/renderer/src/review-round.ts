// ONE REVIEW FAMILY, ONE TAB (the side-panel round, 2026-10-03, docs/design/side-panel-2026-10 §3.4)
// — pure, so it is tested, not eyeballed.
//
// A review tab was keyed by the artifact it decides on (docs/36 §13, ruling 4), so every version of
// a plan opened a tab of its own and the old one stood beside it, superseded. Now a task has ONE tab
// per review family (its plan, its release plan, its design round): a new version replaces what the
// tab shows, and the head wears `new`. A design round's mockups share that tab as a strip, with one
// of them on stage: a tab per mockup put one decision in N tabs and spent the verdict from whichever
// of them you happened to be in.
import { designVer, versionOf } from './review-names';
import type { ReviewArtifact, ReviewKind, ReviewRound } from './review-types';

/** what a review tab holds: the artifact on stage, the task's rounds, and a design round's mockups */
export interface ReviewEntry {
  artifact: ReviewArtifact;
  rounds: ReviewRound[];
  taskId: string;
  channelId: string;
  taskNumber: number;
  /** a design round's mockups, in the order they landed. Absent on every other review. */
  mockups?: ReviewArtifact[];
  /** a newer version replaced what this tab showed: the head wears `new` */
  isNew?: boolean;
}

type RoundArt = { id: string; kind?: string | null; name: string; content?: string | null };

/** the tab key of a review family: one plan, one release plan and one design round per task, one tab each */
export const reviewKey = (kind: ReviewKind, taskId: string): string => `${kind}:${taskId}`;

/** what a family tab is called in the strip: the version on stage */
export const reviewTitle = (kind: ReviewKind, name: string): string => {
  const v = versionOf(kind, name);
  if (!v) return name;
  return kind === 'design' ? `Design round ${v}` : kind === 'ship' ? `Release plan v${v}` : `Plan v${v}`;
};

/**
 * A design round's mockups, in the order they landed: only the ones with bytes to render. The
 * server lists a task's artifacts oldest first, so a mockup posted again under its own name keeps
 * its place in the strip and takes the newest bytes.
 */
export function roundMockupsOf(arts: readonly RoundArt[], round: number): ReviewArtifact[] {
  if (!round) return [];
  const byName = new Map<string, ReviewArtifact>();
  for (const a of arts) {
    if (designVer(a.name) === round && a.content) byName.set(a.name, { id: a.id, kind: a.kind ?? 'design', name: a.name, content: a.content });
  }
  return [...byName.values()];
}

/** the mockup on stage: the one you named, else the one you read last, else the first. A mockup is its name. */
export function roundStage(mockups: readonly ReviewArtifact[], name: string | null, was?: ReviewArtifact | null): ReviewArtifact {
  return (name && mockups.find((m) => m.name === name)) || (was && mockups.find((m) => m.name === was.name)) || mockups[0]!;
}

/** put a mockup on stage: the same map back when it is not in the round or already there */
export function stageMockup<T extends Record<string, ReviewEntry>>(revs: T, key: string, id: string): T {
  const rev = revs[key];
  const m = rev?.mockups?.find((x) => x.id === id);
  return rev && m && rev.artifact.id !== id ? { ...revs, [key]: { ...rev, artifact: m } } : revs;
}

/**
 * A review entry re-read from the task's artifacts, or null when nothing moved. The bytes on stage
 * follow an agent that rewrites a round in place, and a design round grows while its tab is open,
 * because the designer posts the mockups one by one.
 */
export function refreshRev(rev: ReviewEntry, arts: readonly RoundArt[], rounds: ReviewRound[]): ReviewEntry | null {
  const mockups = rev.mockups ? roundMockupsOf(arts, designVer(rev.artifact.name)) : undefined;
  // a mockup on stage follows its name: posted again, it is a new row with the same name
  const artifact = mockups?.find((m) => m.name === rev.artifact.name)
    ?? { ...rev.artifact, content: arts.find((a) => a.id === rev.artifact.id)?.content ?? rev.artifact.content };
  if (JSON.stringify(rev.rounds) === JSON.stringify(rounds) && artifact.id === rev.artifact.id && artifact.content === rev.artifact.content
    && JSON.stringify(rev.mockups ?? null) === JSON.stringify(mockups ?? null)) return null;
  return { ...rev, rounds, artifact, ...(mockups ? { mockups } : {}) };
}

/** what an open asks the family tab to show */
export interface FamilyOpen {
  kind: ReviewKind;
  artifact: ReviewArtifact;
  mockups?: ReviewArtifact[];
  /** the mockup you named (a click on it), else null */
  name: string | null;
  rounds: ReviewRound[];
  taskId: string;
  channelId: string;
  taskNumber: number;
}

/**
 * An open of a review family's tab. The same version keeps what you picked (the mockup on stage).
 * A new version replaces what the tab shows, and the head wears `new`. Comments that you did not
 * send hold an AUTOMATIC replace back: the tab keeps your version, which turns superseded and
 * offers the new one, and `kept` tells the caller to mark the tab rather than bring it forward. An
 * open by your own hand always replaces, and the batch stays with the tab.
 */
export function familyEntry(prev: ReviewEntry | undefined, o: FamilyOpen, how: { auto: boolean; batch: number }): { entry: ReviewEntry; kept: boolean } {
  const base = { rounds: o.rounds, taskId: o.taskId, channelId: o.channelId, taskNumber: o.taskNumber, ...(o.mockups?.length ? { mockups: o.mockups } : {}) };
  const same = !!prev && versionOf(o.kind, prev.artifact.name) === versionOf(o.kind, o.artifact.name);
  if (prev && same) {
    const artifact = o.mockups?.length ? roundStage(o.mockups, o.name, prev.artifact) : o.artifact;
    return { entry: { ...base, artifact, ...(prev.isNew ? { isNew: true } : {}) }, kept: false };
  }
  if (prev && how.auto && how.batch > 0) return { entry: { ...prev, rounds: o.rounds }, kept: true };
  const artifact = o.mockups?.length ? roundStage(o.mockups, o.name) : o.artifact;
  return { entry: { ...base, artifact, ...(prev ? { isNew: true } : {}) }, kept: false };
}
