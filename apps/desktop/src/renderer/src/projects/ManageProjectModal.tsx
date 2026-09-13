// Project settings — rename, re-logo, archive or delete one project.
// Extracted from App.tsx (track A2).
import { BrainChip } from '../brain/BrainChip';
import { LogoField } from './LogoField';
import { Modal } from '../ui/Modal';
import { Switch } from '../ui/Switch';
import { cleanErr } from '../lib/text';
import { nm as nmBridge } from '../bridge/nm';
import { type Provider } from '@neuramesh/shared';
import { type RepoUI, type WorkspaceProjectRow } from '../bridge/rows-board';
import { useRef, useState } from 'react';

// Imported bindings lose control-flow narrowing inside closures, so re-bind (same as App.tsx).
const nm = nmBridge;

// Manage a project: rename, move channels in/out (1:N — unchecking returns a
// channel to the default project), archive/unarchive.
export function ManageProjectModal({ project, repos, onClose, onChanged, onAddRepo, initialDelete, onSetProjectPack, onBrainConnect }: { project: WorkspaceProjectRow; repos: RepoUI[]; onClose: () => void; onChanged: () => void; onAddRepo: () => void; initialDelete?: boolean; onSetProjectPack?: (projectId: string, packId: string) => Promise<void>; onBrainConnect?: (p: Provider) => void }) {
  const [name, setName] = useState(project.name);
  const [desc, setDesc] = useState(project.description);
  const [autoPr, setAutoPr] = useState(project.auto_open_pr == null ? true : !!project.auto_open_pr);
  const [runCi, setRunCi] = useState(project.run_ci_before_merge == null ? true : !!project.run_ci_before_merge);
  // ship gate (docs/23) — null (pre-flag replica rows) reads ON, matching the server default
  const [shipGate, setShipGate] = useState(project.ship_gate == null ? true : !!project.ship_gate);
  // identity — website + detected logo. logoCleared latches the × so auto-detect
  // never re-adds a removed logo; save sends only what changed ('' clears server-side).
  const [website, setWebsite] = useState(project.website ?? '');
  const [logo, setLogoState] = useState<string | null>(project.logo_url ?? null);
  const logoCleared = useRef(false);
  const setLogo = (v: string | null) => { logoCleared.current = v === null; setLogoState(v); };
  const repoFolder = repos.find((r) => r.local_path)?.local_path ?? null;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const archived = project.status === 'archived';
  const chanCount = (project.channel_slugs ?? '').split(',').filter(Boolean).length;
  // the Projects page's kebab can open straight onto the delete confirm (archived rows only)
  const [confirmDelete, setConfirmDelete] = useState(!!initialDelete && project.status === 'archived' && !project.is_default);
  const [slugInput, setSlugInput] = useState('');
  const [deleting, setDeleting] = useState(false);
  const save = async () => {
    if (!nm || busy || !name.trim()) return;
    setBusy(true); setErr('');
    try {
      const websiteChanged = website.trim() !== (project.website ?? '');
      const logoChanged = (logo ?? null) !== (project.logo_url ?? null);
      await nm.projectUpdate(project.id, name.trim(), desc, autoPr, runCi, shipGate, {
        website: websiteChanged ? website.trim() : undefined,
        logoUrl: logoChanged ? (logo ?? '') : undefined,
      });
      onChanged();
      onClose();
    } catch (e) { setErr(cleanErr(e, 'could not save project')); setBusy(false); }
  };
  const toggleArchive = async () => {
    if (!nm || busy) return;
    setBusy(true); setErr('');
    try { await nm.projectArchive(project.id, !archived); onChanged(); onClose(); }
    catch (e) { setErr(cleanErr(e, 'could not archive project')); setBusy(false); }
  };
  const doDelete = async () => {
    if (!nm || deleting || slugInput.trim() !== project.slug) return;
    setDeleting(true); setErr('');
    try { await nm.projectDelete(project.id); onChanged(); onClose(); }
    catch (e) { setErr(cleanErr(e, 'could not delete project')); setDeleting(false); }
  };
  // type-the-slug confirmation, shown in place of the settings when Delete is clicked
  if (confirmDelete) {
    const slugMatch = slugInput.trim() === project.slug;
    const back = () => { setConfirmDelete(false); setSlugInput(''); setErr(''); };
    return (
      <Modal
        title={`Delete “${project.name}”?`}
        onClose={back}
        footer={
          <>
            <button className="btn sm" style={{ marginRight: 'auto' }} disabled={deleting} onClick={back}>Back</button>
            <button className="btn danger sm" style={{ width: 'auto', marginTop: 0, padding: '5.5px 16px' }} disabled={deleting || !slugMatch} onClick={() => void doDelete()}>{deleting ? 'Deleting…' : 'Delete forever'}</button>
          </>
        }
      >
        <p className="modalhint">This <b>permanently deletes</b> this project and everything in it — its <b>{chanCount} channel{chanCount === 1 ? '' : 's'}</b>, plus every task, message, artifact, and audit record under them. <b style={{ color: 'var(--blocked)' }}>This can’t be undone.</b></p>
        <div className="fld">
          <label>Type the project slug <code>{project.slug}</code> to confirm</label>
          <input autoFocus value={slugInput} onChange={(e) => setSlugInput(e.target.value)} placeholder={project.slug}
            onKeyDown={(e) => { if (e.key === 'Enter' && slugMatch) void doDelete(); }} />
        </div>
        {err && <div className="acterr" style={{ marginTop: 8 }}>{err}</div>}
      </Modal>
    );
  }
  return (
    <Modal
      title="Project settings"
      onClose={onClose}
      wide
      subtitle={`${name.trim() || project.slug} · ${repos.length} repo${repos.length === 1 ? '' : 's'} · ${chanCount} channel${chanCount === 1 ? '' : 's'}`}
      footer={
        <>
          {!project.is_default && <button className="btn danger sm" style={archived ? undefined : { marginRight: 'auto' }} disabled={busy} onClick={() => void toggleArchive()}>{archived ? 'Unarchive' : 'Archive'}</button>}
          {archived && !project.is_default && <button className="btn danger sm" style={{ marginRight: 'auto' }} title="delete project" disabled={busy} onClick={() => { setSlugInput(''); setErr(''); setConfirmDelete(true); }}>Delete project</button>}
          <button className="btn primary sm" style={{ width: 'auto', marginTop: 0, padding: '5.5px 16px' }} disabled={busy || !name.trim()} onClick={() => void save()}>{busy ? 'Saving…' : 'Save changes'}</button>
        </>
      }
    >
      <div className="sect" style={{ padding: '14px 0 5px' }}>General</div>
      <div className="fld"><label>Project name</label>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div className="fld"><label>Description</label>
        <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="What this initiative delivers" /></div>
      <LogoField name={name || project.slug} website={website} setWebsite={setWebsite} logo={logo} setLogo={setLogo} cleared={logoCleared} folderPath={repoFolder} />
      <div className="sect" style={{ padding: '16px 0 6px' }}>Repositories · {repos.length}</div>
      {repos.length === 0
        ? <div className="kvline"><span>no repositories yet</span><b>—</b></div>
        : repos.map((r) => (
            <div key={r.id} className="psrepo">
              <span className="psrepoico">⌥</span>
              <div className="psrepobody"><b>{r.org_name}/{r.name}</b><span>connected · agents branch on nm/&lt;id&gt;</span></div>
              <span className="psrepobranch">{r.default_branch}</span>
            </div>
          ))}
      <button className="btn sm" style={{ marginTop: 9 }} onClick={onAddRepo}>+ Connect a repository</button>

      <div className="sect" style={{ padding: '18px 0 6px' }}>Automation</div>
      <div className="psauto">
        <div className="psautotext"><b>Auto-open pull requests</b><span>Agents open a PR when a task passes review.</span></div>
        <Switch on={autoPr} onToggle={() => setAutoPr((v) => !v)} title={autoPr ? 'on' : 'off'} />
      </div>
      <div className="psauto">
        <div className="psautotext"><b>Run CI before merge</b><span>Block merges until the test suite is green.</span></div>
        <Switch on={runCi} onToggle={() => setRunCi((v) => !v)} title={runCi ? 'on' : 'off'} />
      </div>
      <div className="psauto">
        <div className="psautotext"><b>Release gate</b><span>Reviewed, PR-backed tasks get a production-readiness plan from the channel shipper before anything merges. Off = accept merges immediately.</span></div>
        <Switch on={shipGate} onToggle={() => setShipGate((v) => !v)} title={shipGate ? 'on' : 'off'} />
      </div>

      {/* per-project brains (docs/10): the SAME picker as the composer chip, scoped here.
          Unlike the workspace pack this is never materialized onto the agents — the daemon
          resolves each run from the project — so it applies the moment it's set. */}
      <div className="sect" style={{ padding: '18px 0 6px' }}>Brains</div>
      <div className="psauto">
        <div className="psautotext">
          <b>Model pack for this project</b>
          <span>{project.model_pack ? 'Overriding the workspace brain — work in this project runs on the pack below.' : 'Following the workspace brain. Pick a pack to override it here only.'}</span>
        </div>
        {onSetProjectPack && (
          <BrainChip
            onConnect={onBrainConnect ?? (() => {})}
            project={{ id: project.id, name: project.name, pack: project.model_pack ?? null }}
            onSetProjectPack={(packId) => onSetProjectPack(project.id, packId)}
          />
        )}
      </div>

      {err && <div className="acterr" style={{ marginTop: 10 }}>{err}</div>}
    </Modal>
  );
}

// ── History, at two scales (v0.69) ──────────────────────────────────────────────────────
//
// It used to be a room TAB (v0.63), which meant asking "what did we talk about?" cost you the
// conversation — opening History replaced the feed. So it moved to the left nav, where it can
// be ambient. But the nav is 266px, and today's row (30px icon + title + preview + state chip)
// truncates a title to ~24 characters there: `#1034 · flowe logo rev…`, which is not a row you
// can scan. Measured in `mockups/history-in-nav.html` §A rather than argued.
//
// So: two scales of one surface, the same shape the beats tracker already uses (docs/25 — a
// resting one-line ticker that expands into the full set).
//   · HistoryRail — at rest in the nav. One line: state dot · number · title · time. No
//     preview, no chip. A jump list, and honest about being one.
//   · HistoryOverlay — expanded. The full-width surface with everything the rail dropped,
//     floating over whatever you were doing, so it costs the conversation nothing.
// Both read the same `historyRows`, and both span every room when no channel is active.
