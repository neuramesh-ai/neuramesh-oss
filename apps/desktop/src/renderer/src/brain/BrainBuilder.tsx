// The brain builder — pick a model per role and save it as a custom pack.
// Split out of brain/brain.tsx.
import { BRAIN_PROVIDERS, ROLE_DOT } from './providers';
import { MODEL_GROUPS } from '../lib/modelcatalog';
import { Modal } from '../ui/Modal';
import { PACK_PREVIEW_ROLES, PACK_SUPPORT_ROLES, missingProvidersForRoles, requiredProvidersForRoles, type AgentRole, type CustomModelPack, type Provider } from '@neuramesh/shared';
import { Select } from '../ui/Select';
import { cleanCmdErr } from '../lib/text';
import { modelLabel } from '../lib/models';
import { nm as nmBridge } from '../bridge/nm';
import { useEffect, useMemo, useState } from 'react';

// Imported bindings lose control-flow narrowing inside closures, so re-bind (same as App.tsx).
const nm = nmBridge;

// Custom brain builder — create or edit a user-authored role→model map (docs/10 §14).
// Save always works; "Save & activate" is gated on the providers the PICKS need (derived
// from the models, never hand-maintained). worker follows developer automatically.
export function BrainBuilder({ initial, seedRoles, enabled, onDone, onClose }: {
  initial: CustomModelPack | null;
  seedRoles: Record<AgentRole, string>;
  enabled: Provider[];
  onDone: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [roles, setRoles] = useState<Record<AgentRole, string>>({ ...seedRoles, ...(initial?.roles ?? {}) });
  const [busy, setBusy] = useState<'save' | 'activate' | 'delete' | null>(null);
  const [err, setErr] = useState('');
  const [delArm, setDelArm] = useState(false);
  const setRole = (r: AgentRole, m: string) => setRoles((prev) => ({ ...prev, [r]: m, ...(r === 'developer' ? { worker: m } : {}) }));
  const missing = missingProvidersForRoles(roles, enabled);
  const provName = (p: Provider) => BRAIN_PROVIDERS.find((b) => b.id === p)?.name ?? p;
  const needProviders = requiredProvidersForRoles(roles).map(provName).join(' + ');
  // the current catalog, grouped by provider — plus any legacy id an old brain still holds
  const modelOpts = useMemo(() => {
    const base = MODEL_GROUPS.flatMap((g) => g.models.map((m) => ({ value: m, label: modelLabel(m), group: g.provider })));
    const known = new Set(base.map((o) => o.value));
    const extras = [...new Set(Object.values(roles))].filter((m) => !known.has(m)).map((m) => ({ value: m, label: modelLabel(m), group: 'Legacy' }));
    return [...base, ...extras];
  }, [roles]);
  const save = async (activate: boolean) => {
    if (!nm || busy || !name.trim()) return;
    setBusy(activate ? 'activate' : 'save'); setErr('');
    try {
      const r = await nm.modelPackSave({ ...(initial ? { packId: initial.id } : {}), name: name.trim(), roles: { ...roles, worker: roles.developer } });
      if (activate) await nm.applyPack(r.packId);
      onDone();
    } catch (e) { setErr(cleanCmdErr(e)); setBusy(null); }
  };
  const doDelete = async () => {
    if (!nm || busy || !initial) return;
    setBusy('delete'); setErr('');
    try { await nm.modelPackDelete(initial.id); onDone(); } // deleting the active brain resets the workspace to Manual server-side
    catch (e) { setErr(cleanCmdErr(e)); setBusy(null); setDelArm(false); }
  };
  return (
    <Modal
      title={initial ? `Edit ${initial.name}` : 'New custom brain'}
      subtitle={initial ? 'Rename or reseat any role — apply again to re-point the team.' : 'A model per role, workspace-wide. Starts from your active brain — change any seat.'}
      onClose={onClose}
      footer={
        <>
          {initial && (
            <button className="btn danger sm" disabled={busy !== null} onClick={() => (delArm ? void doDelete() : setDelArm(true))}>
              {busy === 'delete' ? 'deleting…' : delArm ? 'Really delete?' : 'Delete'}
            </button>
          )}
          <span style={{ flex: 1 }} />
          <button className="btn sm" disabled={busy !== null} onClick={onClose}>Cancel</button>
          <button className="btn sm" disabled={busy !== null || !name.trim()} onClick={() => void save(false)}>{busy === 'save' ? 'saving…' : 'Save'}</button>
          <button
            className="btn primary sm"
            disabled={busy !== null || !name.trim() || missing.length > 0}
            title={missing.length ? `connect ${missing.map(provName).join(' + ')} first` : undefined}
            onClick={() => void save(true)}
          >
            {busy === 'activate' ? 'activating…' : 'Save & activate'}
          </button>
        </>
      }
    >
      <div className="fld"><label>Name</label>
        <input value={name} maxLength={40} autoFocus placeholder='e.g. "Weekend budget"' onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="bldroles">
        {[...PACK_PREVIEW_ROLES, ...PACK_SUPPORT_ROLES].map((role) => (
          <div key={role}>
            <div className="bldrow">
              <span className="bldrole"><span className="roledot" style={{ background: ROLE_DOT[role] }} />{role}</span>
              <Select value={roles[role]!} width="100%" options={modelOpts} onChange={(m) => setRole(role, m)} />
            </div>
            {role === 'developer' && <div className="bldsub">worker (legacy alias) follows developer</div>}
          </div>
        ))}
      </div>
      <div className="bldneeds">
        {missing.length === 0
          ? <>These picks need <b>{needProviders}</b> — <span className="ok">connected ✓</span></>
          : <>These picks need <b>{needProviders}</b> — <span className="miss">{missing.map(provName).join(' + ')} not connected</span>. Save works now; activate after connecting.</>}
      </div>
      {err && <div className="bldneeds err">{err}</div>}
    </Modal>
  );
}

// Brain pill — the workspace's team brain on the .cfoot row, between the project and threads
// chips (docs/10 §14). The popup is a split pane: every brain on the left (curated packs, then
// your custom brains, then "New custom brain"), the selected brain's full role roster + provider
// gate + one Apply on the right — browsing rosters never scrolls or reflows the popup. Workspace-
// scoped, unlike its per-channel neighbours: the same pill in every room. Applying re-points
// pack-managed agents only; hand-pinned agents stay (same contract as Settings → Brains).
// `project` present = the chip edits THAT PROJECT's brain override (docs/10) rather than
// the workspace default: the workspace pack is materialized into agents.model, while a
// project pack is resolved per run by the daemon. Absent = the classic workspace picker.
/** Escape unwinds the brain popup one layer at a time — the model list first, then the popup. */
export function BrainPopEsc({ onEsc }: { onEsc: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onEsc(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onEsc]);
  return null;
}
