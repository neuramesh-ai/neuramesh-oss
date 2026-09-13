// Create agent — the hire form, and the room picker that scopes what it will see.
// Extracted from App.tsx (track A2).
import { DESC_HINT } from '../views/AgentDetails';
import { Modal } from '../ui/Modal';
import { anchorPoint } from '../ui/anchor';
import { RUNTIME_OPTS } from '../lib/runtimes';
import { RoleSelect, Select } from '../ui/Select';
import { modelLabel } from '../lib/models';
import { nm as nmBridge } from '../bridge/nm';
import { type ChannelRow } from '../bridge/rows-rooms';

import { type WorkspaceProjectRow } from '../bridge/rows-board';
import { useEffect, useRef, useState } from 'react';

// Imported bindings lose control-flow narrowing inside closures, so re-bind (same as App.tsx).
const nm = nmBridge;

// Searchable multi-select: type to filter, click to toggle (✓), selected items
// show as removable chips up top.
export function ChannelPicker({ channels, picked, onChange, projects = [] }: { channels: ChannelRow[]; picked: Set<string>; onChange: (s: Set<string>) => void; projects?: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  // `picked` holds channel IDS — slugs repeat across projects, so the id is the only safe key.
  const projName = (pid: string | null) => projects.find((p) => p.id === pid)?.name;
  const chanById = (id: string) => channels.find((c) => c.id === id);
  const slugOf = (id: string) => chanById(id)?.slug ?? id;
  // a slug that repeats across projects (two #dev rooms) is ambiguous — disambiguate it by project.
  const slugCounts = channels.reduce((m, c) => m.set(c.slug, (m.get(c.slug) ?? 0) + 1), new Map<string, number>());
  const ambiguous = (c: ChannelRow) => (slugCounts.get(c.slug) ?? 0) > 1;
  const matches = channels.filter((c) => `${c.slug} ${projName(c.project_id) ?? ''}`.toLowerCase().includes(q.toLowerCase()));
  const toggle = (id: string) => { const n = new Set(picked); n.has(id) ? n.delete(id) : n.add(id); onChange(n); };
  // group the dropdown under project headers when the workspace spans more than one project;
  // within a project slugs are unique, so each room shows as a plain #slug under its project.
  const grouped = projects.length > 0 && new Set(channels.map((c) => c.project_id)).size > 1;
  const groups = [...new Set([...projects.map((p) => p.id), ...matches.map((c) => c.project_id)])]
    .map((pid) => ({ pid, name: projName(pid) ?? 'Other', rooms: matches.filter((c) => c.project_id === pid) }))
    .filter((g) => g.rooms.length);
  return (
    <div className="msel" ref={ref}>
      <div className="mselbox" onClick={() => setOpen(true)}>
        {[...picked].map((id) => { const c = chanById(id); return (
          <span key={id} className="mseltag">#{c?.slug ?? slugOf(id)}{c && ambiguous(c) && projName(c.project_id) ? <span className="mseltagproj">{projName(c.project_id)}</span> : null}<button type="button" onClick={(e) => { e.stopPropagation(); toggle(id); }} aria-label={`remove ${slugOf(id)}`}>×</button></span>
        ); })}
        <input className="mselinput" value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
          placeholder={picked.size ? 'add another…' : 'search channels…'} />
      </div>
      {open && (
        <div className="mseldrop">
          {!matches.length && <div className="mselempty">no matching channels</div>}
          {grouped
            ? groups.map((g) => (
                <div key={g.pid ?? 'none'} className="mselgroup">
                  <div className="mselgrouphd">{g.name}</div>
                  {g.rooms.map((c) => (
                    <div key={c.id} className={`mselopt${picked.has(c.id) ? ' on' : ''}`} onClick={() => toggle(c.id)}>
                      <span className="mselcheck">{picked.has(c.id) ? '✓' : ''}</span> #{c.slug}
                    </div>
                  ))}
                </div>
              ))
            : matches.map((c) => (
                <div key={c.id} className={`mselopt${picked.has(c.id) ? ' on' : ''}`} onClick={() => toggle(c.id)}>
                  <span className="mselcheck">{picked.has(c.id) ? '✓' : ''}</span> #{c.slug}
                </div>
              ))}
        </div>
      )}
    </div>
  );
}

// prefillName/prefillChannelId come from the add-agents overlay: searching for a name nobody
// has, then hiring from the empty state, carries the query and the room you were staffing.
export function CreateAgent({ channels, projects, prefillName, prefillChannelId, onDone, onClose }: { channels: ChannelRow[]; projects: WorkspaceProjectRow[]; prefillName?: string; prefillChannelId?: string | null; onDone: () => void; onClose: () => void }) {
  const [name, setName] = useState(prefillName ?? '');
  const [role, setRole] = useState('developer');
  const [runtime, setRuntime] = useState('claude-code');
  const [model, setModel] = useState('claude-opus-4-8');
  // The two strings (0110). Creation used to ask five WIRING questions — name, role, runtime,
  // model, rooms — and nothing about the job. The role is the skeleton (it decides FSM
  // permissions and which model the pack seats); these are what make two developers different
  // people, and the description is what lets the orchestrator tell them apart at staffing time.
  const [description, setDescription] = useState('');
  const [instructions, setInstructions] = useState('');
  // a new agent defaults to #general only (workspace-scoped agent, channel-scoped membership);
  // the human picks any other rooms here, or adds it to a channel later via the live-panel "+".
  // hired FROM a room (the add-agents overlay) → that room is the default membership; opened
  // cold from the Agents page → #general, as before.
  const generalIds = (cs: ChannelRow[]) => (prefillChannelId ? [prefillChannelId] : cs.filter((c) => c.slug === 'general').map((c) => c.id));
  const [picked, setPicked] = useState<Set<string>>(new Set(generalIds(channels)));
  // channels may sync in AFTER the modal mounts (initializer ran once on []), so seed once on arrival
  const seededChannels = useRef(false);
  useEffect(() => {
    if (!seededChannels.current && channels.length) { seededChannels.current = true; setPicked(new Set(generalIds(channels))); }
  }, [channels]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState('');

  const submit = async () => {
    if (!nm || busy) return;
    setBusy(true);
    setErr('');
    try {
      // provision the runtime's coding CLI up front (installs it if missing)
      if (runtime !== 'claude-code') {
        setStep(`preparing the ${RUNTIME_OPTS[runtime]?.label ?? runtime} CLI…`);
        await nm.ensureRuntimeCli(runtime);
      }
      setStep('creating…');
      await nm.registerAgent({
        name: name.trim().toLowerCase(),
        role,
        model,
        runtime,
        description: description.trim(),
        brief: instructions.trim(),
        channels: [...picked],
      });
      onDone();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message.replace(/^Error invoking remote method.*?: Error: /, '').slice(0, 200) : 'failed');
    } finally {
      setBusy(false);
      setStep('');
    }
  };

  return (
    <Modal
      title="Create agent"
      onClose={onClose}
      // a FORM, so it keeps the measure and merely pivots out of the row that opened it — and it
      // drops the veil, like every other surface that is a step rather than a decision (docs/33 §2)
      anchored
      origin={anchorPoint()}
    >
      <div className="fld"><label>Name *</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. patch" autoFocus /></div>
      <div className="fld"><label>Base role — what it is allowed to do on the board</label>
        <RoleSelect value={role} onChange={setRole} /></div>
      <div className="fld">
        <label>Description — what it does and when to route work here</label>
        <textarea className="agtxt agdesc" value={description} maxLength={280} aria-label="Agent description"
          placeholder={`e.g. ${DESC_HINT[role] ?? 'What this agent does. Route <kind of work> here.'}`}
          onChange={(e) => setDescription(e.target.value)} />
        <p className="modalhint">Read by the orchestrator when it staffs a task — without it, this agent is just another {role}. <b>{description.length} / 280</b></p>
      </div>
      <div className="fld">
        <label>Instructions — how this one works <span className="fldopt">optional</span></label>
        <textarea className="agtxt aginstr" value={instructions} maxLength={2000} aria-label="Agent instructions"
          placeholder="e.g. Always cite the source for a factual claim. Never present an estimate as measured data."
          onChange={(e) => setInstructions(e.target.value)} />
        <p className="modalhint">Rides <b>every</b> turn: board tasks, thread replies, and any subagent spawned onto this seat. <b>{instructions.length} / 2000</b></p>
      </div>
      <div className="fld"><label>Runtime</label>
        <Select value={runtime} width="100%" options={Object.entries(RUNTIME_OPTS).map(([id, o]) => ({ value: id, label: `${o.label} (${o.provider})` }))} onChange={(rt) => { setRuntime(rt); setModel(RUNTIME_OPTS[rt]?.models[0] ?? model); }} /></div>
      <div className="fld"><label>Model</label>
        <Select value={model} width="100%" options={(RUNTIME_OPTS[runtime]?.models ?? [model]).map((m) => ({ value: m, label: modelLabel(m) }))} onChange={setModel} /></div>
      <div className="fld"><label>Channels (fan-out scope)</label>
        <ChannelPicker channels={channels} picked={picked} onChange={setPicked} projects={projects} /></div>
      <div className="loginerr">{err}</div>
      <button className="btn primary" disabled={busy || !name.trim() || !picked.size} onClick={() => void submit()}>
        {busy ? (step || 'creating…') : 'Create agent'}
      </button>
    </Modal>
  );
}
