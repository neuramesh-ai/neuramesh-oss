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
import { useState } from 'react';
import { nm as nmBridge } from '../bridge/nm';
import type { ConnectProvider, NmNeed } from '@neuramesh/shared';
import { ConnectorMark } from '../settings/connector-marks';
import { PickActs, RepoPick, useGitHubGrant } from '../settings/GitHubStep';
import { AttachRepo } from './AttachRepo';

const nm = nmBridge;

const LABEL: Record<string, string> = { x: 'X (Twitter)', linkedin: 'LinkedIn', instagram: 'Instagram', tiktok: 'TikTok', github: 'GitHub' };

/** the GitHub need: one option (the grant), or the pick, or the connected line */
function GitHubNeed({ channelId }: { channelId: string }) {
  const [done, setDone] = useState(false);
  const g = useGitHubGrant(channelId, () => setDone(true));
  const sub = 'one minute on GitHub · releases, pull requests and files, read only';
  if (done) return <div className="ndopt primary" aria-disabled><span className="g" aria-hidden><ConnectorMark id="github" s={14} /></span><span className="ndtxt"><b>GitHub is connected</b><span>{sub}</span></span></div>;
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
  const word = g.phase === 'busy' ? 'Opening browser…' : g.phase === 'waiting' ? 'Finish on GitHub, then check again' : 'Connect GitHub';
  return (
    <>
      <button className="ndopt primary" disabled={g.phase === 'busy' || g.phase === 'asking'} onClick={() => void (g.phase === 'waiting' ? g.ask(true) : g.grant())}>
        <span className="g" aria-hidden><ConnectorMark id="github" s={14} /></span>
        <span className="ndtxt"><b>{word}</b><span>{sub}</span></span>
      </button>
      {g.note && <div className="nderr">{g.note}</div>}
    </>
  );
}

export function DependencyCard({ data }: { data: NmNeed }) {
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
  const repo = data.attach === 'repo';
  const grant = !repo && data.connect.length === 1 && data.connect[0] === 'github';
  return (
    <div className="needcard">
      <div className="ndhead">⚠ Cannot run yet: {data.ask} needs {repo ? 'a repository to read' : grant ? 'read access to its repository' : 'a connected account'}</div>
      <div className="ndwhy">{data.why}</div>
      {repo && <AttachRepo projectId={data.project ?? null} />}
      {data.connect.map((p) => {
        if (p === 'github') return <GitHubNeed key={p} channelId={data.channel} />;
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
      <div className="ndfoot">Nothing was created. No task, no subtask, no offer. {repo ? 'Attach one and ask again.' : grant ? 'Grant it and ask again.' : 'Connect one and ask again.'}</div>
    </div>
  );
}
