import { useEffect, useState } from 'react';
import { nm } from '../bridge/nm';

/** Load full bytes when a file opens, preserving small offline inline documents. */
export function useArtifactContent<T extends { id: string; inline_content: string | null }>(row: T | null): { artifact: T | null; error: string | null } {
  const [loaded, setLoaded] = useState<{ id: string; content: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const id = row?.id;
  useEffect(() => {
    let cancelled = false;
    setLoaded(null);
    setError(null);
    if (id && nm) void nm.artifact(id).then(({ artifact }) => {
      if (!artifact) throw new Error('The saved file is unavailable.');
      if (!cancelled && artifact) setLoaded({ id, content: artifact.inline_content });
    }).catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'The artifact could not load.'); });
    return () => { cancelled = true; };
  }, [id]);
  return { artifact: row && loaded?.id === row.id ? { ...row, inline_content: loaded.content } : row, error };
}
