import { useRef, useState } from 'react';
import type { WorkspaceProjectRow } from '../bridge/rows-board';
import { ProjLogo } from '../components/AgentAvatar';
import { IconProject, IconSearch } from '../ui/icons';

/** The shared composer project picker. It opens upward from the chip so the input never moves. */
export function ProjectChip({ projects, active, onSwitch, onNew, disabled = false }: {
  projects: WorkspaceProjectRow[];
  active: WorkspaceProjectRow | null;
  onSwitch: (id: string) => void;
  onNew: (origin: { x: number; y: number } | null) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const chipRef = useRef<HTMLButtonElement>(null);
  const activeProjects = projects.filter((project) => project.status === 'active');
  const needle = q.trim().toLowerCase();
  const shown = needle ? activeProjects.filter((project) => `${project.slug} ${project.name}`.toLowerCase().includes(needle)) : activeProjects;
  const chipOrigin = () => {
    const rect = chipRef.current?.getBoundingClientRect();
    return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null;
  };
  if (!active) return null;
  return (
    <div className="cchips">
      <button ref={chipRef} className={`cchip${open ? ' open' : ''}`} disabled={disabled}
        data-tip={`Project: ${active.slug} — click to switch or create`}
        onClick={() => { setOpen((value) => !value); setQ(''); }}>
        {active.logo_url ? <ProjLogo logo={active.logo_url} name={active.name || active.slug} size={14} radius={4} /> : <IconProject s={11} />}
        <span className="lbl">{active.slug}</span>
        <span className="car">▾</span>
      </button>
      {open && (
        <>
          <div className="projmenu-scrim" onClick={() => setOpen(false)} />
          <div className="cprojpop">
            {activeProjects.length > 6 && (
              <div className="cprojsearch">
                <IconSearch s={13} />
                <input autoFocus value={q} onChange={(event) => setQ(event.target.value)} placeholder="Search projects"
                  onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false); }} />
              </div>
            )}
            <div className="cprojlist">
              {shown.map((project) => (
                <button key={project.id} className={`cprojitem${project.id === active.id ? ' on' : ''}`}
                  onClick={() => { setOpen(false); if (project.id !== active.id) onSwitch(project.id); }}>
                  <span className="cprojglyph">{project.logo_url ? <ProjLogo logo={project.logo_url} name={project.name || project.slug} size={16} /> : <IconProject s={13} />}</span>
                  <span className="cprojtxt"><b>{project.slug}</b><span>{project.name}{project.open_tasks ? ` · ${project.open_tasks} open` : ''}</span></span>
                  {project.is_default ? <span className="cprojtag">default</span> : null}
                  {project.id === active.id && <span className="cprojck">✓</span>}
                </button>
              ))}
              {!shown.length && <div className="cprojempty">No project matches “{q.trim()}”.</div>}
            </div>
            <button className="cprojnew" onClick={() => { setOpen(false); onNew(chipOrigin()); }}>＋ New project</button>
          </div>
        </>
      )}
    </div>
  );
}
