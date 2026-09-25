// The projects face — the workspace's tiles and the account menu above them.
// Extracted from App.tsx (track A2).
import { IconAgents, IconCloud, IconCredits, IconDockLeft, IconDockRight, IconDockTop, IconFootprint, IconGrid, IconHome, IconMachine, IconMedal, IconRepeat, IconSettings, IconSignOut, IconTheme, IconUser } from '../ui/icons';

import { selfInitial } from '../lib/self';
import { type WorkspaceMembership } from '../bridge/rows-crew';
import { type ConnectionSummary } from '../bridge/nm';
import { WorkspacesByConnection } from './WorkspacesByConnection';
import { planStripFor } from './planstrip';
import { useEffect, useRef } from 'react';

// Profile flyout anchored above the bottom-left user icon: identity · plan · settings · sign out.
export function AccountMenu({ user, displayName, isCloud, local = false, navPos, workspaces, activeWorkspace, onSwitchWorkspace, onClose, onWorkspace, onProfile, onUpgrade, onTour, onSignout, onAppearance, onNavPos, onAgents, onFootprint, onCompute, onCredits, onRetro }: {
  user: { id: string; email: string } | null;
  displayName: string;
  isCloud: boolean;
  /** a local connection (main/connections.ts): no plan here, so no plan strip (planstrip.ts) */
  local?: boolean;
  navPos: 'left' | 'top' | 'right';
  // every workspace this identity belongs to, and the one being rendered (0113)
  workspaces: WorkspaceMembership[]; activeWorkspace: string;
  onSwitchWorkspace: (w: WorkspaceMembership) => void;
  onClose: () => void; onWorkspace: () => void; onProfile: () => void; onUpgrade: () => void; onTour: () => void; onSignout: () => void;
  onAppearance: () => void; onNavPos: (p: 'left' | 'top' | 'right') => void;
  // workspace-scoped views live here now (conversation-first shell): Agents & machines, Retro
  onAgents: () => void; onFootprint: () => void; onCompute: () => void; onCredits: () => void; onRetro: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { const t = e.target as HTMLElement; if (ref.current && !ref.current.contains(t) && !t.closest?.('.navuser')) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDoc); document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [onClose]);
  return (
    <div className="acctmenu" ref={ref}>
      <div className="accthead">
        <span className="acctav">{selfInitial(user?.email)}</span>
        <div className="acctid"><b>{displayName}</b><span title={user?.email ?? ''}>{user?.email}</span></div>
      </div>
      {(() => { const strip = planStripFor({ local, isCloud }); return strip && (
        <button className="acctplan" onClick={() => { onClose(); if (strip.door) onUpgrade(); }}>
          <span className="acctplanico">{strip.pro ? <IconCloud s={17} /> : <IconHome s={17} />}</span>
          <div className="acctplanbody"><b>{strip.name}</b><span>{strip.sub}</span></div>
          {strip.door && <span className="acctupg">{strip.door}</span>}
        </button>
      ); })()}
      {/* Workspaces (0113). Absent entirely when you belong to one — a switcher nobody needs
          should not be visible, and this menu is byte-for-byte what it was for those users.
          It lives HERE because the dock moves (left/top/right) and this is the only surface
          present in all three, and because the workspace belongs on the identity ladder the
          menu already runs: who you are → what you pay → which workspace you are standing in. */}
      {workspaces.length > 1 && (
        <>
          <div className="acctsect">Workspaces</div>
          {workspaces.map((w) => (
            <button key={w.id} className={`wspick${w.id === activeWorkspace ? " on" : ""}`}
              onClick={() => { if (w.id !== activeWorkspace) { onClose(); onSwitchWorkspace(w); } }}
              aria-current={w.id === activeWorkspace ? 'true' : undefined}
              title={w.id === activeWorkspace ? `${w.name} — you are here` : `Switch to ${w.name}`}>
              <WsTile name={w.name} active={w.id === activeWorkspace} />
              <span className="wsbody">
                <b>{w.name}</b>
                <span>{w.role ?? 'member'}{w.memberCount ? ` · ${w.memberCount} member${w.memberCount === 1 ? '' : 's'}` : ''}</span>
              </span>
              {/* Where this machine's agents actually are. Your machine registers to ONE
                  workspace, so without this "why is bosun offline?" has no answer on screen. */}
              {w.id === activeWorkspace && <span className="wshere">here</span>}
            </button>
          ))}
        </>
      )}
      <div className="acctsect">Workspace</div>
      <button className="acctitem" onClick={() => { onClose(); onAgents(); }}><span className="acctico"><IconAgents s={15} /></span> Agents &amp; machines</button>
      <button className="acctitem" onClick={() => { onClose(); onFootprint(); }}><span className="acctico"><IconFootprint s={15} /></span> Footprint</button>
      {/* beside Footprint in ALL THREE menus (George, 2026-08-13). The side dock is the default
          and renders ProjectsFace, not the rail — a rail-only entry is invisible where most
          people actually are, which is how this nearly shipped unreachable. */}
      <button className="acctitem" onClick={() => { onClose(); onCompute(); }}><span className="acctico"><IconMachine s={15} /></span> Compute</button>
      {/* Credits rides beside Compute + Footprint: all three answer "what is this workspace
          spending", so they belong on the same shelf (George, 2026-08-31). */}
      <button className="acctitem" onClick={() => { onClose(); onCredits(); }}><span className="acctico"><IconCredits s={15} /></span> Credits</button>
      <button className="acctitem" onClick={() => { onClose(); onRetro(); }}><span className="acctico"><IconMedal s={15} /></span> Retro</button>
      <button className="acctitem" onClick={() => { onClose(); onWorkspace(); }}><span className="acctico"><IconSettings s={15} /></span> Workspace settings</button>
      <div className="acctsect">You</div>
      <button className="acctitem" onClick={() => { onClose(); onProfile(); }}><span className="acctico"><IconUser s={15} /></span> Your profile</button>
      <button className="acctitem" onClick={() => { onClose(); onTour(); }}><span className="acctico"><IconRepeat s={15} /></span> Replay the walkthrough</button>
      <button className="acctitem danger" onClick={() => { onClose(); onSignout(); }}><span className="acctico"><IconSignOut s={15} /></span> Sign out</button>
      <div className="acctfoot">
        <button className="acctfootbtn" title="Appearance — choose a theme" aria-label="Appearance" onClick={() => { onClose(); onAppearance(); }}>
          <IconTheme s={16} /><span>Theme</span>
        </button>
        <div className="navdockseg" role="group" aria-label="Navigation position">
          {([['left', IconDockLeft, 'Dock left'], ['top', IconDockTop, 'Dock to top'], ['right', IconDockRight, 'Dock right']] as const).map(([p, Icon, label]) => (
            <button key={p} className={`navdockbtn${navPos === p ? ' on' : ''}`} title={label} aria-label={label} aria-pressed={navPos === p} onClick={() => onNavPos(p)}>
              <Icon s={15} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── multi-workspace (0113) ────────────────────────────────────────────────────────────────────
// A workspace's face in the switcher and on the invitation cards: its initial, in the same tile
// ramp the account avatar uses. Deliberately not the project logo — that mark belongs to the
// project axis, and reusing it here would make two different containers look like one thing.
export function WsTile({ name, size = 24, active = false }: { name: string; size?: number; active?: boolean }) {
  return (
    <span className={`wstile${active ? ' on' : ''}`} aria-hidden
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.29), fontSize: Math.round(size * 0.45) }}>
      {(name?.[0] ?? '?').toUpperCase()}
    </span>
  );
}

/**
 * THE SECOND FACE (v0.76 slice 2) — the nav column showing PROJECTS instead of rooms.
 *
 * Not a popover, and the distinction is the whole design: same column, same 266px, same
 * transparent ground, no shadow, no scrim. The reveal round 2 first drew was a 216px panel
 * sitting BESIDE the nav, which put two nav-shaped things on screen doing one job with the real
 * nav dimmed behind looking abandoned (George rejected it in one line: "the project rail becomes
 * the project nav instead of a separate nav appearing right of it"). One column, two faces, and a
 * 30px spine that swaps them — so layout shift is 0px by construction rather than by care.
 *
 * It is a complete workspace menu rather than a fragment: the workspace header the nav head used
 * to carry, Home in full, then the projects, then the two doors out — create, and the Projects
 * page, which stays the MANAGEMENT surface (rename · archive · move channels). The rail switches;
 * the page manages; neither grows into the other.
 */
export function ProjectsFace({
  on, workspace, workspaceInitial,
  isCloud, account, navPos, workspaces, activeWorkspace, footprintPct,
  connections, foregroundConnection, liveConnections, onPickWorkspace, onConnections, onGetPro, onMoveToCloud,
  onAll, onSwitchWorkspace, onUpgrade, onAgents, onFootprint, onCompute, onCredits, onRetro, onWorkspace, onProfile, onTour, onSignout, onAppearance, onNavPos,
}: {
  /** showing, or crossing out — it stays mounted either way so the exit can animate */
  on: boolean;
  workspace: string;
  /** the WORKSPACE mark for the header. It was `selfInitial` — a person-shaped name on the prop
   *  that has always been fed the workspace's initial. Now that the real account avatar sits in
   *  this same panel's footer, two avatars 40px apart had to stop claiming to be the same thing. */
  workspaceInitial: string;
  isCloud: boolean;
  account: { initial: string; name: string; email: string | null };
  navPos: 'left' | 'top' | 'right';
  /** the workspace switcher (0113). The side dock has its own account panel rather than the
   *  <AccountMenu> popover, so the rows have to exist in BOTH — a switcher that only appears
   *  when you happen to be docked top is not a switcher. */
  workspaces: WorkspaceMembership[];
  activeWorkspace: string;
  onSwitchWorkspace: (w: WorkspaceMembership) => void;
  /** THE CONNECTIONS (U3b, artboard B4): every backend this launch holds, each with its workspaces.
   *  Present on the desktop, absent in the browser (one backend, the block below stays as it was).
   *  A connection whose agent works right now wears the pulse on its kicker. */
  connections?: ConnectionSummary[] | null;
  foregroundConnection?: string | null;
  liveConnections?: Set<string>;
  /** picking a workspace on ANY connection — the same `setForeground` call the rail's rows make */
  onPickWorkspace?: (connectionId: string, w: WorkspaceMembership) => void;
  /** Settings › Connections */
  onConnections?: () => void;
  /** the Get Pro door (App opens the Upgrade sheet) — drawn only while no cloud connection exists */
  onGetPro?: () => void;
  onMoveToCloud?: () => void;
  onAll: () => void;
  /** disk used by this machine's agent worktrees, 0-100 — Home's corner ring, rehomed. `null` while unread */
  footprintPct: number | null;
  onUpgrade: () => void;
  onAgents: () => void;
  onFootprint: () => void;
  onCompute: () => void;
  onCredits: () => void;
  onRetro: () => void;
  onWorkspace: () => void;
  onProfile: () => void;
  onTour: () => void;
  onSignout: () => void;
  onAppearance: () => void;
  onNavPos: (p: 'left' | 'top' | 'right') => void;
}) {
  // the house entrance stagger (docs/33 §7): one beat apart, down the list, capped so a long
  // roster never turns arrival into a queue you wait out
  let step = 0;
  const rise = () => ({ ['--i' as string]: String(Math.min(step++, 7)) });
  return (
    <div className="navface projects" data-on={on ? '1' : '0'} aria-hidden={!on}>
      <div className="pfhd">
        <span className="pfhdav" aria-hidden>{workspaceInitial}</span>
        <span className="pfhdt"><b>{workspace || '…'}</b><small>workspace</small></span>
        <span className="pfesc" aria-hidden>esc</span>
      </div>
      {/* The PROJECTS LIST left this panel (2026-08-07, George): every project is a collapsible
          group in the tree beside it, with its own ＋ (new chat here), # (its channels) and the
          section's ＋ (new project). A switcher for a list already on screen is the duplication
          docs/33 §8 spent the projects round removing — so this face is now purely the WORKSPACE
          menu, which is what its header always claimed. Per-project settings stay one click away
          on All projects, the page that manages (rename · archive · move channels). */}
      <button type="button" className="pfnew" style={rise()} onClick={onAll}><IconGrid s={13} /> All projects</button>
      {/* THE PLAN STRIP (2026-08-04, reworded in the source-release round): Free or Pro, the rule in
          planstrip.ts. ABSENT on a local connection, where no plan exists and the connections block
          below carries the Get Pro door. No project count: Free has no project cap. */}
      {(() => { const strip = planStripFor({ local: connections?.find((c) => c.id === foregroundConnection)?.kind === 'local', isCloud }); return strip && (
        <button type="button" className={`pfplan${strip.pro ? ' cloud' : ''}`} style={rise()} onClick={() => { if (strip.door) onUpgrade(); }} disabled={strip.pro}>
          <span className="pfico" aria-hidden>{strip.pro ? <IconCloud s={15} /> : <IconHome s={15} />}</span>
          <span className="pfplanbody"><b>{strip.name}</b><span>{strip.sub}</span></span>
          {strip.door && <span className="pfupg">{strip.door}</span>}
        </button>
      ); })()}
      {/* WORKSPACE nouns. They were a section in the popup and the whole subject of this panel —
          the header two zones up already says `workspace`, so the settings row needs no prefix. */}
      <div className="pfsep" />
      <div className="navsecthd"><div className="navsecttoggle" style={{ cursor: 'default' }}>Workspace</div></div>
      <button type="button" className="pfnew" style={rise()} onClick={onAgents}><IconAgents s={14} /> Agents &amp; machines</button>
      {/* Home's corner ring, rehomed (2026-08-16): a gauge with no door beside it was the last
          thing left on a screen that is going away. Here the number sits on the row that opens it. */}
      <button type="button" className="pfnew" style={rise()} onClick={onFootprint}>
        <IconFootprint s={14} /> Footprint
        {footprintPct != null && (
          <span className="pfgauge" aria-hidden>
            <span className="pfring" style={{ ['--frac' as string]: `${Math.max(0, Math.min(100, footprintPct))}%` }} />
            {Math.round(footprintPct)}%
          </span>
        )}
      </button>
      <button type="button" className="pfnew" style={rise()} onClick={onCompute}><IconMachine s={14} /> Compute</button>
      <button type="button" className="pfnew" style={rise()} onClick={onCredits}><IconCredits s={14} /> Credits</button>
      <button type="button" className="pfnew" style={rise()} onClick={onRetro}><IconMedal s={14} /> Retro</button>
      <button type="button" className="pfnew" style={rise()} onClick={onWorkspace}><IconSettings s={14} /> Settings</button>
      {/* THE ACCOUNT BLOCK, always present (2026-08-20). It was a disclosure behind the foot
          avatar's extra click, collapsed at rest because the panel opened on HOVER and Sign out
          must not be a drift-reveal. Click-only (#298) retired that risk, and George called the
          consequence: the face has all this empty floor — put the account rows on it. One click
          opens the face; everything it holds is simply there. */}
      <div className="pfgrow" />
      <div className="pfacct">
          <div className="pfacctitems">
            {/* WORKSPACES BY CONNECTION (U3b, artboard B4). The desktop holds the local stack and,
                after the upgrade, the cloud: the rows list every workspace of every connection
                under the same kickers the rail's bands wear (only when two connections exist),
                the one you stand in selected, then the account on the cloud, Settings ›
                Connections, and a new workspace. No cloud yet: one `Get Pro` row, the door to it.
                Picking a workspace on another connection is the rail's own swap, no relaunch. */}
            {connections && connections.length > 0 && onPickWorkspace ? (
              <WorkspacesByConnection connections={connections} foregroundConnection={foregroundConnection ?? null} activeWorkspace={activeWorkspace} liveConnections={liveConnections}
                onPickWorkspace={onPickWorkspace} onProfile={onProfile} onConnections={onConnections} onGetPro={onGetPro} onMoveToCloud={onMoveToCloud} />
            ) : workspaces.length > 1 && (
              <>
                <div className="acctsect">Workspaces</div>
                {workspaces.map((w) => (
                  <button key={w.id} type="button" className={`wspick${w.id === activeWorkspace ? " on" : ""}`}
                    onClick={() => { if (w.id !== activeWorkspace) onSwitchWorkspace(w); }}
                    aria-current={w.id === activeWorkspace ? 'true' : undefined}
                    title={w.id === activeWorkspace ? `${w.name} — you are here` : `Switch to ${w.name}`}>
                    <WsTile name={w.name} active={w.id === activeWorkspace} />
                    <span className="wsbody">
                      <b>{w.name}</b>
                      <span>{w.role ?? 'member'}{w.memberCount ? ` · ${w.memberCount} member${w.memberCount === 1 ? '' : 's'}` : ''}</span>
                    </span>
                    {w.id === activeWorkspace && <span className="wshere">here</span>}
                  </button>
                ))}
              </>
            )}
            <div className="acctsect">{account.name}</div>
            <button type="button" className="pfnew" onClick={onProfile}><IconUser s={14} /> Your profile</button>
            <button type="button" className="pfnew" onClick={onTour}><IconRepeat s={14} /> Replay the walkthrough</button>
            <button type="button" className="pfnew danger" onClick={onSignout}><IconSignOut s={14} /> Sign out</button>
            {/* preferences, not destinations — a control strip rather than two more list rows */}
            <div className="pfprefs">
              <button type="button" className="pfpref" title="Appearance — choose a theme" onClick={onAppearance}>
                <IconTheme s={15} /><span>Theme</span>
              </button>
              <div className="navdockseg" role="group" aria-label="Navigation position">
                {([['left', 'Dock left'], ['top', 'Dock top'], ['right', 'Dock right']] as const).map(([p, label]) => (
                  <button key={p} type="button" className={`navdockbtn${navPos === p ? ' on' : ''}`} title={label} aria-label={label} aria-pressed={navPos === p} onClick={() => onNavPos(p)}>
                    {p === 'left' ? <IconDockLeft s={13} /> : p === 'top' ? <IconDockTop s={13} /> : <IconDockRight s={13} />}
                  </button>
                ))}
              </div>
            </div>
          </div>
      </div>
      <div className="pffoot">Click the workspace bar to close <span className="k">⌘⇧P</span></div>
    </div>
  );
}
