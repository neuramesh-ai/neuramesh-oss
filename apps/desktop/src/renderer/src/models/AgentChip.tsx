// THE AGENT CHIP (docs/design/models-and-replies-2026-10, boards D3, D4, D5): who answers the next
// message, beside Send. The menu lists the room's agents, rex first as the main agent, each with the
// model it runs FOR YOU (picks.ts seatView). A row picks who answers, and Send names that agent
// (`@name`, the grammar the daemon routes on). The model on a row opens that agent's model list, the
// same list the model chip draws, and the pick is yours alone. New agent registers one in this room.
import { CODE_GEMINI_NOTE, AGENT_ROLES, CURRENT_MODELS, DEFAULT_THINKING, modelLabel, runtimeForModel, STARTER_MODEL, takesThinking, THINKING_LABEL, THINKING_LEVELS, type ThinkingLevel } from '@neuramesh/shared';
import { useEffect, useRef, useState } from 'react';
import { ProviderLogo } from '../brain/providers';
import { AgentAvatar } from '../components/AgentAvatar';
import { roomOn } from '../compute/MachineChip';
import { ModelMenu } from './ModelMenu';
import { chipLabel, markOf, type ProviderKey, type ProviderState, type SeatView } from './picks';

export type ChipAgent = { id: string; name: string; role: string; model: string; emoji?: string | null };
export type NewAgentInput = { name: string; description: string; role: string; model: string; thinking: ThinkingLevel | null };

/** the model on a row, short: the vendor's name off the front, the level after it */
const short = (s: SeatView) => `${chipLabel(modelLabel(s.model)).replace(/^Claude /, '')}${s.thinking ? ` · ${THINKING_LABEL[s.thinking]}` : ''}`;
const ALL_MODELS = [STARTER_MODEL, ...CURRENT_MODELS['claude-code'], ...CURRENT_MODELS.codex, ...CURRENT_MODELS.gemini.filter((m) => m !== STARTER_MODEL)];

export function AgentChip({ roomSlug, agents, answerer, byDefault, seatOf, states, onAnswer, onPick, onConnect, onCreate, disabled, modelScope = 'person' }: {
  disabled?: boolean;
  modelScope?: 'thread' | 'person';
  roomSlug: string;
  /** the room's live agents, the main agent first */
  agents: ChipAgent[];
  /** who answers a message sent now; null = nobody unless the message names someone */
  answerer: ChipAgent | null;
  byDefault: ChipAgent | null;
  seatOf: (a: ChipAgent) => SeatView;
  states: Record<ProviderKey, ProviderState>;
  onAnswer: (name: string | null) => void;
  onPick: (a: ChipAgent, model: string, thinking: ThinkingLevel | null) => void;
  onConnect: (provider: ProviderKey) => void;
  onCreate?: (input: NewAgentInput) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<{ kind: 'list' } | { kind: 'model'; agent: ChipAgent } | { kind: 'new' }>({ kind: 'list' });
  const anchor = useRef<HTMLButtonElement>(null);
  const [cap, setCap] = useState<number | null>(null);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  const close = () => { setOpen(false); setView({ kind: 'list' }); };
  const toggle = () => { setCap(Math.max(260, roomOn(anchor.current) - 24)); setView({ kind: 'list' }); setOpen((o) => !o); };
  const main = agents.find((a) => a.role === 'orchestrator') ?? null;
  const crew = agents.filter((a) => a !== main);
  const back = (label: React.ReactNode) => (
    <button type="button" className="cprojhint cmodback" onClick={() => setView({ kind: 'list' })}><span aria-hidden>‹</span>{label}</button>
  );
  const row = (a: ChipAgent) => {
    const on = answerer?.id === a.id;
    const seat = seatOf(a);
    return (
      <div key={a.id} className={`cagrow${on ? ' on' : ''}`}>
        <button type="button" role="menuitemradio" aria-checked={on} className="cagpick" onClick={() => { onAnswer(a.id === byDefault?.id ? null : a.name); close(); }}>
          <AgentAvatar name={a.name} emoji={a.emoji} size={20} />
          <span className="cprojtxt"><b>{a.name}{a === main && <span className="cagmain">main</span>}</b><span>{a.role}</span></span>
        </button>
        <button type="button" className="cagmodel" aria-label={`Model for ${a.name}`} onClick={() => setView({ kind: 'model', agent: a })}>
          <ProviderLogo id={markOf(seat.model)} s={11} /><span className="lbl">{short(seat)}</span>
        </button>
        <span className="cprojck" aria-hidden>{on ? '✓' : ''}</span>
      </div>
    );
  };
  const who = answerer ?? null;
  return (
    <div className="cchips cagchips">
      <button ref={anchor} disabled={disabled} type="button" className={`cchip cagent${open ? ' open' : ''}${who ? '' : ' none'}`} aria-haspopup="dialog" aria-expanded={open}
        aria-label={`Agent: ${who?.name ?? 'none'}`} data-tip={who ? `${who.name} answers here` : 'No agent answers here unless you pick one'} onClick={toggle}>
        {who && <AgentAvatar name={who.name} emoji={who.emoji} size={16} />}
        <span className="lbl">{who?.name ?? 'Agent'}</span><span className="car" aria-hidden>▴</span>
      </button>
      {open && (
        <>
          <div className="projmenu-scrim" onClick={close} />
          <div className="cprojpop cagpop" role="dialog" aria-label="Agents" style={cap ? { maxHeight: cap } : undefined}>
            {view.kind === 'list' && (
              <>
                <div className="cprojhint cmodhead"><b>Agents</b><span>in #{roomSlug}</span></div>
                {main && <div className="cmodgroup">{row(main)}</div>}
                {crew.length > 0 && <div className="cmodgroup"><div className="cagsec">Crew</div>{crew.map(row)}</div>}
                {onCreate && <button type="button" className="cagnew" onClick={() => setView({ kind: 'new' })}><span className="pl" aria-hidden>+</span>New agent</button>}
              </>
            )}
            {view.kind === 'model' && (() => {
              const a = view.agent;
              const seat = seatOf(a);
              return (
                <ModelMenu
                  head={back(<><AgentAvatar name={a.name} emoji={a.emoji} size={16} /><b>{a.name}</b><span>· {a.role}</span></>)}
                  notes={modelScope === 'thread' ? { gemini: CODE_GEMINI_NOTE } : undefined} current={seat.model} level={seat.thinking} states={states} locked={seat.source === 'automation'}
                  foot={seat.source === 'automation' ? <>Automations run on the NeuraMesh brain.</> : modelScope === 'thread' ? <><b>{a.name}</b> uses this model in this conversation from the next message.</> : <><b>{a.name}</b> uses this model from its next run for you.</>}
                  onPick={(m, t) => { onPick(a, m, t); setView({ kind: 'list' }); }} onConnect={(p) => { close(); onConnect(p); }} />
              );
            })()}
            {view.kind === 'new' && onCreate && <NewAgent back={back(<b>New agent</b>)} roomSlug={roomSlug} states={states} onCancel={() => setView({ kind: 'list' })}
              onCreate={async (input) => { await onCreate(input); close(); }} />}
          </div>
        </>
      )}
    </div>
  );
}

/** board D5: a name, what it does, a role, a model and its level. It joins this room. The model opens
 *  the same list in the form's place, and the roles are pills: the menu scrolls, so it hosts no
 *  dropdown (docs/33, take over the body) */
function NewAgent({ back, roomSlug, states, onCancel, onCreate }: {
  back: React.ReactNode; roomSlug: string; states: Record<ProviderKey, ProviderState>;
  onCancel: () => void; onCreate: (input: NewAgentInput) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [role, setRole] = useState('worker');
  const ready = (m: string) => m === STARTER_MODEL || states[({ 'claude-code': 'anthropic', codex: 'openai', gemini: 'gemini' } as const)[runtimeForModel(m)]] === 'ready';
  const [model, setModel] = useState(() => ALL_MODELS.find((m) => m !== STARTER_MODEL && ready(m)) ?? STARTER_MODEL);
  const [thinking, setThinking] = useState<ThinkingLevel>(DEFAULT_THINKING);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const slug = name.trim().toLowerCase();
  const valid = /^[a-z0-9][a-z0-9._-]*$/.test(slug);
  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true); setErr('');
    try { await onCreate({ name: slug, description: description.trim(), role, model, thinking: takesThinking(model) ? thinking : null }); }
    catch (e) { setErr(e instanceof Error ? e.message.slice(0, 160) : 'The agent was not created.'); }
    finally { setBusy(false); }
  };
  if (picking) {
    return (
      <ModelMenu head={<button type="button" className="cprojhint cmodback" onClick={() => setPicking(false)}><span aria-hidden>‹</span><b>Model</b><span>for {slug || 'the new agent'}</span></button>}
        current={model} level={takesThinking(model) ? thinking : null} states={states} onConnect={() => setPicking(false)}
        onPick={(m, t) => { setModel(m); if (t) setThinking(t); setPicking(false); }} />
    );
  }
  return (
    <div className="cagform">
      {back}
      <label className="cagfld"><span>Name</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="quill" autoFocus /></label>
      <label className="cagfld top"><span>What it does</span><textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Writes long posts in the brand voice, from the brand docs." /></label>
      <div className="cagfld top"><span>Role</span>
        <span className="cagroles" role="radiogroup" aria-label="Role">{AGENT_ROLES.filter((r) => r !== 'orchestrator' && r !== 'curator').map((r) => (
          <button key={r} type="button" role="radio" aria-checked={role === r} className={role === r ? 'on' : ''} onClick={() => setRole(r)}>{r}</button>
        ))}</span>
      </div>
      <div className="cagfld"><span>Model</span>
        <button type="button" className="cmodpill" onClick={() => setPicking(true)} aria-label={`Model: ${chipLabel(modelLabel(model))}`}>
          <span className="g" aria-hidden><ProviderLogo id={markOf(model)} s={12} /></span><span className="lbl">{chipLabel(modelLabel(model))}</span><span className="car" aria-hidden>▾</span>
        </button>
      </div>
      {takesThinking(model) && (
        <div className="cagfld"><span>Thinking</span>
          <span className="cagseg" role="radiogroup" aria-label="Thinking">{THINKING_LEVELS.map((l) => (
            <button key={l} type="button" role="radio" aria-checked={thinking === l} className={thinking === l ? 'on' : ''} onClick={() => setThinking(l)}>{THINKING_LABEL[l]}</button>
          ))}</span>
        </div>
      )}
      <div className="cagfld"><span>Room</span><span className="cagroom">#{roomSlug}</span></div>
      {err && <div className="cagerr" role="alert">{err}</div>}
      <div className="cagacts">
        <button type="button" className="btn primary sm" disabled={!valid || busy} onClick={() => void submit()}>Create agent</button>
        <button type="button" className="btn sm ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
