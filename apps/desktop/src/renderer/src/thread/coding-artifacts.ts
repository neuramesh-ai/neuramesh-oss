type CodingArtifact = { name: string; created_at?: string | null };

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

/** Resolve only this thread's artifact names, never external URLs or arbitrary repository files. */
export function codingArtifactReference<T extends CodingArtifact>(artifacts: T[], reference: string): T | null {
  let path: string;
  try { path = decodeURIComponent(reference); } catch { return null; }
  if (/^[a-z][a-z\d+.-]*:/i.test(path) || path.startsWith('/') || path.includes('\\') || path.split('/').includes('..')) return null;
  path = path.replace(/^\.\//, '').replace(/^\.nm-artifacts\//, '');
  return latestCodingArtifacts(artifacts).find(artifact => artifact.name === path) ?? null;
}
