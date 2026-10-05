// THE MODEL MENU (docs/design/models-and-replies-2026-10, boards D2 and D4): the house brain, then one
// group per provider from the SHARED catalog, ready providers first in their state and the rest dim with
// the one act that fixes them. A row takes a thinking level when its model does: the chevron opens
// Low · Medium · High under the row (the board drew them beside it, but the menu scrolls and a flyout
// clips). The same body serves the model chip (the agent the composer talks to), the agent menu
// (one agent's model) and the Code chip (a coding session's model), so they can never list different models.
import { CURRENT_MODELS, DEFAULT_THINKING, modelLabel, STARTER_MODEL, takesThinking, THINKING_LABEL, THINKING_LEVELS, type ThinkingLevel } from '@neuramesh/shared';
import { useState, type ReactNode } from 'react';
import { ProviderLogo } from '../brain/providers';
import { chipLabel, type ProviderKey, type ProviderState } from './picks';

const GROUPS: ReadonlyArray<{ id: ProviderKey; name: string; models: readonly string[]; note?: string }> = [
  { id: 'anthropic', name: 'Claude', models: CURRENT_MODELS['claude-code'] },
  { id: 'openai', name: 'ChatGPT', models: CURRENT_MODELS.codex },
  { id: 'gemini', name: 'Gemini', models: CURRENT_MODELS.gemini.filter((m) => m !== STARTER_MODEL), note: 'A Google sign-in runs your account’s own model.' },
];

export function ModelMenu({ head, current, level, states, onPick, onConnect, foot, locked, thinking = true, notes }: {
  /** the menu's first row: "Model for rex", or the agent menu's back row */
  head: ReactNode;
  current: string;
  level: ThinkingLevel | null;
  states: Record<ProviderKey, ProviderState>;
  onPick: (model: string, thinking: ThinkingLevel | null) => void;
  onConnect: (provider: ProviderKey) => void;
  foot?: ReactNode;
  /** an automation's agent: the NeuraMesh brain only */
  locked?: boolean;
  /** false on a coding session: the coding runtime takes no thinking level */
  thinking?: boolean;
  /** a group's note in place of its own (the Code chip's Gemini note) */
  notes?: Partial<Record<ProviderKey, string>>;
}) {
  // the row whose thinking levels are open under it
  const [levels, setLevels] = useState<string | null>(null);
  /** whether a row takes a thinking level: a ready model that has them, on a menu that offers them */
  const thinks = (model: string, ready: boolean) => thinking && ready && takesThinking(model);
  const pick = (model: string, lv?: ThinkingLevel) => {
    const keep = model === current ? level : null;
    onPick(model, thinks(model, true) ? lv ?? keep ?? DEFAULT_THINKING : null);
  };
  const row = (model: string, prov: ProviderKey | 'house', ready: boolean) => {
    const on = model === current;
    const canThink = thinks(model, ready);
    const lv = canThink ? (on ? level : null) : null;
    return (
      <div key={model} className={`cmodrow${on ? ' on' : ''}${ready ? '' : ' off'}${levels === model ? ' lvopen' : ''}`}>
        <button type="button" role="menuitemradio" aria-checked={on} disabled={!ready || locked} className="cmodpick"
          data-tip={ready ? undefined : states[prov as ProviderKey] === 'connect' ? `Connect ${GROUPS.find((g) => g.id === prov)?.name} to use ${modelLabel(model)}` : `Sign in to ${GROUPS.find((g) => g.id === prov)?.name} on a machine you use`}
          onClick={() => pick(model)}>
          <span className="mk"><ProviderLogo id={prov === 'house' ? 'neuramesh' : prov} s={prov === 'house' ? 15 : 14} /></span>
          <span className="nm">{chipLabel(modelLabel(model))}</span>
          {prov === 'house' && <span className="cr">on credits</span>}
          {lv && <span className="lv">{THINKING_LABEL[lv]}</span>}
          {on && <span className="cprojck" aria-hidden>✓</span>}
        </button>
        {canThink && !locked && (
          <button type="button" className="cmodchev" aria-label={`Thinking for ${modelLabel(model)}`} aria-expanded={levels === model}
            onClick={() => setLevels((m) => (m === model ? null : model))}>›</button>
        )}
        {levels === model && (
          <div className="cmodlv" role="radiogroup" aria-label={`Thinking for ${modelLabel(model)}`}>
            <span className="k">Thinking</span>
            {THINKING_LEVELS.map((l) => (
              <button key={l} type="button" role="radio" aria-checked={on && level === l} className={on && level === l ? 'on' : ''}
                onClick={() => { setLevels(null); pick(model, l); }}>{THINKING_LABEL[l]}</button>
            ))}
          </div>
        )}
      </div>
    );
  };
  return (
    <div className="cmodmenu">
      {head}
      <div className="cmodgroup">{row(STARTER_MODEL, 'house', true)}</div>
      {!locked && GROUPS.map((g) => {
        const st = states[g.id];
        return (
          <div key={g.id} className="cmodgroup">
            <div className="cmodprov">
              <b>{g.name}</b>
              {st === 'ready'
                ? <span className="cmodst"><i aria-hidden />ready</span>
                : <button type="button" className="cmodfix" onClick={() => onConnect(g.id)}>{st === 'connect' ? 'Connect' : 'Sign in'}</button>}
            </div>
            {(notes?.[g.id] ?? g.note) && <div className="cmodnote">{notes?.[g.id] ?? g.note}</div>}
            {g.models.map((m) => row(m, g.id, st === 'ready'))}
          </div>
        );
      })}
      {foot && <div className="cmachfoot">{foot}</div>}
    </div>
  );
}
