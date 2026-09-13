// THE COMPOSER'S BRAIN, BEFORE A CONVERSATION EXISTS (George, 2026-09-06: "the brain selector
// should always be available; the starter model by default runs on cloud and doesn't need a
// physical device").
//
// It is the phone's copy of the desktop's brain draft (apps/desktop/src/renderer/src/brain/draft.ts):
// there is nowhere on the server to put a choice until a thread exists, so the pill edits THIS and
// the send that births the thread carries it as `birth_brain`. Sticky, machine-local, never synced
// — the same class of preference as the theme.
//
// It is also the answer to a real refusal. A fresh cloud machine serves no vendor runtime, so the
// claim gate turns rex away with "no machine available to me can serve claude-code" and the
// conversation stops before it starts. The house brain needs no runtime on any box, so picking it
// is the one choice that always works.
import * as SecureStore from 'expo-secure-store';
import { parseBrainOverride, serializeBrainOverride, STARTER_MODEL, type AgentRole, type BrainOverride } from '@neuramesh/shared';

const KEY = 'nm.brainDraft';

/** every role a chat can wake answers on the same pick — a phone picks a BRAIN, not a seating chart */
const ROLES: AgentRole[] = ['orchestrator', 'worker', 'developer', 'reviewer', 'designer', 'architect', 'curator', 'shipper', 'marketer', 'sales'];

/** one model for every role, or null to leave the project's own packs alone */
export function brainOverrideFor(model: string | null): BrainOverride | null {
  if (!model) return null;
  const out: BrainOverride = {};
  for (const r of ROLES) out[r] = model;
  return parseBrainOverride(out);
}

/** the model a stored draft names, or null when it leaves the project's packs alone */
export function modelOfDraft(raw: string | null): string | null {
  const parsed = parseBrainOverride(raw);
  return parsed?.orchestrator ?? null;
}

/** what the send writes into `birth_brain`; null when nothing was picked */
export const serializeBrain = (model: string | null): string | null => serializeBrainOverride(brainOverrideFor(model));

export async function readBrainDraft(): Promise<string | null> {
  try { return modelOfDraft(await SecureStore.getItemAsync(KEY)); } catch { return null; }
}

export async function writeBrainDraft(model: string | null): Promise<void> {
  try {
    const raw = serializeBrain(model);
    if (raw) await SecureStore.setItemAsync(KEY, raw);
    else await SecureStore.deleteItemAsync(KEY);
  } catch { /* the draft simply does not stick */ }
}

export { STARTER_MODEL };
