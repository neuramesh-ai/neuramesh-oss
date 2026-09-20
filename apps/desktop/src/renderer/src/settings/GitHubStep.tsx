// THE GITHUB CONNECT STEP (docs/design/github-connector-2026-09). One step, used by the Connections
// list, the composer foot's popover and marketing setup's fifth step. The grant is the platform's
// GitHub App installed on the project's PRIMARY repository, so the step shows that repository, and
// its one action tries the resolve first (the App may already read it: the public door, a second
// project on the same installation) before it sends the human to GitHub's install page. While the
// human is on GitHub the step polls the resolve every 5 s, and "Check again" is the manual door, so
// a grant that lands on another deployment's callback still flips the row (the live trap of
// 2026-09-18, docs/44).
import { useCallback, useEffect, useState } from 'react';
import { nm as nmBridge } from '../bridge/nm';
import type { RepoUI } from '../bridge/rows-board';
import { AttachRepo } from '../cards/AttachRepo';
import { IconBranch, IconGitHub } from '../ui/icons';
import { errMsg } from '../lib/text';
import { flashToast } from '../lib/toast';

const nm = nmBridge;

type Meta = { projects: Array<{ id: string }>; repos: RepoUI[] };

/** the project's primary repository as the connector reads it, from the room's channelMeta */
export function primaryRepoOf(meta: Meta | null | undefined): RepoUI | null {
  if (!meta) return null;
  const project = meta.projects[0]?.id ?? null;
  return meta.repos.find((r) => !!project && (r.primary_project_ids ?? '').split(',').includes(project)) ?? meta.repos[0] ?? null;
}

export type GitHubConnectOutcome = 'connected' | 'browser' | 'norepo' | 'failed';

/** ONE connect action for every surface: the resolve first, GitHub's install page second */
export async function connectGitHub(channelId: string): Promise<GitHubConnectOutcome> {
  const r = await nm?.githubResolve?.(channelId).catch(() => null);
  if (r?.ok) return 'connected';
  if (r && !r.ok && r.code === 'NO_REPO') return 'norepo';
  const start = await nm?.connectorStart(channelId, 'github').catch(() => ({ ok: false }));
  return start?.ok ? 'browser' : 'failed';
}

export function GitHubStep({ channelId, dead, onDone }: { channelId: string; dead: boolean; onDone: () => void }) {
  const [meta, setMeta] = useState<Meta | null | undefined>(undefined);
  const [phase, setPhase] = useState<'idle' | 'busy' | 'waiting'>('idle');
  const [note, setNote] = useState<string | null>(null);
  const load = useCallback(() => {
    void nm?.channelMeta(channelId).then((m) => setMeta(m)).catch(() => setMeta(null));
  }, [channelId]);
  useEffect(() => { load(); }, [load]);
  const check = useCallback(async () => {
    const r = await nm?.githubResolve?.(channelId).catch(() => null);
    if (r?.ok) { setPhase('idle'); onDone(); return; }
    if (r && !r.ok && r.code !== 'NOT_INSTALLED') setNote(r.error);
  }, [channelId, onDone]);
  // while the human is on GitHub: the resolve every 5 s, so the row flips the moment the grant lands
  useEffect(() => {
    if (phase !== 'waiting') return;
    const iv = setInterval(() => { void check(); }, 5000);
    return () => clearInterval(iv);
  }, [phase, check]);
  const go = async () => {
    setPhase('busy'); setNote(null);
    try {
      const out = await connectGitHub(channelId);
      if (out === 'connected') { setPhase('idle'); onDone(); return; }
      if (out === 'browser') { setPhase('waiting'); return; }
      setPhase('idle');
      setNote(out === 'norepo' ? 'Attach a repository to this project first.' : 'GitHub did not open. Try again.');
    } catch (e) { setPhase('idle'); flashToast(errMsg(e)); }
  };
  if (meta === undefined) return <p>Please wait…</p>;
  const repo = primaryRepoOf(meta);
  if (!repo) {
    return (
      <>
        <p>Attach the repository this project lives in. neuramesh reads it through the neuramesh app on GitHub.</p>
        <AttachRepo projectId={meta?.projects[0]?.id ?? null} onAttached={load} />
      </>
    );
  }
  const slug = `${repo.org_name}/${repo.name}`;
  return (
    <>
      {dead && <p>The grant for <b>{slug}</b> ended on GitHub. Grant it again to resume.</p>}
      <p><span className="repochip"><IconBranch s={12} />{slug}</span></p>
      <p>neuramesh reads releases, pull requests and files through the neuramesh app on GitHub. It never writes.</p>
      {phase === 'waiting'
        ? <><p>Pick the repository on GitHub, then come back here.</p><div className="connacts"><button className="btn sm" onClick={() => void check()}>Check again</button></div></>
        : <button className="btn primary sm" disabled={phase === 'busy'} onClick={() => void go()}>{phase === 'busy' ? 'Please wait…' : 'Grant access on GitHub'}</button>}
      {note && <p className="mkvfail">{note}</p>}
    </>
  );
}

/** marketing setup's fifth step: the read-access row under the repository chip (step 4's row idiom) */
export function GitHubSetupRow({ channelId, conn }: { channelId: string; conn: { handle: string } | null }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="mkconnrow">
      <span className="mkconnico" aria-hidden><IconGitHub s={13} /></span>
      <span className="mkconnname">GitHub{!conn && <span className="mkqopt"> · read access, never a write</span>}</span>
      {conn
        ? <span className="mkconnok">✓ {conn.handle || 'connected'}</span>
        : <button type="button" className="btn sm mkconnbtn" disabled={busy} onClick={() => { setBusy(true); void connectGitHub(channelId).finally(() => setBusy(false)); }}>{busy ? 'Please wait…' : 'Connect'}</button>}
    </div>
  );
}
