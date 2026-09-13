// The Skills destination — the workspace's skill packs, their import progress and the
// pack-detail overlay. Extracted from App.tsx (track A2); bodies unchanged.
import { DEV_USER, selfInitial, selfLabel } from '../lib/self';
import { IconChevron, IconPack, IconSearch, IconTrash } from '../ui/icons';


import { Select } from '../ui/Select';
import { Switch } from '../ui/Switch';
import { nm as nmBridge } from '../bridge/nm';
import { type AgentRow, type MemberRow } from '../bridge/rows-crew';
import { type MessageRow } from '../bridge/rows-rooms';
import { type SkillPackRow, type SkillRow } from '../bridge/rows-content';
import { useState } from 'react';
import { AddPackModal, SkillOverlay, SkillPackProgress } from './skillpacks';

// Imported bindings lose control-flow narrowing inside closures, so re-bind (same as App.tsx).
const nm = nmBridge;

export function authorLabel(
  m: MessageRow,
  agents: AgentRow[],
  members: MemberRow[],
  selfId?: string | null,
  selfEmail?: string | null,
): { name: string; initial: string; agent: boolean; role?: string; self?: boolean } {
  if (m.author_kind === 'agent') {
    const ag = agents.find((a) => a.id === m.author_id);
    const name = ag?.name ?? 'agent';
    return { name, initial: name[0]?.toUpperCase() ?? 'A', agent: true, role: ag?.role };
  }
  if (selfId && m.author_id === selfId) {
    // a display name the user has set wins; otherwise the prettified Clerk email
    const name = selfLabel(members.find((x) => x.user_id === selfId)?.display_name, selfEmail);
    return { name: `${name} (you)`, initial: selfInitial(selfEmail, name[0]?.toUpperCase() ?? 'Y'), agent: false, self: true };
  }
  const member = members.find((x) => x.user_id === m.author_id);
  if (member?.display_name) return { name: member.display_name, initial: member.display_name[0]!.toUpperCase(), agent: false };
  if (m.author_id === DEV_USER) return { name: 'george', initial: 'G', agent: false };
  return { name: 'member', initial: 'M', agent: false };
}

export function SkillsSkeleton() {
  // a few shimmer rows while the first sync streams skills/packs in — avoids the
  // "No skills yet" flash before the data arrives
  return (
    <div className="skelwrap" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="packsec skel">
          <div className="packhead">
            <span className="skel-dot" />
            <span className="skel-bar" style={{ width: 120 }} />
            <span className="skel-bar" style={{ width: 56, opacity: 0.6 }} />
            <span className="skel-bar" style={{ flex: 1, maxWidth: 320, opacity: 0.4 }} />
            <span className="skel-pill" />
          </div>
        </div>
      ))}
    </div>
  );
}

// `q` comes from the surface's scope bar when there is one, so the destination has ONE search
// field rather than a filter row with its own box sitting above the view's box. Left internal
// when unset — the composer-side callers still own their search.
export function SkillsView({ skills, packs, channelSlug, agents, members, selfId, selfEmail, loading, q: extQ }: { skills: SkillRow[]; packs: SkillPackRow[]; channelSlug: string; agents: AgentRow[]; members: MemberRow[]; selfId?: string | null; selfEmail?: string | null; loading?: boolean; q?: string }) {
  const [ownQ, setOwnQ] = useState('');
  const q = extQ ?? ownQ;
  const setQ = setOwnQ;
  const [openSkill, setOpenSkill] = useState<SkillRow | null>(null); // detail overlay
  const [openPacks, setOpenPacks] = useState<Set<string>>(new Set()); // expanded packs
  const [composing, setComposing] = useState(false);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [scope, setScope] = useState<'channel' | 'global'>('channel');
  const [body, setBody] = useState('');
  const [err, setErr] = useState('');
  const [addOpen, setAddOpen] = useState(false);

  const author = (k: string, id: string) =>
    k === 'agent' ? (agents.find((a) => a.id === id)?.name ?? 'agent') : (members.find((m) => m.user_id === id)?.display_name ?? (id === selfId ? selfEmail?.split('@')[0] ?? 'you' : 'member'));
  const matches = (s: SkillRow) => !q || `${s.name} ${s.description} ${s.body}`.toLowerCase().includes(q.toLowerCase());
  const filtered = skills.filter(matches);
  // a skill's pack must be present in the synced packs list to group under it;
  // otherwise (pack row not yet synced) it falls into "Other" so it never vanishes
  const knownPacks = new Set(packs.map((p) => p.id));
  const byPack = new Map<string, SkillRow[]>();
  const others: SkillRow[] = [];
  for (const s of filtered) {
    if (s.pack_id && knownPacks.has(s.pack_id)) { const arr = byPack.get(s.pack_id) ?? []; arr.push(s); byPack.set(s.pack_id, arr); }
    else others.push(s);
  }
  const orphanCount = filtered.filter((s) => s.pack_id && !knownPacks.has(s.pack_id)).length;

  const create = async () => {
    if (!nm || !name.trim() || !desc.trim() || !body.trim()) return;
    setErr('');
    try {
      await nm.skillCreate({ channelSlug: scope === 'channel' ? channelSlug : undefined, name: name.trim(), description: desc.trim(), scope, body });
      setComposing(false); setName(''); setDesc(''); setBody(''); setScope('channel');
    } catch (e) {
      setErr(e instanceof Error ? e.message.replace(/^Error invoking remote method.*?: Error: /, '').slice(0, 140) : 'create failed');
    }
  };

  // one skill card — a single clickable row; the full procedure opens in an overlay
  const card = (s: SkillRow, packOff: boolean) => (
    <div key={s.id} className={`skillcard${s.status === 'draft' ? ' draft' : ''}${packOff || !s.enabled ? ' off' : ''}`}>
      <div className="skillhead" onClick={() => setOpenSkill(s)}>
        <span className="skillname">{s.name}</span>
        {s.status === 'draft' && <span className="scopechip draft">proposed</span>}
        {!s.pack_id && s.status !== 'draft' && <span className={`scopechip ${s.scope}`}>{s.scope === 'global' ? 'global' : `#${s.channel_slug ?? channelSlug}`}</span>}
        <span className="skilldesc">{s.description}</span>
        <span className="skillmeta">{author(s.author_kind, s.author_id)}{s.version > 1 ? ` · v${s.version}` : ''}</span>
        {s.status !== 'draft' && <Switch sm on={!!s.enabled} onToggle={() => void nm?.skillSetEnabled(s.id, !s.enabled)} />}
      </div>
    </div>
  );

  return (
    <div className="libwrap">
      <div className="skillbar">
        {extQ === undefined && (
          <div className="skillsearch">
            <IconSearch s={14} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="search skills…" />
          </div>
        )}
        {extQ !== undefined && <span style={{ flex: 1 }} />}
        <button className="btn iconlabel" onClick={() => setAddOpen(true)}><IconPack s={14} /> Add skill pack</button>
        <button className="btn primary" onClick={() => setComposing((c) => !c)}>{composing ? 'Cancel' : '+ New skill'}</button>
      </div>
      {composing && (
        <div className="skillform">
          <div className="srow">
            <input className="kinput" value={name} onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))} placeholder="skill-name (kebab-case)" />
            <Select value={scope} width={170} options={[{ value: 'channel', label: `#${channelSlug} (channel)` }, { value: 'global', label: 'global (workspace)' }]} onChange={(v) => setScope(v as 'channel' | 'global')} />
          </div>
          <input className="kinput" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="one-line description — when should an agent use this?" maxLength={300} />
          <textarea className="skillbody" value={body} onChange={(e) => setBody(e.target.value)} placeholder="The procedure (markdown): steps, snippets, gotchas…" rows={10} />
          {err && <div className="acterr">{err}</div>}
          <div><button className="btn primary" disabled={!name.trim() || !desc.trim() || !body.trim()} onClick={() => void create()}>Create skill</button></div>
        </div>
      )}

      {loading && !packs.length && !skills.length && <SkillsSkeleton />}

      {/* skill packs — collapsed to their details by default; the chevron reveals
          the skills. Toggle the whole pack, or any one skill; off = greyed + hidden */}
      {packs.map((p) => {
        const ps = (byPack.get(p.id) ?? []).sort((a, b) => a.name.localeCompare(b.name));
        const off = !p.enabled;
        const expanded = openPacks.has(p.id) || !!q; // an active search forces packs open
        const togglePack = () => setOpenPacks((cur) => { const n = new Set(cur); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n; });
        return (
          <div key={p.id} className="packsec" data-off={off ? 'true' : 'false'}>
            <div className={`packhead${p.status === 'ready' ? ' clickable' : ''}`} onClick={p.status === 'ready' ? togglePack : undefined}>
              {p.status === 'ready' ? <span className={`packchev${expanded ? ' open' : ''}`}><IconChevron s={16} /></span> : <span className="packchev ghost" />}
              <span className="packicon"><IconPack s={15} /></span>
              <span className="packname">{p.name}</span>
              {p.origin === 'bundled' && <span className="verchip">bundled</span>}
              {p.origin === 'imported' && p.status === 'ready' && <span className="verchip">imported</span>}
              {p.version && p.status === 'ready' && <span className="verchip">{p.version.replace(/^bundled@/, '').slice(0, 10)}</span>}
              {p.status === 'importing' && <span className="packstat importing">importing…</span>}
              {p.status === 'error' && <span className="packstat error" title={p.error}>import failed</span>}
              <span className="packdesc">{p.description}</span>
              {p.status === 'ready' && <span className="packcount">{ps.length}</span>}
              {p.status === 'ready' && <Switch on={!!p.enabled} onToggle={() => void nm?.skillpackSetEnabled(p.id, !p.enabled)} title={p.enabled ? 'pack on — its skills are discoverable' : 'pack off — its skills are hidden from agents'} />}
              <button className="packgear" title={p.status === 'ready' ? 'remove this pack' : 'cancel + remove this import'} onClick={(e) => { e.stopPropagation(); void nm?.skillpackRemove(p.id); }}><IconTrash s={15} /></button>
            </div>
            {p.status !== 'ready' ? (
              <div className="packbody"><SkillPackProgress p={p} /></div>
            ) : expanded && ps.length > 0 ? (
              <div className="packbody">{ps.map((s) => card(s, off))}</div>
            ) : expanded ? (
              <div className="packbody"><div className="packempty">{q ? 'no skills match your search' : 'no skills in this pack'}</div></div>
            ) : null}
          </div>
        );
      })}

      {/* a pack's skills synced but the pack row didn't — surfaces a sync gap
          (e.g. skill_packs missing from the PowerSync sync rules) instead of
          silently hiding the skills */}
      {orphanCount > 0 && (
        <div className="packwarn">⚠ {orphanCount} skill{orphanCount === 1 ? '' : 's'} belong to packs that haven’t synced yet — they’re listed below, but their pack on/off controls won’t appear until the <code>skill_packs</code> sync rule is live.</div>
      )}
      {/* standalone + proposed skills */}
      {(packs.length > 0 || orphanCount > 0) && others.length > 0 && <div className="packlabel">Other skills</div>}
      {others.map((s) => card(s, false))}
      {!loading && !packs.length && !others.length && !composing && (
        <div className="empty">No skills yet — capture a reusable procedure, or add a skill pack so agents reuse curated playbooks.</div>
      )}

      {addOpen && <AddPackModal channelSlug={channelSlug} onClose={() => setAddOpen(false)} />}
      {openSkill && (
        <SkillOverlay
          skill={openSkill}
          packName={openSkill.pack_id ? packs.find((p) => p.id === openSkill.pack_id)?.name ?? null : null}
          authorLabel={`${author(openSkill.author_kind, openSkill.author_id)}${openSkill.version > 1 ? ` · v${openSkill.version}` : ''}`}
          channelSlug={channelSlug}
          onClose={() => setOpenSkill(null)}
        />
      )}
    </div>
  );
}
