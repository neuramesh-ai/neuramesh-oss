// The dependency card (docs/design/triage-preflight-2026-08): an ‹nmneed:…› marker rendered as one
// card that names the ask, the reason, and the doors. The orchestrator posts it instead of filing
// work that cannot run: a run that needs a connected account is a card the human clicks, not a task
// for later, and the card says out loud that nothing was created, so a person never reads the tail
// of a run as four tasks asking you to go and connect one. Three needs today: an account to read
// (connect rows), a repository to watch (the attach row, release drafts), or read access to the
// repository that IS attached (the GitHub row, docs/design/github-connector-2026-09: a cloud
// machine has no gh login, so the grant is the only way the run reads). The GitHub row is the same
// state machine as the connect step (the pick round §7): the grant when nothing is readable, the
// pick when the App reads repositories for the workspace, connected when the row lands.
import { useEffect, useRef, useState } from 'react';
import { nm as nmBridge } from '../bridge/nm';
import { needDecisionQuestion, type ConnectProvider, type NmNeed } from '@neuramesh/shared';
import { ConnectorMark } from '../settings/connector-marks';
import { CopyInstall, PickActs, RepoPick, useGitHubGrant } from '../settings/GitHubStep';
import { IconCheck } from '../ui/icons';
import { AttachRepo } from './AttachRepo';

const nm = nmBridge;

const LABEL: Record<string, string> = { x: 'X (Twitter)', linkedin: 'LinkedIn', instagram: 'Instagram', tiktok: 'TikTok', github: 'GitHub' };
const CONNECTED = 'Connected ';

/** the GitHub card's face and foot. Its decision row leads (a tool's card mints one, shared/needs.ts): the resume
 *  answers it `Connected owner/repo` when a grant lands on any surface (control-api github-resume.ts), so the card
 *  stays connected after the App later loses access, and only a card the resume answered says the work continues.
 *  A card with no row (an agent typed it), or a dismissed row, promises nothing: no resume answers it. */
export function githubFace(answer: string | undefined, own: string | null, after: string | undefined): { connected: string | null; foot: string | null } {
  const answered = answer?.startsWith(CONNECTED) ? answer.slice(CONNECTED.length) : null;
  const connected = answered ?? own;
  if (connected !== null) return { connected, foot: answered === null ? null : 'The work continues below.' };
  return { connected: null, foot: (answer === 'dismissed' ? undefined : after) ?? 'Nothing ran yet. Connect GitHub, then ask again.' };
}

/** the GitHub card's faces (docs/design/repo-connect-2026-10): the grant, the wait on GitHub, the pick,
 *  and connected. The card's own words (`why`) show on the grant and the wait: the pick has its own line. */
function GitHubNeed({ channelId, why, answer, connected, onConnected }: { channelId: string; why: string; answer: string | undefined; connected: string | null; onConnected: (handle: string) => void }) {
  const g = useGitHubGrant(channelId, (handle) => onConnected(handle ?? ''));
  // the decision row moved (a grant landed on another surface, or the row was dismissed): the card asks again
  const { ask } = g;
  const was = useRef(answer);
  useEffect(() => { if (was.current === answer) return; was.current = answer; void ask(); }, [answer, ask]);
  if (connected !== null) {
    return <div className="ndopt primary" aria-disabled><span className="g ok" aria-hidden><IconCheck s={12} /></span><span className="ndtxt"><b>{connected || 'GitHub is connected'}</b><span>The neuramesh app reads it for this project.</span></span></div>;
  }
  if (g.phase !== 'waiting' && g.repos && g.repos.length > 0) {
    return (
      <>
        <div className="ndwhy">The neuramesh app reads these repositories. Pick the one this project lives in.</div>
        <div className="inpick"><RepoPick repos={g.repos} pick={g.pick} hint={g.hint} onPick={g.setPick} /></div>
        <PickActs g={g} />
        {g.note && <div className="nderr">{g.note}</div>}
      </>
    );
  }
  const waiting = g.phase === 'waiting';
  const word = g.phase === 'busy' ? 'Please wait…' : g.checking ? 'Checking…' : waiting ? 'Finish on GitHub, then check again' : 'Connect GitHub';
  return (
    <>
      <div className="ndwhy">{why}</div>
      <button className="ndopt primary" disabled={g.phase === 'busy' || g.phase === 'asking' || g.checking} onClick={() => void (waiting ? g.check() : g.grant())}>
        <span className="g" aria-hidden><ConnectorMark id="github" s={14} /></span>
        <span className="ndtxt"><b>{word}</b><span>{waiting ? 'GitHub is open in a new tab.' : 'One minute on GitHub. You pick the repositories.'}</span></span>
      </button>
      {waiting && <div className="connacts"><CopyInstall href={g.install} />{g.nextIn !== null && <span className="connwait" role="timer" aria-live="off"><i aria-hidden />Refreshes in {g.nextIn} s</span>}</div>}
      {waiting && g.heard && <p className="connheard" role="status">{g.heard}</p>}
      {g.note && <div className="nderr">{g.note}</div>}
    </>
  );
}

export function DependencyCard({ data, answers }: { data: NmNeed; answers?: Map<string, string> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const connect = async (provider: ConnectProvider) => {
    if (!nm) return;
    setBusy(provider);
    // the SAME external-browser round-trip Connections runs (AlertsBar's reconnect door) — one path
    // to authorize, so the card can never drift from the panel
    try { await nm.connectorStart(data.channel, provider); setDone(provider); }
    finally { setTimeout(() => setBusy(null), 2500); }
  };
  // the GitHub card's own resolve: the handle it answered, or '' before it names one
  const [connected, setConnected] = useState<string | null>(null);
  // the card's decision row, as the thread's answers carry it (answers.ts): absent while it waits, and for a card with no row
  const answer = answers?.get(needDecisionQuestion(data) ?? '');
  const face = githubFace(answer, connected, data.after);
  const repo = data.attach === 'repo';
  const grant = !repo && data.connect.length === 1 && data.connect[0] === 'github';
  if (grant) {
    // the card waits on the grant, and the grant resumes the work by itself (control-api github-resume.ts)
    return (
      <div className="needcard">
        <div className={`ndhead${face.connected !== null ? ' ok' : ''}`}>{face.connected !== null ? '✓ GitHub is connected' : '⚠ Waits for GitHub'}</div>
        <GitHubNeed channelId={data.channel} why={data.why} answer={answer} connected={face.connected} onConnected={setConnected} />
        {face.foot && <div className="ndfoot">{face.foot}</div>}
      </div>
    );
  }
  return (
    <div className="needcard">
      <div className="ndhead">⚠ Cannot run yet: {data.ask} needs {repo ? 'a repository to read' : 'a connected account'}</div>
      <div className="ndwhy">{data.why}</div>
      {repo && <AttachRepo projectId={data.project ?? null} />}
      {data.connect.map((p) => {
        if (p === 'github') return <GitHubNeed key={p} channelId={data.channel} why="" answer={answer} connected={face.connected} onConnected={setConnected} />;
        const readable = data.readable?.includes(p as never);
        const word = busy === p ? 'Opening browser…' : done === p ? `Finish in the browser: ${LABEL[p] ?? p}` : `Connect ${LABEL[p] ?? p}`;
        return (
          <button key={p} className={`ndopt${readable ? ' primary' : ''}`} disabled={busy === p} onClick={() => void connect(p)}>
            <span className="g" aria-hidden><ConnectorMark id={p} s={14} /></span>
            <span className="ndtxt">
              <b>{word}</b>
              <span>{readable
                ? 'one minute in the browser · real conversations and real engagement numbers'
                : 'publishing today; its conversations are covered by public research, without measured reach'}</span>
            </span>
          </button>
        );
      })}
      <div className="ndfoot">Nothing was created. No task, no subtask, no offer. {repo ? 'Attach one and ask again.' : 'Connect one and ask again.'}</div>
    </div>
  );
}
