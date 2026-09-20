// THE GITHUB CONNECT STEP (docs/design/github-connector-2026-09, the pick round §7). One step, used
// by the Connections list, the composer foot's popover, the Marketing OS desk, marketing setup's
// fifth step and the dependency card. The grant is the first move: the step never demands a
// repository. It asks the server what the App reads for this workspace and shows one of three faces:
// the grant (nothing readable), the pick (one or more readable repositories, the folder's namesake
// pre-selected; Connect attaches the picked one to the project and writes the row), or connected.
// While the person is on GitHub the step polls the resolve every 5 s, and "Check again" is the manual
// door, so a grant that lands on another deployment's callback still flips the row (docs/44). An
// open step never attaches on its own: the server attaches on the grant's callback and on the pick.
import { useCallback, useEffect, useRef, useState } from 'react';
import { nm as nmBridge } from '../bridge/nm';
import type { RepoUI } from '../bridge/rows-board';
import { IconBranch, IconCheck, IconGitHub } from '../ui/icons';
import { errMsg } from '../lib/text';
import { flashToast } from '../lib/toast';

const nm = nmBridge;

type Meta = { projects: Array<{ id: string }>; repos: RepoUI[] };

/** the project's repository as the room's channelMeta names it: the primary, else the first */
export function primaryRepoOf(meta: Meta | null | undefined): RepoUI | null {
  if (!meta) return null;
  const project = meta.projects[0]?.id ?? null;
  return meta.repos.find((r) => !!project && (r.primary_project_ids ?? '').split(',').includes(project)) ?? meta.repos[0] ?? null;
}

export type GrantPhase = 'asking' | 'idle' | 'busy' | 'waiting';
export interface GitHubGrant {
  phase: GrantPhase;
  /** what the App reads for this workspace, once asked (null before the first answer) */
  repos: string[] | null;
  /** the server's pre-selection: the readable repository named like the project's folder */
  hint: string | null;
  pick: string | null;
  setPick: (slug: string) => void;
  note: string | null;
  /** the resolve: connected → onDone; else the face's ingredients. True when connected. `manual`
   *  is Check again: it leaves the waiting face whenever there is something to pick from. */
  ask: (manual?: boolean) => Promise<boolean>;
  /** GitHub's install page in the browser, then the poll */
  grant: () => Promise<void>;
  /** the picked repository: attached to the project and connected, in one move */
  connect: () => Promise<void>;
}

/** ONE state machine for every surface that connects GitHub */
export function useGitHubGrant(channelId: string, onDone: () => void): GitHubGrant {
  const [phase, setPhase] = useState<GrantPhase>('asking');
  const [repos, setRepos] = useState<string[] | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // the caller's onDone is a fresh closure every render: held in a ref so the mount ask runs ONCE per room
  const done = useRef(onDone);
  done.current = onDone;
  // what the App read when the person left for GitHub: the waiting face ends when a repository
  // the list did not have appears (Add more on GitHub), not on the next poll that repeats the old list
  const seen = useRef<Set<string>>(new Set());
  const ask = useCallback(async (manual = false) => {
    const r = await nm?.githubResolve?.(channelId).catch(() => null);
    if (r?.ok) { setPhase('idle'); done.current(); return true; }
    const list = r && !r.ok ? r.repos ?? [] : [];
    const named = (r && !r.ok && r.hint) || null;
    setRepos(list); setHint(named);
    const fresh = list.find((s) => !seen.current.has(s)) ?? null;
    setPick((p) => (fresh && seen.current.size ? fresh : p && list.includes(p) ? p : named || list[0] || null));
    if (r && !r.ok && (r.code === 'NOT_CONFIGURED' || r.code === 'UNREACHABLE')) setNote(r.error);
    // back from GitHub with something new to pick from (or Check again with anything): the pick shows
    setPhase((ph) => (ph === 'asking' || (ph === 'waiting' && list.length > 0 && (manual || !!fresh)) ? 'idle' : ph));
    return false;
  }, [channelId]);
  useEffect(() => { void ask(); }, [ask]);
  // while the person is on GitHub: the resolve every 5 s, so the row flips the moment the grant lands
  useEffect(() => {
    if (phase !== 'waiting') return;
    const iv = setInterval(() => { void ask(); }, 5000);
    return () => clearInterval(iv);
  }, [phase, ask]);
  const grant = useCallback(async () => {
    setPhase('busy'); setNote(null);
    seen.current = new Set(repos ?? []);
    const start = await nm?.connectorStart(channelId, 'github').catch(() => ({ ok: false }));
    if (start?.ok) setPhase('waiting');
    else { setPhase('idle'); setNote('GitHub did not open. Try again.'); }
  }, [channelId, repos]);
  const connect = useCallback(async () => {
    if (!pick) return;
    setPhase('busy'); setNote(null);
    try {
      const r = await nm?.githubResolve?.(channelId, pick);
      if (r?.ok) { setPhase('idle'); done.current(); return; }
      setPhase('idle');
      setNote(r && !r.ok ? r.error : 'That did not connect. Try again.');
    } catch (e) { setPhase('idle'); flashToast(errMsg(e)); }
  }, [channelId, pick]);
  return { phase, repos, hint, pick, setPick, note, ask, grant, connect };
}

/** the readable repositories, one row each (the machine-chip row idiom); the picked row wears the check */
export function RepoPick({ repos, pick, hint, onPick }: { repos: string[]; pick: string | null; hint: string | null; onPick: (slug: string) => void }) {
  return (
    <div className="picklist" role="radiogroup" aria-label="Repositories the neuramesh app reads">
      {repos.map((slug) => {
        const on = slug === pick;
        return (
          <button key={slug} type="button" className={`pickrow${on ? ' on' : ''}`} role="radio" aria-checked={on} onClick={() => onPick(slug)}>
            <span className="cprojglyph"><IconBranch s={13} /></span>
            <span className="connrowtxt"><b>{slug}</b>{slug === hint && <span className="connsub">your folder</span>}</span>
            <span className={`cmachst${on ? ' on' : ''}`} aria-hidden>{on && <IconCheck s={11} />}</span>
          </button>
        );
      })}
    </div>
  );
}

/** the pick's two acts, shared by every surface that unfolds the rows */
export function PickActs({ g }: { g: GitHubGrant }) {
  return (
    <div className="connacts">
      <button type="button" className="btn primary sm" disabled={g.phase === 'busy' || !g.pick} onClick={() => void g.connect()}>{g.phase === 'busy' ? 'Please wait…' : 'Connect'}</button>
      <button type="button" className="btn ghost sm" disabled={g.phase === 'busy'} onClick={() => void g.grant()}>Add more on GitHub</button>
    </div>
  );
}

export function GitHubStep({ channelId, dead, onDone }: { channelId: string; dead: boolean; onDone: () => void }) {
  const [meta, setMeta] = useState<Meta | null | undefined>(undefined);
  useEffect(() => { void nm?.channelMeta(channelId).then((m) => setMeta(m)).catch(() => setMeta(null)); }, [channelId]);
  const g = useGitHubGrant(channelId, onDone);
  const repo = primaryRepoOf(meta);
  const folder = repo && (repo.org_name === 'local' || repo.provider === 'local') ? repo.name : null;
  if (g.phase === 'asking' || meta === undefined) return <p>Please wait…</p>;
  const body = g.phase === 'waiting'
    ? <><p>Pick the account and the repositories on GitHub, then come back here.</p><div className="connacts"><button type="button" className="btn sm" onClick={() => void g.ask(true)}>Check again</button><span className="connwait"><i aria-hidden />Checks every 5 s</span></div></>
    : g.repos && g.repos.length > 0
      ? <><p>The neuramesh app reads these repositories. Pick the one this project lives in.</p><RepoPick repos={g.repos} pick={g.pick} hint={g.hint} onPick={g.setPick} /><PickActs g={g} /></>
      : <>
          <p>neuramesh reads releases, pull requests and files through the neuramesh app on GitHub. It never writes.</p>
          {folder && <p className="connhint">This project's folder is <b>{folder}</b>. Pick its repository on GitHub.</p>}
          {repo && !folder && <p className="connhint">Pick <b>{repo.org_name}/{repo.name}</b> on GitHub.</p>}
          <button type="button" className="btn primary sm" disabled={g.phase === 'busy'} onClick={() => void g.grant()}>{g.phase === 'busy' ? 'Please wait…' : 'Grant access on GitHub'}</button>
        </>;
  return (
    <>
      {dead && repo && <p>The grant for <b>{repo.org_name}/{repo.name}</b> ended on GitHub. Grant it again to resume.</p>}
      {body}
      {g.note && <p className="mkvfail">{g.note}</p>}
    </>
  );
}

/** marketing setup's fifth step: the read-access row under the repository chip (step 4's row idiom);
 *  with readable repositories the pick unfolds under the row, the same rows and acts as the step */
export function GitHubSetupRow({ channelId, conn, onDone }: { channelId: string; conn: { handle: string } | null; onDone?: () => void }) {
  const g = useGitHubGrant(channelId, onDone ?? (() => {}));
  const pick = !conn && g.phase !== 'waiting' && !!g.repos?.length;
  return (
    <>
      <div className="mkconnrow">
        <span className="mkconnico" aria-hidden><IconGitHub s={13} /></span>
        <span className="mkconnname">GitHub{!conn && <span className="mkqopt"> · read access, never a write</span>}</span>
        {conn
          ? <span className="mkconnok">✓ {conn.handle || 'connected'}</span>
          : g.phase === 'waiting'
            ? <button type="button" className="btn sm mkconnbtn" onClick={() => void g.ask(true)}>Check again</button>
            : !pick && <button type="button" className="btn sm mkconnbtn" disabled={g.phase !== 'idle'} onClick={() => void g.grant()}>{g.phase === 'idle' ? 'Connect' : 'Please wait…'}</button>}
      </div>
      {pick && g.repos && (
        <div className="mkconnpick">
          <p>The neuramesh app reads these repositories. Pick the one this project lives in.</p>
          <div className="inpick"><RepoPick repos={g.repos} pick={g.pick} hint={g.hint} onPick={g.setPick} /></div>
          <PickActs g={g} />
          {g.note && <p className="mkvfail">{g.note}</p>}
        </div>
      )}
    </>
  );
}
