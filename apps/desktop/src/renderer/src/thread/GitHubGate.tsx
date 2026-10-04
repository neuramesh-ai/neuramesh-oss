// THE CODING THREAD'S GITHUB GATE (docs/design/repo-connect-2026-10, the approved Coding.dc.html). A cloud
// session that cannot reach its code waits in the gate seat, never on a raw error: the coding-threads round
// drew this card for the no-repository state (Doors.dc.html) and nothing built it, so a person read
// "neuramesh is not available in this workspace or has no clone URL" with no way forward. One state
// machine (settings/GitHubStep useGitHubGrant), the card's faces: the grant, the wait on GitHub, the pick.
// The grant opens the session again (onConnected), with the person's own message as its first prompt.
// The gate is quiet: only the person's own grant or pick here opens it, never the mount ask. The resolve
// reads the room's repository, and the machine can refuse a clone that read allows, so a mount answer of
// connected opened the session, the machine refused, the gate mounted again, and so on without end. A
// connected answer the person did not start here gets its own face, whose one door opens the session per click.
import { createContext, useContext, useEffect, useRef } from 'react';
import { needDecisionQuestion, parseGitHubConnected, parseNeed } from '@neuramesh/shared';
import { githubFace } from '../cards/DependencyCard';
import { PickActs, RepoPick, useGitHubGrant, type GitHubGrant } from '../settings/GitHubStep';
import { IconGitHub } from '../ui/icons';

interface GateProps {
  channelId: string;
  room: string;
  repoName: string | null;
  /** the project's repository is a folder attached from a desktop: the cloud works on its GitHub copy */
  folder: boolean;
  /** opens the session again. With no repository yet it reads the room's repositories again, and the session opens on the root message */
  onConnected: () => void;
}

/** the thread's signs that GitHub connected: each connected divider, and each GitHub card whose decision row the resume
 *  answered (the card hides while the session waits). A key, never a verdict: the gate asks the server again when it moves */
export function connectedSigns(rows: Array<{ id: string; body: string }>, answers: (messageId: string) => Map<string, string>): string {
  return rows.filter((m) => {
    if (parseGitHubConnected(m.body)) return true;
    const need = parseNeed(m.body);
    const asked = need ? needDecisionQuestion(need) : null;
    return asked !== null && githubFace(answers(m.id).get(asked), null, undefined).connected !== null;
  }).map((m) => m.id).join(' ');
}

/** the coding thread hands its signs down through context, because CodingGate mounts the gate while the session waits */
export const GitHubSigns = createContext('');

export function GitHubGate(props: GateProps) {
  // the hook's finish opens the session once per mount, never after the gate left: two asks in flight (the poll, Check
  // again, a sign) can both answer connected, and a late answer ran the old reopen, which closed the channel of the new turn
  const finished = useRef(false);
  useEffect(() => { finished.current = false; return () => { finished.current = true; }; }, []);
  const finish = () => { if (finished.current) return; finished.current = true; props.onConnected(); };
  const g = useGitHubGrant(props.channelId, finish, { quiet: true });
  // a sign moved (a grant landed on another surface): the gate asks again, and a quiet ask only draws the connected face
  const signs = useContext(GitHubSigns);
  const { ask } = g;
  const was = useRef(signs);
  useEffect(() => { if (was.current === signs) return; was.current = signs; void ask(); }, [signs, ask]);
  return <GitHubGateFace {...props} g={g} />;
}

/** the gate's faces, from the grant's state */
export function GitHubGateFace({ g, room, repoName, folder, onConnected }: GateProps & { g: GitHubGrant }) {
  const name = repoName ?? 'this project';
  const where = `coding · #${room}${repoName ? ` · ${repoName}` : ''}`;
  const eye = <span className="hgateeye warm">{where} · waits for GitHub</span>;
  // connected, and the session waits: the machine refused before the grant reached it (its replica lags a pick,
  // a token call failed for a moment), or the grant came from another surface
  if (g.connected !== null && g.phase !== 'waiting') {
    return (
      <div className="hgate coding" role="group" aria-label="GitHub is connected">
        <span className="hgateeye">{where}</span>
        <h2 className="hgateh">GitHub is connected</h2>
        <p className="hgatep">The session starts with your message.</p>
        <div className="hgateacts"><button className="btn primary" onClick={() => onConnected()}>Start the session</button></div>
      </div>
    );
  }
  if (g.phase !== 'waiting' && g.repos && g.repos.length > 0) {
    return (
      <div className="hgate coding" role="group" aria-label="Pick the repository">
        {eye}
        <h2 className="hgateh">Pick the repository</h2>
        <p className="hgatep">The neuramesh app reads these repositories. Pick the one this project lives in.</p>
        <div className="inpick"><RepoPick repos={g.repos} pick={g.pick} hint={g.hint} onPick={g.setPick} /></div>
        <PickActs g={g} />
        {g.note && <span className="hgatenote" role="status">{g.note}</span>}
      </div>
    );
  }
  if (g.phase === 'waiting') {
    return (
      <div className="hgate coding" role="group" aria-label="Finish on GitHub">
        {eye}
        <h2 className="hgateh">Finish on GitHub</h2>
        <p className="hgatep">Pick {repoName ?? 'the repository'} on GitHub, then come back. The session starts with your message.</p>
        <div className="hgateacts"><button className="btn sm" onClick={() => void g.ask(true)}>Check again</button><span className="connwait"><i aria-hidden />This card checks every 5 s</span></div>
      </div>
    );
  }
  return (
    <div className="hgate coding" role="group" aria-label="Connect GitHub to code here">
      {eye}
      <h2 className="hgateh">Connect GitHub to code here</h2>
      <p className="hgatep">{folder
        ? `${name} is a folder on your Mac. A cloud session works on its GitHub copy. Connect GitHub, and the session starts with your message.`
        : repoName
          ? `A cloud session needs the neuramesh app on ${name}. Connect GitHub, and the session starts with your message.`
          : 'This project has no repository yet. Connect GitHub and pick it, and the session starts with your message.'}</p>
      <div className="hgateacts">
        <button className="btn primary" disabled={g.phase === 'busy' || g.phase === 'asking'} onClick={() => void g.grant()}><IconGitHub s={13} /><span>{g.phase === 'busy' ? 'Please wait…' : 'Connect GitHub'}</span></button>
        {g.note && <span className="hgatenote" role="status">{g.note}</span>}
      </div>
    </div>
  );
}
