// The brain (docs/10) — which model and provider an agent's turn runs on: the provider
// catalogue, the draft a builder keeps between mounts, the builder itself, and the chip
// that opens it. Extracted from App.tsx (track A2).
import { AgentAvatar } from '../components/AgentAvatar';
import { CURRENT_MODELS, CUSTOM_PACK_ID, PACKS, PACK_ORDER, PACK_PREVIEW_ROLES, brainCast, brainOverrideCount, isPackActivatable, missingProvidersForRoles, packRequiredProviders, parseBrainOverride, resolvePackName, resolvePackRoles, rolesActivatable, type AgentRole, type BrainOverride, type CustomModelPack, type Provider } from '@neuramesh/shared';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { IconBrain } from '../ui/icons';





import { modelLabel, providerIdForModel } from '../lib/models';
import { nm as nmBridge } from '../bridge/nm';
import { type CredRow } from '../bridge/rows-infra';
import { BRAIN_PROVIDERS, PROVIDER_RUNTIME, ProviderLogo, ROLE_DOT } from './providers';
import { readBrainDraft, writeBrainDraft } from './draft';
import { BrainBuilder, BrainPopEsc } from './BrainBuilder';

// Imported bindings lose control-flow narrowing inside closures, so re-bind (same as App.tsx).
const nm = nmBridge;

// `thread` present = the pill also carries THIS CONVERSATION's brain (docs/10 §15): the popup
// opens on a Roles view (who holds each seat and what each will run), the packs picker moves one
// tab behind, and a scope control says which blast radius an edit lands in. The pill itself goes
// warm and counts itself, so a non-default brain is never silent.
export function BrainChip({ onConnect, project, onSetProjectPack, thread, castAgents, onSetThreadBrain }: {
  onConnect: (provider: Provider) => void;
  project?: { id: string; name: string; pack: string | null } | null;
  onSetProjectPack?: (packId: string) => Promise<void>;
  thread?: { id: string; label: string; override: BrainOverride | null } | null;
  castAgents?: ReadonlyArray<{ name: string; role: string; model: string; model_source?: string | null; emoji?: string | null }>;
  onSetThreadBrain?: (override: BrainOverride | null) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<string>(CUSTOM_PACK_ID);
  const [custom, setCustom] = useState<CustomModelPack[]>([]);
  const [sel, setSel] = useState<string>(PACK_ORDER[0]!);
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState<number | null>(null); // last apply's re-pointed count
  const [builder, setBuilder] = useState<{ edit: CustomModelPack | null } | null>(null);
  // the chip fetches its own credentials — the root's creds state loads lazily (settings/agents
  // views), and a locked-looking picker on a fully-connected workspace would be a lie
  const [creds, setCreds] = useState<CredRow[]>([]);
  const enabled = useMemo(() => [...new Set(creds.filter((c) => c.scope === 'workspace').map((c) => c.provider))] as Provider[], [creds]);
  const refresh = useCallback(() => {
    void nm?.workspaceSettings().then((s) => setActive(s.activeModelPack ?? CUSTOM_PACK_ID)).catch(() => {});
    void nm?.modelPacks().then((r) => setCustom((r.packs ?? []) as CustomModelPack[])).catch(() => {});
    void nm?.credentials().then((r: { credentials: CredRow[] }) => setCreds(r.credentials ?? [])).catch(() => {});
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  // Settings → Brains mutates the same state — both surfaces listen for the broadcast
  useEffect(() => {
    window.addEventListener('nm:brains-changed', refresh);
    return () => window.removeEventListener('nm:brains-changed', refresh);
  }, [refresh]);
  // follow the active brain until the user browses (fetches may land after first open)
  const picked = useRef(false);
  useEffect(() => {
    if (open && !picked.current) setSel(resolvePackRoles(active, custom) ? active : PACK_ORDER[0]!);
  }, [open, active, custom]);
  // ── the Roles view (docs/10 §15) ──
  // `draft` is the un-applied override: nothing moves until Apply, which is the whole contract of
  // the scope control — you are told the blast radius in a sentence before anything happens.
  const [view, setView] = useState<'roles' | 'packs'>('packs');
  const [scope, setScope] = useState<'thread' | 'project'>('thread');
  const [draft, setDraft] = useState<BrainOverride | null>(null);
  const [picking, setPicking] = useState<AgentRole | null>(null);
  const castInput = useMemo(() => ({
    agents: (castAgents ?? []).map((a) => ({ name: a.name, role: a.role, model: a.model, modelSource: a.model_source, emoji: a.emoji })),
    projectPack: project?.pack ?? null,
    custom,
  }), [castAgents, project?.pack, custom]);
  const cast = useMemo(() => brainCast({ ...castInput, threadOverride: draft }), [castInput, draft]);
  // the same seats with NO thread override — what each role runs if this conversation says nothing.
  // Picking that model back is a clear, not a change (see pickModel).
  const baseCast = useMemo(() => brainCast(castInput), [castInput]);
  // what the CONVERSATION currently runs, ignoring the un-applied draft — the pill reads this,
  // so it never claims a change the server has not accepted
  const liveCount = brainOverrideCount(thread ? thread.override : readBrainDraft());
  const draftCount = brainOverrideCount(draft);
  const settled = thread ? parseBrainOverride(thread.override) : readBrainDraft();
  const dirty = JSON.stringify(parseBrainOverride(draft) ?? null) !== JSON.stringify(settled ?? null);
  const toggle = () => {
    if (!open) {
      picked.current = false; setApplied(null); refresh();
      setView('roles'); // the front page everywhere: a room send becomes a conversation too
      setScope('thread'); setPicking(null);
      setDraft(thread ? parseBrainOverride(thread.override) : readBrainDraft());
    }
    setOpen((v) => !v);
  };
  // a fresh open on a different conversation must not inherit the last one's draft
  useEffect(() => { if (!open) setDraft(thread ? parseBrainOverride(thread.override) : readBrainDraft()); }, [thread?.id, thread?.override, open]);
  const applyThread = async () => {
    if (busy || !dirty) return;
    setBusy(true);
    try {
      const next = parseBrainOverride(draft);
      // No thread yet (Home, or a room before the first send): the choice is STICKY and the
      // conversation is born with it — the same shape as the composer's Tasks toggle, which is
      // also a per-machine preference carried on the send that births the thread (docs/34).
      if (!thread) writeBrainDraft(next);
      else await onSetThreadBrain?.(next);
      setOpen(false);
    } catch { /* keep the draft on failure — the human can retry or close */ } finally { setBusy(false); }
  };
  const resetThread = async () => {
    if (busy) return;
    // ruling 7: Reset is the WHOLE override. There is no per-role clear, so there are no partial
    // states to reason about — and an emptied override is stored as null, never `{}`.
    setBusy(true);
    try {
      if (!thread) writeBrainDraft(null);
      else await onSetThreadBrain?.(null);
      setDraft(null); setOpen(false);
    } catch { /* keep it */ } finally { setBusy(false); }
  };
  const pickModel = (role: AgentRole, model: string) => {
    setPicking(null);
    setDraft((d) => {
      const next: BrainOverride = { ...(d ?? {}) };
      // choosing what the seat ALREADY runs without an override is a clear, not a change: storing
      // it would leave a permanent "1 changed here" on a conversation that changed nothing
      if (model === baseCast.find((s) => s.role === role)?.model) delete next[role];
      else next[role] = model;
      return parseBrainOverride(next);
    });
  };
  const selPack = ((): { name: string; tagline: string; roles: Record<AgentRole, string>; latency?: Partial<Record<AgentRole, string>>; custom: CustomModelPack | null } | null => {
    const b = PACKS[sel];
    if (b) return { name: b.name, tagline: b.tagline, roles: b.roles, latency: b.latency, custom: null };
    const c = custom.find((p) => p.id === sel);
    return c ? { name: c.name, tagline: 'Custom · yours', roles: c.roles, custom: c } : null;
  })();
  // A PLATFORM PACK NEEDS NOBODY — `packRequiredProviders` encodes that, but this site used the
  // roles-only function and lost the exemption, so the house pack offered "Connect Gemini →" for
  // a brain that needs no connection. Custom packs have no id, so they keep the roles path.
  const missing = !selPack ? [] : selPack.custom
    ? missingProvidersForRoles(selPack.roles, enabled)
    : packRequiredProviders(sel).filter((p) => !enabled.includes(p));
  const provName = (p: Provider) => BRAIN_PROVIDERS.find((b) => b.id === p)?.name ?? p;
  // the project override wins for display when set — that IS what its agents will run
  const effective = project ? (project.pack ?? active) : active;
  const overridden = !!project?.pack;
  const apply = async () => {
    if (!nm || busy || !selPack || sel === effective) return;
    setBusy(true);
    try {
      if (project && onSetProjectPack) {
        await onSetProjectPack(sel); // no re-materialization: the daemon resolves this per run
        setApplied(null);
      } else {
        const r = await nm.applyPack(sel);
        setActive(sel); setApplied(r.applied);
      }
      window.dispatchEvent(new Event('nm:brains-changed'));
    } catch { /* keep the prior brain on failure */ } finally { setBusy(false); }
  };
  // drop back to the workspace default (clears projects.model_pack)
  const inherit = async () => {
    if (!nm || busy || !project || !onSetProjectPack || !project.pack) return;
    setBusy(true);
    try { await onSetProjectPack(''); window.dispatchEvent(new Event('nm:brains-changed')); }
    catch { /* keep the override on failure */ } finally { setBusy(false); }
  };
  return (
    <div className="cchips">
      {/* ONE pill everywhere. A message sent from Home or a room becomes a conversation too, so
          the switcher must not look different depending on where you happen to be standing; and
          an override is stated in WORDS, never by recolouring the control. */}
      <button
        className={`cchip${open ? ' open' : ''}`}
        data-tip={liveCount
          ? `${liveCount} role${liveCount === 1 ? '' : 's'} run a different model here. Click to see the crew.`
          : project
            ? `Team brain for ${project.name}${overridden ? ', a project override' : ', inherited from the workspace'}`
            : 'Team brain: the model each agent role runs'}
        onClick={toggle}
      >
        <IconBrain s={11} />
        <span className="lbl">Brain · {resolvePackName(effective, custom) ?? 'Manual'}</span>
        {/* the pill stops naming only a pack and starts naming PEOPLE: the seated crew, and how
            many of them this conversation moved. `liveCount` reads the SERVER's override, never
            the un-applied draft, so the pill cannot claim a change nothing accepted yet. */}
        {liveCount > 0 && <span className="brainscope">{liveCount} changed here</span>}
        {!liveCount && overridden && <span className="brainscope">project</span>}
        {cast.length > 0 && (
          <span className="brainavs" aria-hidden>
            {cast.slice(0, 3).map((s) => <AgentAvatar key={s.role} name={s.name} size={14} radius={5} />)}
          </span>
        )}
        <span className="car">▾</span>
      </button>
      {open && (
        <>
          {/* Escape and the scrim both unwind ONE layer: the model list closes back to the roles
              list, and only then does the popup close */}
          <BrainPopEsc onEsc={() => (picking ? setPicking(null) : setOpen(false))} />
          <div className="projmenu-scrim" onClick={() => (picking ? setPicking(null) : setOpen(false))} />
          <div className="brainpop">
            {/* ONE popup, TWO tabs, one height. Roles is the front page: who holds each seat here
                and what each will run. Packs is the same picker it always was, a tab away rather
                than behind a link at the bottom of a list. */}
            <div className="brtabbar" role="tablist" aria-label="Brain">
              <button role="tab" aria-selected={view === 'roles'} className={`brtab${view === 'roles' ? ' on' : ''}`} onClick={() => setView('roles')}>
                Roles{cast.length > 0 && <span className="brtabn">{cast.length}</span>}
              </button>
              <button role="tab" aria-selected={view === 'packs'} className={`brtab${view === 'packs' ? ' on' : ''}`} onClick={() => setView('packs')}>Packs</button>
              {liveCount > 0 && <span className="brtabnote">{liveCount} changed here</span>}
            </div>
            <div className="brbody">
            {view === 'roles' && (
              <div className="brroles">
                {/* STRIPPED to the controls (R7, George live): the project headline, the resolver
                    sub-line and the consequence paragraph all left — the prose folded into
                    word-stacks at the compressed width, and the tooltips already carry it. The
                    scope is the head now: two blast radii reading as PLACES. */}
                <div className="brrhead">
                  <div className="brrscope" role="group" aria-label="Where this change lands">
                    <button className={scope === 'thread' ? 'on' : ''} aria-pressed={scope === 'thread'}
                      title={thread
                        ? "Changes ride this conversation's future turns. The project keeps its brain."
                        : 'Applies to the thread your next message starts, and it sticks for the ones after.'}
                      onClick={() => setScope('thread')}>This thread</button>
                    <button className={scope === 'project' ? 'on' : ''} aria-pressed={scope === 'project'} disabled={!project}
                      title="Pick a pack to change every room in this project."
                      onClick={() => { setScope('project'); setView('packs'); }}>Project-wide</button>
                  </div>
                </div>
                {/* The picker TAKES OVER the list; it does not float above it. `.brrrows` scrolls, and
                    an absolutely-positioned child of a scrolling box is clipped BY that box — the
                    picker's top slid under the header (George, 2026-07-31). This is the same answer
                    docs/36 §4.2 settled for the file pane's branch switcher: swapping the body keeps
                    one surface, one scroller and one Escape, and it holds the popup's fixed height. */}
                {picking && (() => {
                  const seat = cast.find((x) => x.role === picking);
                  if (!seat) return null;
                  return (
                    <div className="brrrows" role="menu" aria-label={`Model for ${seat.name}`}>
                      <button className="brpkback" onClick={() => setPicking(null)}>
                        ‹ <span className="brrole">{seat.role}</span> <b>{seat.name}</b>
                      </button>
                      {PROVIDER_RUNTIME.map(([provider, runtime]) => {
                        const p = BRAIN_PROVIDERS.find((b) => b.id === provider)!;
                        const ids = CURRENT_MODELS[runtime];
                        if (!ids.length) return null;
                        const connected = enabled.includes(p.id);
                        return (
                          <Fragment key={p.id}>
                            <div className="brpkgroup">{p.name}</div>
                            {ids.map((id) => (
                              <button key={id} role="menuitem" className={`brpk${id === seat.model ? ' on' : ''}`}
                                disabled={!connected}
                                title={connected ? modelLabel(id) : `${p.name} is not connected. Connect it in Settings first.`}
                                onClick={() => pickModel(seat.role, id)}>
                                {modelLabel(id)}
                                {id === seat.model
                                  ? <span className="tick">✓ current</span>
                                  : !connected ? <span className="meta">no key</span> : null}
                              </button>
                            ))}
                          </Fragment>
                        );
                      })}
                    </div>
                  );
                })()}
                <div className="brrrows" hidden={!!picking}>
                  {cast.length === 0 && <div className="brrempty">No agents are registered to this channel yet.</div>}
                  {cast.map((s, i) => (
                    <div key={s.role} className="brrow" style={{ animationDelay: `${Math.min(i, 7) * 22}ms` }}>
                      <span className="brrole">{s.role}</span>
                      <AgentAvatar name={s.name} size={18} radius={6} />
                      <span className="brwho">
                        <b>{s.name}</b>
                        {/* stated, not coloured: a changed seat says so in words */}
                        {s.pinned ? <span>pinned by you</span> : s.changed ? <span>set for this conversation</span> : null}
                      </span>
                      <button
                        className="brmodel"
                        disabled={s.pinned}
                        aria-expanded={picking === s.role}
                        title={s.pinned
                          ? 'This seat is pinned by hand. A conversation cannot move it.'
                          : thread ? `Switch the model ${s.name} runs in this conversation` : `Switch the model ${s.name} runs. New conversations start here.`}
                        onClick={() => setPicking(picking === s.role ? null : s.role)}
                      >
                        {modelLabel(s.model)} <span className="car">▾</span>
                      </button>
                    </div>
                  ))}
                </div>
                <div className="brrfoot">
                  {/* the span speaks only when it has a STATE to report (R7) — the dirty and
                      changed counts are load-bearing; the resting sentence was the noise */}
                  <span>
                    {dirty
                      ? `${draftCount} change${draftCount === 1 ? '' : 's'} · this thread`
                      : liveCount
                        ? `${liveCount} role${liveCount === 1 ? '' : 's'} set here`
                        : ''}
                  </span>
                  {(liveCount > 0 || draftCount > 0) && (
                    <button className="bpmini" disabled={busy} onClick={() => void resetThread()}
                      title="Clear every role at once. This conversation follows the project brain again.">Reset</button>
                  )}
                  <button className="bpapply" disabled={busy || !dirty} onClick={() => void applyThread()}>
                    {busy ? 'Applying…' : 'Apply'}
                  </button>
                </div>
              </div>
            )}
            {view === 'packs' && (
            <div className="brpackpane">
            <div className="bphead">
              <b>Team brains</b>
              {project && overridden && (
                <button type="button" className="bpinherit" disabled={busy} onClick={() => void inherit()}
                  title="Drop the override. This project follows the workspace brain again.">
                  Use workspace default
                </button>
              )}
            </div>
            <div className="bpbody">
              <div className="bplist">
                <span className="bplbl">Curated</span>
                {PACK_ORDER.map((id) => (
                  <button key={id} className={`bpitem${sel === id ? ' sel' : ''}`} onClick={() => { picked.current = true; setSel(id); setApplied(null); }}>
                    <span className="nm">{PACKS[id]!.name}</span>
                    {effective === id ? <span className="on">✓ Active</span> : !isPackActivatable(id, enabled) ? <span className="lock">locked</span> : null}
                  </button>
                ))}
                {custom.length > 0 && <span className="bplbl">Yours</span>}
                {custom.map((cp) => (
                  <button key={cp.id} className={`bpitem${sel === cp.id ? ' sel' : ''}`} onClick={() => { picked.current = true; setSel(cp.id); setApplied(null); }}>
                    <span className="nm">{cp.name}</span>
                    {effective === cp.id ? <span className="on">✓ Active</span> : !rolesActivatable(cp.roles, enabled) ? <span className="lock">locked</span> : null}
                  </button>
                ))}
                <button className="bpnew" onClick={() => { setOpen(false); setBuilder({ edit: null }); }}>＋ New custom brain</button>
              </div>
              {selPack && (
                <div className="bpdetail">
                  <div className="bpdtop">
                    <div className="bpdname">{selPack.name}</div>
                    {effective === sel ? <span className="bpbadge on">✓ Active</span> : <span className="bpbadge">{selPack.custom ? 'Custom' : 'Curated'}</span>}
                  </div>
                  <div className="bproster">
                    {PACK_PREVIEW_ROLES.map((role) => (
                      <span key={role} className="bprow">
                        <span className="bprole"><span className="roledot" style={{ background: ROLE_DOT[role] }} />{role}</span>
                        <ProviderLogo id={providerIdForModel(selPack.roles[role]!)} s={12} />
                        <span className="bpmodel">{modelLabel(selPack.roles[role]!)}</span>
                        {selPack.latency && (selPack.latency[role]
                          ? <span className="packlat">{selPack.latency[role]}</span>
                          : <span className="packlat cur">curated</span>)}
                      </span>
                    ))}
                  </div>
                  {/* the support-roles line and the needs sentence stripped (R7): the Connect
                      button already NAMES the missing providers, Active already says active —
                      the prose only ever restated a button two inches away. What stays is the
                      apply CONFIRMATION, because "did my click land" is a state only it reports. */}
                  <div className="bpfoot">
                    <span className="bpneeds">
                      {applied !== null && effective === sel
                        ? <>Re-pointed {applied} agent{applied === 1 ? '' : 's'} · pinned kept</>
                        : null}
                    </span>
                    {selPack.custom && <button className="bpmini" onClick={() => { setOpen(false); setBuilder({ edit: selPack.custom }); }}>Edit</button>}
                    {effective === sel
                      ? <span className="bpapply ghost">Active</span>
                      : missing.length === 0
                        ? <button className="bpapply" disabled={busy} onClick={() => void apply()}>{busy ? 'Applying…' : `Apply ${selPack.name}`}</button>
                        : <button className="bpconnect" onClick={() => { setOpen(false); onConnect(missing[0]!); }}>Connect {missing.map(provName).join(' + ')} →</button>}
                  </div>
                </div>
              )}
            </div>
            </div>
            )}
            </div>
          </div>
        </>
      )}
      {builder && (
        <BrainBuilder
          initial={builder.edit}
          seedRoles={resolvePackRoles(active, custom) ?? PACKS['balanced']!.roles}
          enabled={enabled}
          onClose={() => setBuilder(null)}
          onDone={() => { setBuilder(null); window.dispatchEvent(new Event('nm:brains-changed')); }}
        />
      )}
    </div>
  );
}
