// THE REPO CHIP (coding threads, 0144 — docs/design/coding-threads-2026-09 §5.1, door 1): the
// composer's fourth knob, beside the room, the brain and the machine. A pick makes the send birth a
// CODING conversation — the coding runtime works on that repository in it, on the one session
// surface — with no triage turn. The ProjectChip recipe: the pill, the upward popover, one row per
// repository the target room's project holds, the default tagged, and a foot that names the
// consequence (docs/34 §7: a composer must name its consequence).
import { useMemo, useState } from 'react';
import type { RepoUI } from '../bridge/rows-board';
import { IconBranch, IconThreads } from '../ui/icons';

const ids = (value?: string | null) => new Set((value ?? '').split(',').filter(Boolean));
/** the repository's short name: `owner/name`, or the folder's name for a repo attached from this machine */
export const repoLabel = (r: RepoUI): string => (r.org_name === 'local' ? r.name : `${r.org_name}/${r.name}`);
/** the project's repositories, the primary first — the same join the Code floor draws a new session from */
export function reposForProject(repos: RepoUI[], projectId: string | null): RepoUI[] {
  if (!projectId) return repos;
  const inProject = repos.filter((r) => ids(r.project_ids).has(projectId) || ids(r.primary_project_ids).has(projectId));
  return inProject.sort((a, b) => Number(ids(b.primary_project_ids).has(projectId)) - Number(ids(a.primary_project_ids).has(projectId)));
}

export function RepoChip({ repos, projectId, value, onPick, onConnect, disabled = false }: {
  repos: RepoUI[];
  /** the target room's project — the rows are its repositories */
  projectId: string | null;
  /** the picked repository; null = a conversation */
  value: string | null;
  onPick: (repoId: string | null) => void;
  /** the door to connect one when the project has none */
  onConnect?: () => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rows = useMemo(() => reposForProject(repos, projectId), [repos, projectId]);
  const primary = projectId ? rows.find((r) => ids(r.primary_project_ids).has(projectId)) ?? null : null;
  const current = value ? repos.find((r) => r.id === value) ?? null : null;
  const label = current ? repoLabel(current) : 'repo';
  return (
    <span className="cchips">
      <button className={`cchip crepo${open ? ' open' : ''}${current ? ' lit' : ''}`} disabled={disabled} aria-haspopup="menu" aria-expanded={open}
        data-tip={current ? `Works on ${label} — a coding conversation` : 'Work on a repository — the send becomes a coding conversation'} onClick={() => setOpen((o) => !o)}>
        <span className="g" aria-hidden><IconBranch s={13} /></span><span className="lbl">{label}</span><span className="car" aria-hidden>▾</span>
      </button>
      {open && (
        <>
          <div className="projmenu-scrim" onClick={() => setOpen(false)} />
          <div className="cprojpop cmachpop" role="menu">
            <div className="cprojhint">Work on a repository</div>
            <button role="menuitemradio" aria-checked={value === null} className={`cprojitem${value === null ? ' on' : ''}`} onClick={() => { onPick(null); setOpen(false); }}>
              <span className="cprojglyph"><IconThreads s={13} /></span>
              <span className="cprojtxt"><b>None</b><span className="cmachsub">a conversation</span></span>
              {value === null && <span className="cprojck">✓</span>}
            </button>
            {rows.map((r) => {
              const on = value === r.id;
              return (
                <button key={r.id} role="menuitemradio" aria-checked={on} className={`cprojitem${on ? ' on' : ''}`} onClick={() => { onPick(r.id); setOpen(false); }}>
                  <span className="cprojglyph"><IconBranch s={13} /></span>
                  <span className="cprojtxt"><b>{repoLabel(r)}</b>{r.local_path ? <span className="cmachsub">on this machine</span> : null}</span>
                  {primary?.id === r.id && <span className="cprojtag">default</span>}
                  {on && <span className="cprojck">✓</span>}
                </button>
              );
            })}
            {!rows.length && <div className="cprojempty">This project has no repository yet.</div>}
            {onConnect && (
              <button role="menuitem" className="cprojitem" onClick={() => { setOpen(false); onConnect(); }}>
                <span className="cprojglyph" aria-hidden>＋</span><span className="cprojtxt"><b>Connect a repository…</b></span>
              </button>
            )}
            <div className="cmachfoot"><b>A repository makes this a coding conversation.</b> Nothing reaches the board unless you ask.</div>
          </div>
        </>
      )}
    </span>
  );
}
