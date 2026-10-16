type CodingArtifact = { name: string; created_at?: string | null; message_id?: string | null };

const stamp = (artifact: CodingArtifact): number => Date.parse(artifact.created_at ?? '') || 0;

/** The recorder keys an artifact on its bytes, so an edited file arrives as a new row with the same
 * name. Keep each name's newest row, in list order. */
export function latestCodingArtifacts<T extends CodingArtifact>(artifacts: T[]): T[] {
  const newest = new Map<string, T>();
  for (const artifact of artifacts) {
    const seen = newest.get(artifact.name);
    if (!seen || stamp(artifact) >= stamp(seen)) newest.set(artifact.name, artifact);
  }
  return artifacts.filter(artifact => newest.get(artifact.name) === artifact);
}

/** Keep each delivery with its producing turn, including after reload or a delayed inventory
 * refresh. A linked message wins over timestamps. Unplaced legacy files precede the transcript
 * instead of following every new message. Revisions in later turns retain their own cards. */
export function codingArtifactTurns<T extends CodingArtifact>(artifacts: T[], messages: { id: string; role: string; createdAt: string }[]): Map<string | null, T[]> {
  const turns = messages.filter(message => message.role === 'user');
  const messageTurns = new Map<string, string | null>();
  let turn: string | null = null;
  for (const message of messages) {
    if (message.role === 'user') turn = message.id;
    messageTurns.set(message.id, turn);
  }
  const groups = new Map<string | null, T[]>();
  for (const artifact of artifacts) {
    const linked = artifact.message_id && messageTurns.has(artifact.message_id);
    const owner = linked ? messageTurns.get(artifact.message_id!)! : turns.findLast(message => Date.parse(message.createdAt) <= stamp(artifact))?.id ?? null;
    groups.set(owner, [...(groups.get(owner) ?? []), artifact]);
  }
  for (const [owner, rows] of groups) groups.set(owner, latestCodingArtifacts(rows));
  return groups;
}

/** Resolve only this thread's artifact names, never external URLs or arbitrary repository files. */
export function codingArtifactReference<T extends CodingArtifact>(artifacts: T[], reference: string): T | null {
  let path: string;
  try { path = decodeURIComponent(reference); } catch { return null; }
  if (/^[a-z][a-z\d+.-]*:/i.test(path) || path.startsWith('/') || path.includes('\\') || path.split('/').includes('..')) return null;
  path = path.replace(/^\.\//, '').replace(/^\.nm-artifacts\//, '');
  const latest = latestCodingArtifacts(artifacts);
  const exact = latest.find(artifact => artifact.name === path);
  if (exact) return exact;
  // Replies often name a deliverable relative to its containing folder. Never guess when
  // two outputs share that suffix, and never resolve an arbitrary repository path.
  const matches = path && !path.endsWith('/') ? latest.filter(artifact => artifact.name.endsWith(`/${path}`)) : [];
  return matches.length === 1 ? matches[0]! : null;
}
