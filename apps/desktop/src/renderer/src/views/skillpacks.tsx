// Skill packs — the import wizard, its staged progress bar and the skill-detail overlay.
// Split out of views/SkillsView.tsx so the destination itself stays one screen's worth.
import { IconClose, IconSkill } from '../ui/icons';
import { Md } from '../md/Md';
import { Modal } from '../ui/Modal';
import { nm as nmBridge } from '../bridge/nm';
import { type SkillPackRow, type SkillRow } from '../bridge/rows-content';
import { useState } from 'react';

// Imported bindings lose control-flow narrowing inside closures, so re-bind (same as App.tsx).
const nm = nmBridge;

// Live import tracker for a pack the Curator is cloning/parsing — driven by the
// SYNCED pack row (status/step/progress/error), so it's team-visible + offline-
// correct. Stages map from `progress`; a failed import offers a Retry.
export const IMPORT_STAGES = ['Clone', 'Scan', 'Save', 'Ready'] as const;

export function SkillPackProgress({ p }: { p: SkillPackRow }) {
  const err = p.status === 'error';
  // progress thresholds mirror the host: <45 clone · <80 scan · <100 save · done
  const stage = p.progress >= 100 || p.status === 'ready' ? 3 : p.progress >= 80 ? 2 : p.progress >= 45 ? 1 : 0;
  const pct = err ? 100 : Math.max(6, Math.min(100, p.progress || 6));
  return (
    <div className={`packprog${err ? ' err' : ''}`}>
      <div className="packsteps">
        {IMPORT_STAGES.map((label, i) => {
          const cls = err ? (i === stage ? ' fail' : i < stage ? ' done' : '') : i < stage ? ' done' : i === stage ? ' active' : '';
          return (
            <div key={label} className={`packstep${cls}`}>
              <span className="packdot">{err && i === stage ? '✕' : i < stage ? '✓' : i + 1}</span>
              <span className="packsteplbl">{label}</span>
            </div>
          );
        })}
      </div>
      <div className="packprogbar"><div className="packprogfill" style={{ width: `${pct}%` }} /></div>
      <div className="packprogfoot">
        <span className="packprogstep">{err ? p.error || 'Import failed' : p.step || 'Queued…'}</span>
        {err && <button className="btn sm" onClick={() => void nm?.skillpackRetry(p.id)}>Retry</button>}
      </div>
    </div>
  );
}

// Add a skill pack by GitHub URL — kicks off a Curator import (the host clones +
// parses + commits). Closing the modal doesn't cancel it; progress shows on the
// pack row in the list. file:// is host-only (the e2e fixture), so the UI asks
// for GitHub specifically.
export function AddPackModal({ channelSlug, onClose }: { channelSlug: string; onClose: () => void }) {
  const [url, setUrl] = useState('');
  const [ref, setRef] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const valid = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(\.git)?\/?$/.test(url.trim());
  const submit = async () => {
    if (!nm || !valid || busy) return;
    setBusy(true); setErr('');
    try {
      await nm.skillpackAdd({ channelSlug, url: url.trim(), ref: ref.trim() || undefined });
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message.replace(/^Error invoking remote method.*?: Error: /, '').slice(0, 160) : 'import failed');
      setBusy(false);
    }
  };
  return (
    <Modal title="Add a skill pack" onClose={onClose}>
      <p className="modalhint">Paste a public GitHub repo of <code>SKILL.md</code> skills — the Curator agent clones it, scans for skills, and imports them. Progress shows live on the pack, and the import keeps running if you close this.</p>
      <div className="fld">
        <label>GitHub repository</label>
        <input autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/owner/repo" onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }} />
      </div>
      <div className="fld">
        <label>Branch or tag — optional</label>
        <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="main" onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }} />
      </div>
      {err && <div className="acterr" style={{ marginTop: 8 }}>{err}</div>}
      <button className="btn primary" disabled={!valid || busy} onClick={() => void submit()}>{busy ? 'Starting import…' : 'Import pack'}</button>
    </Modal>
  );
}

// A skill opens in a roomy overlay panel (not an inline slide-down) — full
// procedure rendered as markdown, with promote/retire actions in the footer.
export function SkillOverlay({ skill, packName, authorLabel, channelSlug, onClose }: { skill: SkillRow; packName?: string | null; authorLabel: string; channelSlug: string; onClose: () => void }) {
  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="skillpanel">
        <div className="skillpanelhead">
          <span className="skillpanelicon"><IconSkill s={17} /></span>
          <div className="skillpaneltitle">
            <div className="skillpanelname">{skill.name}</div>
            <div className="skillpanelmeta">
              {skill.status === 'draft' && <span className="scopechip draft">proposed</span>}
              {packName ? <span className="verchip">{packName}</span> : <span className={`scopechip ${skill.scope}`}>{skill.scope === 'global' ? 'global' : `#${skill.channel_slug ?? channelSlug}`}</span>}
              {skill.version > 1 && <span className="verchip">v{skill.version}</span>}
              <span className="skillpanelby">{authorLabel}</span>
            </div>
          </div>
          <button className="iconbtn" title="close" onClick={onClose}><IconClose /></button>
        </div>
        {skill.description && <div className="skillpaneldesc">{skill.description}</div>}
        <div className="skillpanelbody"><Md text={skill.body} /></div>
        <div className="skillpanelfoot">
          {skill.status === 'draft' ? (
            <>
              <button className="btn primary" onClick={() => { void nm?.skillPromote(skill.id); onClose(); }}>Promote to active</button>
              <button className="btn danger" onClick={() => { void nm?.skillDeprecate(skill.id); onClose(); }}>Discard</button>
            </>
          ) : (
            <button className="btn danger" onClick={() => { void nm?.skillDeprecate(skill.id); onClose(); }}>Retire skill</button>
          )}
        </div>
      </div>
    </div>
  );
}
