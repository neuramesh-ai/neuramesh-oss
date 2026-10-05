// THE CODE MODEL CHIP (George, 2026-10-04: "use the same model selector our main composer uses"): the main
// composer's chip and menu (ModelChipView) on a coding session. Its providers are the session's one machine
// (shared code-models.ts), its menu has no thinking levels (the coding runtime takes none), and a pick is the
// session's own: the coding composer sends it to the machine, and a composer with a repository picked starts
// the session on it.
import { CODE_GEMINI_NOTE, codeFootText, codeMachineOf, codeModelOf, codeProviderStates, codeRunsHere, modelLabel } from '@neuramesh/shared';
import { openProviderSettings } from '../lib/toast';
import { selfMachine, selfUser } from '../lib/self';
import { useCredentialSets } from './hooks';
import { ModelChipView } from './ModelChip';
import { chipLabel } from './picks';
import { useModelRoster } from './roster';

const NOTES = { gemini: CODE_GEMINI_NOTE };

export function CodeModelChip({ pick, machineId, place, onPick, disabled }: {
  /** the session's own pick: null runs the NeuraMesh brain */
  pick: string | null;
  /** the machine the session runs on: null is the person's own cloud machine, else this Mac */
  machineId: string | null;
  /** 'start': a composer with a repository picked, before the session exists */
  place: 'session' | 'start';
  onPick: (model: string) => void;
  disabled?: boolean;
}) {
  const { machines } = useModelRoster();
  const { configured, keyed } = useCredentialSets();
  // the desktop routes a session that names no machine to the relay where one exists, else to this Mac
  // (bridge/desktop-relay.ts): with no cloud machine of the person's own, the session runs here
  const machine = codeMachineOf(machines, machineId, selfUser) ?? machines.find((m) => m.name === selfMachine) ?? null;
  const states = codeProviderStates(machine, configured, keyed.has('gemini'));
  const model = codeModelOf(pick);
  const label = chipLabel(modelLabel(model));
  return (
    <ModelChipView model={model} level={null} states={states} cannot={!codeRunsHere(model, states)} thinking={false} notes={NOTES}
      tip={place === 'start' ? `The session starts on ${label}` : `This session runs on ${label}`} menuLabel="Model for this session"
      head={<div className="cprojhint cmodhead"><b>Model</b><span>for this session</span></div>} foot={codeFootText(model, states, place)}
      onPick={(m) => onPick(m)} onConnect={(p) => openProviderSettings(p)} disabled={disabled} />
  );
}
