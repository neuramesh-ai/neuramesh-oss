// The agent-details panel — one teammate's identity, brief, brain and registrations.
// Extracted from App.tsx (track A2); bodies unchanged.
import { CUSTOM_PACK_ID, isCustomPackId, planLabel, resolvePackName, resolvePackRoles, type AgentRole, type CustomModelPack } from '@neuramesh/shared';
import { Modal } from '../ui/Modal';
import { RUNTIME_OPTS, runtimeLabel } from '../lib/runtimes';
import { Select } from '../ui/Select';


import { modelLabel, runtimeForModel } from '../lib/models';
import { nm as nmBridge } from '../bridge/nm';
import { type AgentRow } from '../bridge/rows-crew';
import { type ChannelRow } from '../bridge/rows-rooms';
import { type CredRow } from '../bridge/rows-infra';
import { type WorkspaceProjectRow } from '../bridge/rows-board';
import { useEffect, useState } from 'react';
import { AgentPrompt } from './AgentPrompt';
import { cleanCmdErr } from '../lib/text';
import { AgentRetire } from './AgentRetire';
import { AgentPlace } from './AgentPlace';

// Imported bindings lose control-flow narrowing inside closures, so re-bind (same as App.tsx).
const nm = nmBridge;

// runtime → its inference provider + sensible model choices (A2A multi-runtime).
// The label/provider drive the agent-create picker and the roster runtime chip.
// Placeholder descriptions per role — the SHAPE the research asks for (capability first, then
// the trigger: "…Route X here"), not text to keep. Shown as a placeholder, never pre-filled:
// a field you have to empty before you can write in it is worse than an empty one.
export const DESC_HINT: Record<string, string> = {
  developer: 'Implements features in the web app. Route UI, API and refactor work here.',
  reviewer: 'Reviews pull requests against the Definition of Done. Route review rounds here.',
  architect: 'Turns approved designs into implementation plans. Route planning work here.',
  designer: 'Designs user-facing work before it is built. Route any visual or UI-shaped task here.',
  marketer: 'Drafts platform-native content in the product’s voice. Route posts and campaigns here.',
  shipper: 'Production readiness and release coordination. Route deploy-step and merge-gate work here.',
  worker: 'Research and analysis with report-style deliverables. Route investigations here.',
  sales: 'Outbound and customer research. Route prospect and pipeline work here.',
};

export function AgentDetails({ agent, channels, projects, creds, isCloud, place, onSaved, onUpgrade, onClose }: { agent: AgentRow; channels: ChannelRow[]; projects: WorkspaceProjectRow[]; creds: CredRow[]; isCloud: boolean;
  /** where this agent runs (0119): `on` is live truth, `mine` is where YOUR next request goes,
   *  `why` explains them differing — two questions the overview used to answer for neither. */
  place?: { on: string | null; mine: string | null; why: string | null };
  onSaved: () => void; onUpgrade: () => void; onClose: () => void }) {
  const isRetired = !!agent.retired_at;
  const [showCard, setShowCard] = useState(false);
  const card = (() => { try { return agent.card ? JSON.parse(agent.card) as { url?: string; skills?: Array<{ name: string }> } : null; } catch { return null; } })();
  const own = creds.find((c) => c.scope === 'agent' && c.agentId === agent.id);
  const ws = creds.find((c) => c.scope === 'workspace');
  // view-only channel memberships, resolved from the agent's channel IDS so same-slug rooms in
  // different projects stay distinct and get a project tag. Falls back to raw slugs mid-sync.
  const slugCounts = channels.reduce((m, c) => m.set(c.slug, (m.get(c.slug) ?? 0) + 1), new Map<string, number>());
  const projNameOf = (pid: string | null) => projects.find((p) => p.id === pid)?.name;
  const memberChannels = (agent.channel_ids ?? '').split(',').map((s) => s.trim()).filter(Boolean)
    .map((id) => channels.find((c) => c.id === id)).filter((c): c is ChannelRow => !!c);
  const fallbackSlugs = !memberChannels.length ? (agent.channels ?? '').split(',').map((s) => s.trim()).filter(Boolean) : [];
  // edit the agent's brain (model + provider) — the daemon re-reads it live and re-routes the
  // agent's workflow to the chosen provider. Remote (A2A) agents are external → not editable here.
  const [runtime, setRuntime] = useState(agent.runtime ?? 'claude-code');
  const [model, setModel] = useState(agent.model);
  const [savingModel, setSavingModel] = useState(false);
  // the active workspace pack — to offer "reset to pack default" on a manually-pinned agent.
  // A custom brain's name/roles live server-side, so fetch the list when the active id is one.
  const [activePack, setActivePack] = useState<string>(CUSTOM_PACK_ID);
  const [customPacks, setCustomPacks] = useState<CustomModelPack[]>([]);
  useEffect(() => {
    void nm?.workspaceSettings().then(async (s) => {
      const id = s.activeModelPack ?? CUSTOM_PACK_ID;
      setActivePack(id);
      if (isCustomPackId(id)) setCustomPacks(((await nm.modelPacks()).packs ?? []) as CustomModelPack[]);
    }).catch(() => {});
  }, []);
  const modelDirty = agent.kind !== 'remote' && (runtime !== (agent.runtime ?? 'claude-code') || model !== agent.model);
  const modelOptions = [...new Set([...(RUNTIME_OPTS[runtime]?.models ?? []), model])];
  const saveModel = async () => {
    if (!nm || !modelDirty) return;
    setSavingModel(true);
    try { await nm.agentUpdate({ agentId: agent.id, model, runtime }); onSaved(); } finally { setSavingModel(false); }
  };
  // flip a hand-pinned agent back to the active pack's model for its role (re-pack-manages it)
  const packModel = resolvePackRoles(activePack, customPacks)?.[agent.role as AgentRole] ?? null;
  const resetToPack = async () => {
    if (!nm || !packModel) return;
    setSavingModel(true);
    try { await nm.agentUpdate({ agentId: agent.id, model: packModel, runtime: runtimeForModel(packModel), modelSource: 'pack' }); onSaved(); } finally { setSavingModel(false); }
  };
  // retire / rehire (soft — the server keeps the row + history; register-same-name rehires).
  // ── The two strings (0110) ────────────────────────────────────────────────────────────────
  // `description` is written for the DISPATCHER — rex reads it in list_agents to decide who
  // takes a task, and the A2A card publishes it. `brief` is written for the AGENT — its standing
  // instructions, injected into every turn. Adjacent and labelled by audience, because the
  // difference between them is the whole feature and a paragraph of help text can't carry it.
  const [descEdit, setDescEdit] = useState(false);
  const [descDraft, setDescDraft] = useState(agent.description ?? '');
  const [instrEdit, setInstrEdit] = useState(false);
  // INSTRUCTIONS ARE MACHINE-LOCAL (§B.1): the editor reads and writes this host's own file, not
  // the synced column. `agents.brief` remains the baseline a fresh machine inherits — shown only
  // when this machine has never been configured for this agent.
  const [localInstr, setLocalInstr] = useState<{ local: string | null; shipped: string | null; path: string; prompt?: Record<string, string> | null } | null>(null);
  useEffect(() => {
    let dead = false;
    void nm?.agentInstructions(agent.name, agent.role).then((r) => { if (!dead) setLocalInstr(r); }, () => {});
    return () => { dead = true; };
  }, [agent.name, agent.role]);
  const liveInstr = (localInstr?.local ?? agent.brief ?? localInstr?.shipped ?? '') as string;
  const atDefault = !(localInstr?.local ?? '').trim();
  const [instrDraft, setInstrDraft] = useState('');
  const [textBusy, setTextBusy] = useState(false);
  const [textErr, setTextErr] = useState('');
  useEffect(() => { setDescDraft(agent.description ?? ''); }, [agent.id, agent.description]);
  useEffect(() => { setInstrDraft(liveInstr); }, [liveInstr]);
  const saveText = async (patch: { description?: string; brief?: string }) => {
    if (!nm || textBusy) return;
    setTextBusy(true); setTextErr('');
    try {
      // description is a claim made to OTHERS (list_agents, the A2A card) → the synced column.
      // instructions govern how this agent behaves HERE → this machine's file. Same overlay,
      // two destinations, because they have two different readers.
      if (patch.description !== undefined) { await nm.agentUpdate({ agentId: agent.id, description: patch.description }); onSaved(); }
      if (patch.brief !== undefined) {
        await nm.agentInstructionsWrite(agent.name, patch.brief);
        setLocalInstr(await nm.agentInstructions(agent.name, agent.role));
      }
      setDescEdit(false); setInstrEdit(false);
    } catch (e) { setTextErr(cleanCmdErr(e)); } finally { setTextBusy(false); }
  };
  /** drop this machine's override so the layer beneath governs again */
  const resetInstructions = async () => {
    if (!nm || textBusy) return;
    setTextBusy(true); setTextErr('');
    try {
      await nm.agentInstructionsWrite(agent.name, null);
      setLocalInstr(await nm.agentInstructions(agent.name, agent.role));
      setInstrEdit(false);
    } catch (e) { setTextErr(cleanCmdErr(e)); } finally { setTextBusy(false); }
  };

  // ── Rooms (the ACL boundary) ──────────────────────────────────────────────────────────────
  // These were read-only chips: you could see where an agent worked and not change it without
  // going to the room. They ride the SAME commands the live-panel "+" uses, so the server's
  // rules (only humans/orchestrator; the orchestrator can never be removed from a room) hold
  // exactly as they already do — this is a second door onto them, not a second policy.
  const [roomsEdit, setRoomsEdit] = useState(false);
  const [roomBusy, setRoomBusy] = useState('');
  const [roomErr, setRoomErr] = useState('');
  const memberIds = new Set(memberChannels.map((c) => c.id));
  const joinable = channels.filter((c) => !memberIds.has(c.id));
  const moveRoom = async (channelId: string, op: 'add' | 'remove') => {
    if (!nm || roomBusy) return;
    setRoomBusy(channelId); setRoomErr('');
    try { await (op === 'add' ? nm.addAgentToChannel(channelId, agent.id) : nm.removeAgentFromChannel(channelId, agent.id)); onSaved(); }
    catch (e) { setRoomErr(cleanCmdErr(e)); } finally { setRoomBusy(''); }
  };


  const DESC_MAX = 280, INSTR_MAX = 2000;
  return (
    // `full` + a two-column body (2026-08-05, founder call). At 420px this was a slim, tall
    // column that scrolled — and rex, who auto-joins every room, made it scroll a long way. The
    // split is by WHAT THE READER IS DOING: the left column is the agent's remit, which is what
    // you came to read or edit; the right is its wiring, which you glance at. Two columns roughly
    // halve the height, which is what actually removes the scrollbar — a wider single column
    // would only have made the lines too long to read (§ the --col measure exists for a reason).
    <Modal title={`@${agent.name}`} onClose={onClose} full>
      <div className="agentgrid">
      <div className="agcol agcol-remit">
      <div className="kvline"><span>role</span><b>{agent.role}</b></div>
      {agent.kind !== 'remote' && <AgentPlace place={place} />}

      {/* Description — the routing string, and the first thing on screen because it is what
          this agent IS. Model and credential are wiring, and sit in the other column. */}
      <div className="sect agsect">Description<i />
        <span className="readby" title="the orchestrator reads this in list_agents when it decides who takes a task">read by the orchestrator</span>
        {!descEdit && <button className="agedit" onClick={() => setDescEdit(true)}>{agent.description ? 'Edit' : 'Add'}</button>}
      </div>
      {descEdit ? (
        <>
          <textarea className="agtxt agdesc" value={descDraft} maxLength={DESC_MAX} autoFocus
            placeholder={`e.g. ${DESC_HINT[agent.role] ?? 'What this agent does. Route <kind of work> here.'}`}
            aria-label="Agent description" onChange={(e) => setDescDraft(e.target.value)} />
          <div className="agtxtfoot">
            <button className="btn primary sm" disabled={textBusy} onClick={() => void saveText({ description: descDraft })}>{textBusy ? 'saving…' : 'Save'}</button>
            <button className="btn sm" disabled={textBusy} onClick={() => { setDescDraft(agent.description ?? ''); setDescEdit(false); }}>Cancel</button>
            <span className="agcount">{descDraft.length} / {DESC_MAX}</span>
          </div>
          <p className="modalhint">Write it as a routing rule, not a title: <b>what it does</b> and <b>when to send work here</b>.</p>
        </>
      ) : (
        <div className={`agbox${agent.description ? '' : ' empty'}`}>{agent.description || 'No description — the orchestrator can only tell this agent apart by its role.'}</div>
      )}

      {/* Instructions — written for the agent itself. Same field the orchestrator sets at hire;
          human-only to rewrite, because an agent that could edit its own remit has none. */}
      <div className="sect agsect">Instructions<i />
        <span className="thismachine" title={localInstr?.path ?? 'this machine only'}>this machine</span>
        {!instrEdit && !atDefault && (
          <button className="agedit" disabled={textBusy} title="drop this machine's version and fall back to the default" onClick={() => void resetInstructions()}>Reset</button>
        )}
        {!instrEdit && <button className="agedit" onClick={() => setInstrEdit(true)}>{liveInstr ? 'Edit' : 'Add'}</button>}
      </div>
      {instrEdit ? (
        <>
          <textarea className="agtxt aginstr" value={instrDraft} maxLength={INSTR_MAX} autoFocus
            placeholder="e.g. One concrete claim per post. Lowercase, no hashtags. Never publish — every post is a draft the human approves."
            aria-label="Agent instructions" onChange={(e) => setInstrDraft(e.target.value)} />
          <div className="agtxtfoot">
            <button className="btn primary sm" disabled={textBusy} onClick={() => void saveText({ brief: instrDraft })}>{textBusy ? 'saving…' : 'Save'}</button>
            <button className="btn sm" disabled={textBusy} onClick={() => { setInstrDraft(agent.brief ?? ''); setInstrEdit(false); }}>Cancel</button>
            <span className="agcount">{instrDraft.length} / {INSTR_MAX}</span>
          </div>
          <p className="modalhint">Takes effect on <b>@{agent.name}'s next turn</b> — a run already in flight keeps what it started with.</p>
        </>
      ) : (
        <div className={`agbox instr${liveInstr ? '' : ' empty'}`}>{liveInstr || 'No instructions — this agent works to its role’s defaults.'}</div>
      )}
      {!instrEdit && !descEdit && (
        <p className="modalhint">
          Instructions ride <b>every</b> turn this agent takes on <b>this machine</b> — board tasks, thread replies, and any subagent spawned onto its seat. They are not synced: another machine running @{agent.name} keeps its own.
          {atDefault ? ' Currently the default.' : ' Edited here — Reset restores the default.'}
        </p>
      )}
      {textErr && <div className="acterr" style={{ marginTop: 8 }}>{textErr}</div>}

      <AgentPrompt prompt={localInstr?.prompt ?? {}} agentName={agent.name} hint={!instrEdit && !descEdit} />

      </div>
      <div className="agcol agcol-wiring">

      {isRetired && (
        <div className="kvline"><span>status</span><b style={{ color: 'var(--muted)' }}>retired {agent.retired_at ? new Date(agent.retired_at).toLocaleDateString([], { month: 'short', day: 'numeric' }) : ''}</b></div>
      )}
      {agent.kind === 'remote' || isRetired ? (
        <><div className="kvline"><span>runtime</span><b>{agent.kind === 'remote' ? 'External A2A agent' : runtimeLabel(agent.runtime)}</b></div>
        <div className="kvline"><span>model</span><b>{agent.model}</b></div></>
      ) : (
        <div className="fld" style={{ marginTop: 4 }}>
          <label>Brain — model & provider for @{agent.name}'s workflow</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <Select value={runtime} width="46%" options={Object.entries(RUNTIME_OPTS).map(([id, o]) => ({ value: id, label: o.provider }))} onChange={(rt) => { setRuntime(rt); setModel(RUNTIME_OPTS[rt]?.models[0] ?? model); }} />
            <Select value={model} width="54%" options={modelOptions.map((m) => ({ value: m, label: modelLabel(m) }))} onChange={setModel} />
          </div>
          {modelDirty && <button className="btn primary sm" style={{ marginTop: 9, width: 'auto' }} disabled={savingModel} onClick={() => void saveModel()}>{savingModel ? 'saving…' : `Switch @${agent.name} to ${modelLabel(model)}`}</button>}
          {agent.model_source === 'manual' && activePack !== CUSTOM_PACK_ID && !modelDirty && (
            <div className="pinnote">
              <span>Pinned — keeps this brain when the {resolvePackName(activePack, customPacks) ?? 'active'} pack changes.</span>
              {packModel && <button className="pinreset" disabled={savingModel} onClick={() => void resetToPack()}>Reset to pack default</button>}
            </div>
          )}
        </div>
      )}
      {/* Rooms — editable here now, through the same commands the live-panel "+" fires. A room
          is this agent's ACL boundary, which is why it belongs on its record and not only in
          the room it happens to be in. Remote (A2A) and retired agents stay read-only. */}
      <div className="sect agsect">Rooms<i />
        {!isRetired && agent.kind !== 'remote' && (
          <button className="agedit" onClick={() => { setRoomsEdit((v) => !v); setRoomErr(''); }}>{roomsEdit ? 'Done' : 'Edit'}</button>
        )}
      </div>
      <div className="agchans">
        {memberChannels.length ? memberChannels.map((c) => {
          const pn = (slugCounts.get(c.slug) ?? 0) > 1 ? projNameOf(c.project_id) : null;
          return (
            <span key={c.id} className="chchip">#{c.slug}{pn ? <span className="chchipproj">{pn}</span> : null}
              {roomsEdit && (
                <button className="chchipx" disabled={!!roomBusy} aria-label={`Remove @${agent.name} from #${c.slug}`}
                  title={`Remove from #${c.slug}`} onClick={() => void moveRoom(c.id, 'remove')}>{roomBusy === c.id ? '·' : '✕'}</button>
              )}
            </span>
          );
        }) : fallbackSlugs.length ? fallbackSlugs.map((s, i) => <span key={i} className="chchip">#{s}</span>)
          : <span className="agchansnone">none</span>}
        {roomsEdit && joinable.map((c) => {
          const pn = (slugCounts.get(c.slug) ?? 0) > 1 ? projNameOf(c.project_id) : null;
          return (
            <button key={c.id} className="chchip add" disabled={!!roomBusy} title={`Add @${agent.name} to #${c.slug}`}
              onClick={() => void moveRoom(c.id, 'add')}>+ #{c.slug}{pn ? <span className="chchipproj">{pn}</span> : null}</button>
          );
        })}
      </div>
      {roomsEdit && <p className="modalhint">A room is this agent&rsquo;s <b>ACL boundary</b> — it can see and be offered work only in the rooms listed here.</p>}
      {roomErr && <div className="acterr" style={{ marginTop: 8 }}>{roomErr}</div>}
      <div className="kvline"><span>credential</span>
        <b>{own ? (own.authMode === 'subscription' ? 'agent subscription' : `agent key ····${own.last4}`) : ws ? (ws.authMode === 'subscription' ? 'workspace subscription' : `workspace key ····${ws.last4}`) : 'host env / none'}</b></div>

      {card && (
        <>
          <div className="sect" style={{ padding: '16px 0 5px' }}>A2A Agent Card</div>
          <p className="modalhint">This agent's A2A 1.0 card — discoverable by external systems. Skills, runtime, and channel scope; no secrets.</p>
          <div className="kvline"><span>discover</span><b style={{ font: '600 10.5px var(--fmono)', userSelect: 'all' }}>{card.url}/card.json</b></div>
          <div className="kvline">
            <span>A2A sharing</span>
            {isCloud
              ? <b style={{ color: 'var(--green)' }}>Exposed · discoverable</b>
              : <button className="exposelock" title={`A2A share and hand-off is a ${planLabel('cloud')} feature`} onClick={onUpgrade}>Private<span className="gatelock">{planLabel('cloud')}</span></button>}
          </div>
          <button className="btn" style={{ marginTop: 8 }} onClick={() => setShowCard((v) => !v)}>{showCard ? 'Hide' : 'Show'} card JSON</button>
          {showCard && <pre className="cardjson">{JSON.stringify(card, null, 2)}</pre>}
        </>
      )}

      <AgentRetire agent={agent} isRetired={isRetired} onSaved={onSaved} onClose={onClose} />
      </div>
      </div>
    </Modal>
  );
}
