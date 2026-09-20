// The attach-a-repository input (the dependency card's, lifted out 2026-09-19 so the GitHub connect
// step can carry the same door when the project has no repository yet). The same command the
// project's repository picker uses (repo.link): the project is named because a room's id is not a
// project's.
import { useState } from 'react';
import { nm as nmBridge } from '../bridge/nm';

const nm = nmBridge;

export function AttachRepo({ projectId, onAttached }: { projectId: string | null; onAttached?: (repoId: string) => void }) {
  const [url, setUrl] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'failed'>('idle');
  const attach = async () => {
    if (!nm || !url.trim()) return;
    setState('busy');
    try {
      const r = await nm.repoAdd({ url: url.trim(), ...(projectId ? { projectId } : {}) });
      setState('done');
      if (r?.repoId) onAttached?.(r.repoId);
    } catch { setState('failed'); }
  };
  return (
    <div className="ndattach">
      <input className="ndinput" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="github.com/owner/repo" spellCheck={false} aria-label="Repository to attach" disabled={state === 'done'} />
      <button className="btn sm" disabled={state === 'busy' || state === 'done' || !url.trim()} onClick={() => void attach()}>
        {state === 'busy' ? 'Please wait…' : state === 'done' ? 'Attached' : 'Attach the repository'}
      </button>
      {state === 'failed' && <span className="nderr">That did not attach. Check the address and try again.</span>}
    </div>
  );
}
