import { agentInChannel, codeMachineOf, codeProviderStates, engineeringEffort, STARTER_MODEL, type EngineeringSelection } from '@neuramesh/shared';
import { openProviderSettings } from '../lib/toast';
import { selfUser } from '../lib/self';
import { useCredentialSets } from './hooks';
import { useModelRoster } from './roster';
import { picksOf, seatView, type SeatView } from './picks';
import { ComposerAgentControls } from './ComposerAgentControls';

/** Coding changes routing and provider availability; the controls are shared with ordinary chat. */
export function CodingBrains({ selection, onChange, machineId, roomId, roomSlug, disabled, part }: {
  selection: EngineeringSelection; onChange: (selection: EngineeringSelection) => void;
  machineId: string | null; roomId: string | null; roomSlug: string;
  disabled?: boolean; part?: 'both' | 'model' | 'agent';
}) {
  const { agents, machines, members } = useModelRoster();
  const { configured, keyed } = useCredentialSets();
  const available = agents.filter((a) => !a.retired_at && a.kind !== 'remote' && (!roomId || agentInChannel(a.channel_ids, roomId)));
  const main = available.find((a) => a.role === 'orchestrator' && a.name.toLowerCase() === 'rex') ?? available.find((a) => a.role === 'orchestrator') ?? null;
  const answerer = available.find((a) => a.id === selection.agentId) ?? main;
  const states = codeProviderStates(codeMachineOf(machines, machineId, selfUser), configured, keyed.has('gemini'));
  const picks = picksOf(members, selfUser);
  const seatOf = (a: typeof available[number]): SeatView => a.id === answerer?.id
    ? { model: selection.modelId ?? STARTER_MODEL, thinking: engineeringEffort(selection.modelId, selection.reasoningEffort), source: 'thread' }
    : seatView(a, picks);
  return <ComposerAgentControls modelScope="thread" roomSlug={roomSlug} agents={available} answerer={answerer} byDefault={main} states={states}
    seatOf={(a) => seatOf(a as typeof available[number])} disabled={disabled} part={part}
    onAnswer={(name) => {
      const agent = available.find((a) => a.name === name) ?? main;
      if (!agent || agent.id === answerer?.id) return;
      const seat = seatView(agent, picks);
      onChange({ agentId: agent.id, modelId: seat.model, reasoningEffort: engineeringEffort(seat.model, seat.thinking) });
    }}
    onPick={(agent, modelId, effort) => onChange({ agentId: agent.id, modelId, reasoningEffort: engineeringEffort(modelId, effort) })}
    onConnect={openProviderSettings} />;
}
