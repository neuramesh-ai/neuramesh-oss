// WORKSPACES BY CONNECTION (U3b, the source-release round — artboard B4): the block the workspace
// foot's menu (ProjectsFace) lists its workspaces in once the desktop holds connections. The rows
// list every workspace of every connection under the kickers the rail's bands wear (only when two
// connections exist), the one you stand in selected, then the account on the cloud, Settings ›
// Connections, and a new workspace. No cloud yet: one `Get Pro` row, the door to it. Picking a
// workspace on another connection is the rail's own swap — `setForeground`, no relaunch.
import { Fragment } from 'react';
import { IconCloud, IconCompose, IconServer, IconUser } from '../ui/icons';
import type { ConnectionSummary } from '../bridge/nm';
import type { WorkspaceMembership } from '../bridge/rows-crew';
import { navBandName, navConnectionOrder } from '../navbands';
import { WsTile } from './ProjectsFace';

export function WorkspacesByConnection({ connections, foregroundConnection, activeWorkspace, liveConnections, onPickWorkspace, onProfile, onConnections, onNewWorkspace, onGetPro, onMoveToCloud }: {
  connections: ConnectionSummary[];
  foregroundConnection: string | null;
  activeWorkspace: string;
  /** connections where an agent works right now — the kicker's pulse */
  liveConnections?: Set<string>;
  onPickWorkspace: (connectionId: string, w: WorkspaceMembership) => void;
  onProfile: () => void;
  onConnections?: () => void;
  onNewWorkspace?: () => void;
  onGetPro?: () => void;
  /** Move to Cloud (U7): the local workspace into a Pro workspace, the same door as the This Mac card (lib/toast openMoveToCloud) */
  onMoveToCloud?: () => void;
}) {
  const ordered = connections.slice().sort(navConnectionOrder);
  const cloud = ordered.find((c) => c.kind === 'cloud');
  const where = (c: ConnectionSummary) => (c.kind === 'local' ? 'this Mac' : c.kind === 'cloud' ? 'neuramesh.app' : c.host);
  return (<>
    {ordered.map((c) => (
      <Fragment key={c.id}>
        {ordered.length > 1 && (
          <div className="acctsect pfconnk">{liveConnections?.has(c.id) && <span className="navconnpulse" aria-hidden />}{navBandName(c)}</div>
        )}
        {c.workspaces.map((w) => {
          const here = c.id === foregroundConnection && w.id === activeWorkspace;
          return (
            <button key={`${c.id}:${w.id}`} type="button" className={`wspick${here ? ' on' : ''}`}
              onClick={() => { if (!here) onPickWorkspace(c.id, w); }}
              aria-current={here ? 'true' : undefined}
              aria-label={`${w.name} on ${navBandName(c)}${here ? ', you are here' : ''}`}>
              <WsTile name={w.name} active={here} />
              <span className="wsbody"><b>{w.name}</b><span>{where(c)}</span></span>
              {here && <span className="wshere">here</span>}
            </button>
          );
        })}
      </Fragment>
    ))}
    {cloud?.account && <button type="button" className="pfnew" onClick={onProfile}><IconUser s={14} /> Account · {cloud.account.email}</button>}
    {onConnections && <button type="button" className="pfnew" onClick={onConnections}><IconServer s={14} /> Connections</button>}
    {onNewWorkspace && <button type="button" className="pfnew" onClick={onNewWorkspace}><IconCompose s={14} /> New workspace</button>}
    {onMoveToCloud && <button type="button" className="pfnew" onClick={onMoveToCloud}><IconCloud s={14} /> Migrate to Cloud</button>}
    {!cloud && onGetPro && <button type="button" className="pfnew" onClick={onGetPro}><IconCloud s={14} /> Get Pro</button>}
  </>);
}
