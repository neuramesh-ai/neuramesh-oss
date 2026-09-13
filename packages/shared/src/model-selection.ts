// WHICH BRAIN A CODE SESSION INHERITS (moved into shared, the mobile fix round 2026-09-06).
//
// A Code session that picks no model runs the project's DEVELOPER seat. Every client that draws a
// model selector has to say which model that is, or the selector shows a default it made up. This
// lived in the desktop renderer, so the phone had nothing to read and showed the starter brain for
// every project. It is the same derivation on both, mirroring the machine-side
// `resolveEngineeringBrain` ordering: the machine stays authoritative when the turn opens.
import { seatModel, type CustomModelPack } from './model-packs';
import { STARTER_MODEL } from './rates';

export interface DeveloperSeat {
  name: string;
  role: string | null;
  model: string | null;
  model_source?: string | null;
  kind?: string | null;
  retired_at?: string | null;
}

/** the developer seat a Code session runs on: patch first, then a hand-set model, then by name */
export function preferredDeveloperSeat(agents: readonly DeveloperSeat[]): DeveloperSeat | null {
  return agents
    .filter((agent) => agent.role === 'developer' && agent.retired_at == null && (agent.kind ?? 'local') !== 'remote')
    .slice()
    .sort((a, b) => {
      const patch = Number(a.name.toLowerCase() !== 'patch') - Number(b.name.toLowerCase() !== 'patch');
      if (patch !== 0) return patch;
      const manual = Number(a.model_source !== 'manual') - Number(b.model_source !== 'manual');
      return manual !== 0 ? manual : a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    })[0] ?? null;
}

/** the model "the project's default" names, before a Code session has connected */
export function projectDeveloperModel(
  sessionModel: string | null | undefined,
  projectPack: string | null | undefined,
  agents: readonly DeveloperSeat[],
  customPacks: readonly CustomModelPack[] = [],
): string {
  if (sessionModel) return sessionModel;
  const seat = preferredDeveloperSeat(agents);
  return seatModel({
    role: 'developer',
    currentModel: seat?.model || STARTER_MODEL,
    modelSource: seat?.model_source ?? undefined,
    projectPack,
    custom: customPacks,
  });
}
