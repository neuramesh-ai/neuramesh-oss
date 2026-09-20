// The dependency card (docs/design/triage-preflight-2026-08) — what a run needs before it can
// be staffed, with the fix on the card rather than filed as work for the human to do later.
//
// It is the FIRST thing you see, not the last: run_playbook refuses to create a unit whose
// needs are unmet and posts this instead, so a missing connector can never resurface at the end
// of a run as four tasks asking you to go and connect one. Three needs today: an account to read
// (connect rows), a repository to watch (the attach row, release drafts), or read access to the
// repository that IS attached (the GitHub row, docs/design/github-connector-2026-09: a cloud
// machine has no gh login, so the grant is the only way the run reads).
import { useState } from 'react';
import { nm as nmBridge } from '../bridge/nm';
import type { ConnectProvider, NmNeed } from '@neuramesh/shared';
import { ConnectorMark } from '../settings/connector-marks';
import { connectGitHub } from '../settings/GitHubStep';
import { AttachRepo } from './AttachRepo';

const nm = nmBridge;

const LABEL: Record<string, string> = { x: 'X (Twitter)', linkedin: 'LinkedIn', instagram: 'Instagram', tiktok: 'TikTok', github: 'GitHub' };

export function DependencyCard({ data }: { data: NmNeed }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const connect = async (provider: ConnectProvider) => {
    if (!nm) return;
    setBusy(provider);
    // the SAME external-browser round-trip Connections runs (AlertsBar's reconnect door) —
    // one path to authorize, so the card can never drift from the panel. GitHub resolves in
    // place first (the App may already read the repository) and opens GitHub only when it must.
    try {
      if (provider === 'github') { const out = await connectGitHub(data.channel); setDone(out === 'connected' ? 'github:done' : 'github'); }
      else { await nm.connectorStart(data.channel, provider); setDone(provider); }
    } finally { setTimeout(() => setBusy(null), 2500); }
  };
  const repo = data.attach === 'repo';
  const grant = !repo && data.connect.length === 1 && data.connect[0] === 'github';
  return (
    <div className="needcard">
      <div className="ndhead">⚠ Cannot run yet: {data.ask} needs {repo ? 'a repository to read' : grant ? 'read access to its repository' : 'a connected account'}</div>
      <div className="ndwhy">{data.why}</div>
      {repo && <AttachRepo projectId={data.project ?? null} />}
      {data.connect.map((p) => {
        const readable = data.readable?.includes(p as never);
        const github = p === 'github';
        const word = busy === p ? 'Opening browser…'
          : done === 'github:done' && github ? 'GitHub is connected'
          : done === p ? `Finish in the browser: ${LABEL[p] ?? p}` : `Connect ${LABEL[p] ?? p}`;
        return (
          <button key={p} className={`ndopt${readable || github ? ' primary' : ''}`} disabled={busy === p || (github && done === 'github:done')} onClick={() => void connect(p)}>
            <span className="g" aria-hidden><ConnectorMark id={p} s={14} /></span>
            <span className="ndtxt">
              <b>{word}</b>
              <span>{github
                ? 'one minute on GitHub · releases, pull requests and files, read only'
                : readable
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
