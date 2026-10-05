// THE GITHUB CONNECT STEP (docs/design/github-connector-2026-09, the pick round §7). One step, used
// by the Connections list, the composer foot's popover, the Marketing OS desk, marketing setup's
// fifth step and the dependency card. The grant is the first move: the step never demands a
// repository. It asks the server what the App reads for this workspace and shows one of three faces:
// the grant (nothing readable), the pick (one or more readable repositories, the folder's namesake
// pre-selected; Connect attaches the picked one to the project and writes the row), or connected.
// While the person is on GitHub the step polls the resolve every 5 s and counts down to each poll, and
// "Check again" is the manual door, which says so when nothing moved (George, 2026-10-04: "clicking check
// again does nothing"). The copy door hands over GitHub's install link for a tab of the person's own
// choosing. The install callback only records the installation, so the resolve that the poll sends
// writes the row. An open step never attaches on its own: the server attaches only on the pick.
import { useCallback, useEffect, useRef, useState } from 'react';
import { nm as nmBridge } from '../bridge/nm';
import type { RepoUI } from '../bridge/rows-board';
import { IconBranch, IconCheck, IconCopy, IconGitHub } from '../ui/icons';
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
  /** the repository the last connected answer named ('' before it names one), else null. A quiet step shows it */
  connected: string | null;
  /** the resolve: connected → onDone(handle); else the face's ingredients. True when connected. `manual`
   *  is Check again: it leaves the waiting face whenever there is something to pick from. */
  ask: (manual?: boolean) => Promise<boolean>;
  /** GitHub's install page in the browser, then the poll */
  grant: () => Promise<void>;
  /** the person took the link by hand (the copy door): the card waits on GitHub as the grant's tab does */
  wait: () => void;
  /** the picked repository: attached to the project and connected, in one move */
  connect: () => Promise<void>;
  /** GitHub's install page for this workspace, from the last resolve: the copy door's link */
  install: string | null;
  /** the seconds to the next poll while the person is on GitHub, else null */
  nextIn: number | null;
  /** Check again: the resolve now, the countdown from the top, and a word when nothing moved */
  check: () => Promise<void>;
  checking: boolean;
  /** what Check again found when nothing moved */
  heard: string | null;
}

/** the install link a refusal of the resolve carries, else null */
const installOf = (r: { ok: boolean; install?: string | null } | null | undefined): string | null => (r && !r.ok ? r.install ?? null : null);

/** the seconds between two polls of the resolve while the person is on GitHub */
export const POLL_S = 5;

/** what Check again says when nothing moved: `list` is what the App reads, null when the check did not get an answer */
export const heardOf = (list: readonly string[] | null): string | null =>
  list === null ? 'The check did not get an answer. Try again.' : list.length ? null : 'GitHub shows no access yet. Finish the steps there, then check again.';

/** whether a connected answer to the resolve finishes the step (onDone). A quiet step finishes only after the person
 *  left for GitHub from it: the coding gate's onDone opens the session again, and its mount ask can answer connected
 *  while the machine still refuses, which opened the session in a loop. A pick always finishes. */
export const answerFinishes = (quiet: boolean, granted: boolean): boolean => !quiet || granted;

/** ONE state machine for every surface that connects GitHub. `quiet`: the coding gate (answerFinishes) */
export function useGitHubGrant(channelId: string, onDone: (handle?: string) => void, { quiet = false }: { quiet?: boolean } = {}): GitHubGrant {
  const [phase, setPhase] = useState<GrantPhase>('asking');
  const [repos, setRepos] = useState<string[] | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [connected, setConnected] = useState<string | null>(null);
  const [install, setInstall] = useState<string | null>(null);
  const [nextIn, setNextIn] = useState<number | null>(null);
  const [checking, setChecking] = useState(false);
  const [heard, setHeard] = useState<string | null>(null);
  // a manual check starts the countdown again
  const [round, setRound] = useState(0);
  // the last answer's readable repositories, null when the resolve gave none
  const lastList = useRef<string[] | null>(null);
  // the caller's onDone is a fresh closure every render: held in a ref so the mount ask runs ONCE per room
  const done = useRef(onDone);
  done.current = onDone;
  // what the App read when the person left for GitHub: the waiting face ends when a repository
  // the list did not have appears (Add more on GitHub), not on the next poll that repeats the old list
  const seen = useRef<Set<string>>(new Set());
  const granted = useRef(false);
  const ask = useCallback(async (manual = false) => {
    const r = await nm?.githubResolve?.(channelId).catch(() => null);
    if (r?.ok) { setConnected(r.handle); setPhase('idle'); if (answerFinishes(quiet, granted.current)) done.current(r.handle); return true; }
    const list = r && !r.ok ? r.repos ?? [] : [];
    lastList.current = r ? list : null;
    setInstall((link) => installOf(r) ?? link);
    const named = (r && !r.ok && r.hint) || null;
    setConnected(null); setRepos(list); setHint(named);
    const fresh = list.find((s) => !seen.current.has(s)) ?? null;
    setPick((p) => (fresh && seen.current.size ? fresh : p && list.includes(p) ? p : named || list[0] || null));
    if (r && !r.ok && (r.code === 'NOT_CONFIGURED' || r.code === 'UNREACHABLE')) setNote(r.error);
    // back from GitHub with something new to pick from (or Check again with anything): the pick shows
    setPhase((ph) => (ph === 'asking' || (ph === 'waiting' && list.length > 0 && (manual || !!fresh)) ? 'idle' : ph));
    return false;
  }, [channelId, quiet]);
  useEffect(() => { void ask(); }, [ask]);
  // while the person is on GitHub: the resolve every 5 s, so the row flips the moment the grant lands, and
  // the card counts down to each one
  useEffect(() => {
    if (phase !== 'waiting') { setNextIn(null); setHeard(null); return; }
    let left = POLL_S;
    setNextIn(left);
    const iv = setInterval(() => {
      left -= 1;
      if (left <= 0) { left = POLL_S; void ask(); }
      setNextIn(left);
    }, 1000);
    return () => clearInterval(iv);
  }, [phase, ask, round]);
  const check = useCallback(async () => {
    setChecking(true); setHeard(null);
    const ok = await ask(true);
    setChecking(false); setRound((n) => n + 1);
    if (!ok) setHeard(heardOf(lastList.current));
  }, [ask]);
  const grant = useCallback(async () => {
    setPhase('busy'); setNote(null);
    seen.current = new Set(repos ?? []);
    const start = await nm?.connectorStart(channelId, 'github').catch(() => ({ ok: false }));
    if (start?.ok) { granted.current = true; setPhase('waiting'); }
    else { setPhase('idle'); setNote('GitHub did not open. Try again.'); }
  }, [channelId, repos]);
  const wait = useCallback(() => {
    seen.current = new Set(repos ?? []);
    granted.current = true; setNote(null); setPhase('waiting');
  }, [repos]);
  const connect = useCallback(async () => {
    if (!pick) return;
    setPhase('busy'); setNote(null);
    try {
      const r = await nm?.githubResolve?.(channelId, pick);
      if (r?.ok) { setConnected(r.handle); setPhase('idle'); done.current(r.handle); return; }
      setPhase('idle');
      setNote(r && !r.ok ? r.error : 'That did not connect. Try again.');
    } catch (e) { setPhase('idle'); flashToast(errMsg(e)); }
  }, [channelId, pick]);
  return { phase, repos, hint, pick, setPick, note, connected, ask, grant, wait, connect, install, nextIn, check, checking, heard };
}

/** the clipboard, then the selection copy: a frame without the clipboard permission refuses writeText */
async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* the selection copy below */ }
  const ta = document.createElement('textarea');
  ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  try { return document.execCommand('copy'); } catch { return false; } finally { ta.remove(); }
}

/** the copy door: GitHub's install link for this workspace, for a browser tab of the person's choosing */
export function CopyInstall({ href, onCopied }: { href: string | null; onCopied?: () => void }) {
  const [copied, setCopied] = useState(false);
  if (!href) return null;
  const copy = () => void copyText(href).then((ok) => {
    if (!ok) { flashToast('The link did not copy. Try again.'); return; }
    setCopied(true); setTimeout(() => setCopied(false), 1600); onCopied?.();
    flashToast('The GitHub link is on your clipboard. Paste it in any browser tab.');
  });
  return (
    <button type="button" className="btn sm ghcopy" aria-label="Copy the GitHub link" data-tip={copied ? 'Copied' : 'Copy the link, then paste it in any browser tab'} onClick={copy}>
      {copied ? <IconCheck s={13} /> : <IconCopy s={13} />}
    </button>
  );
}

/** the wait's acts: Check again, the copy door and the countdown, and the word Check again brought back */
export function WaitActs({ g, row = 'connacts' }: { g: GitHubGrant; row?: 'connacts' | 'hgateacts' }) {
  return (
    <>
      <div className={row}>
        <button type="button" className="btn sm" disabled={g.checking} onClick={() => void g.check()}>{g.checking ? 'Checking…' : 'Check again'}</button>
        <CopyInstall href={g.install} />
        {g.nextIn !== null && <span className="connwait" role="timer" aria-live="off"><i aria-hidden />Refreshes in {g.nextIn} s</span>}
      </div>
      {g.heard && <p className="connheard" role="status">{g.heard}</p>}
    </>
  );
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
    ? <><p>Pick the account and the repositories on GitHub, then come back here.</p><WaitActs g={g} /></>
    : g.repos && g.repos.length > 0
      ? <><p>The neuramesh app reads these repositories. Pick the one this project lives in.</p><RepoPick repos={g.repos} pick={g.pick} hint={g.hint} onPick={g.setPick} /><PickActs g={g} /></>
      : <>
          <p>neuramesh reads releases, pull requests and files through the neuramesh app on GitHub.</p>
          {folder && <p className="connhint">This project's folder is <b>{folder}</b>. Pick its repository on GitHub.</p>}
          {repo && !folder && <p className="connhint">Pick <b>{repo.org_name}/{repo.name}</b> on GitHub.</p>}
          <div className="connacts"><button type="button" className="btn primary sm" disabled={g.phase === 'busy'} onClick={() => void g.grant()}>{g.phase === 'busy' ? 'Please wait…' : 'Grant access on GitHub'}</button><CopyInstall href={g.install} onCopied={g.wait} /></div>
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
        <span className="mkconnname">GitHub</span>
        {conn
          ? <span className="mkconnok">✓ {conn.handle || 'connected'}</span>
          : g.phase === 'waiting'
            ? <button type="button" className="btn sm mkconnbtn" disabled={g.checking} onClick={() => void g.check()}>{g.checking ? 'Checking…' : 'Check again'}</button>
            : !pick && <button type="button" className="btn sm mkconnbtn" disabled={g.phase !== 'idle'} onClick={() => void g.grant()}>{g.phase === 'idle' ? 'Connect' : 'Please wait…'}</button>}
      </div>
      {!conn && g.heard && <p className="connheard" role="status">{g.heard}</p>}
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
