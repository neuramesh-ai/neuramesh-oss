// THE MODEL SHEET'S TWO RULES, kept pure so a Node test can load them (the mobile fix round,
// 2026-09-06). `model-chip.tsx` imports React Native, which vitest cannot resolve here — the same
// split `session-page.ts` and `repo-url.ts` already use.
import { STARTER_MODEL, providerForModel } from '@neuramesh/shared';

/** the house brain needs no credential of yours; every other model needs its provider connected */
export function modelReady(model: string, connected: ReadonlySet<string>): boolean {
  return model === STARTER_MODEL || connected.has(providerForModel(model));
}

/** the one line under a model's name, or nothing when the name already says it all */
export function modelNote(model: string, group: string, ready: boolean, inherited: boolean): string {
  if (!ready) return `Connect ${group} in Keys to use this`;
  if (model === STARTER_MODEL) return 'Included, metered by credits';
  return inherited ? "The project's default" : '';
}
