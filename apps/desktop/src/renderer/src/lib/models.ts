// Model label + provider resolution for the brain/failover cards — extracted from App.tsx (A3b).
import { modelLabel, STARTER_MODEL } from '@neuramesh/shared';
import { MODEL_GROUPS } from './modelcatalog';
import type { ProviderMarkId } from '../brain/providers';
import type { ProviderId } from '../bridge/rows-infra';

export { modelLabel };
export const runtimeForModel = (m: string): string => MODEL_GROUPS.find((g) => g.models.includes(m))?.runtime ?? 'claude-code';

/**
 * Which MARK a model wears. Not the same question as which vendor serves it, and the difference
 * is the whole point of this function.
 *
 * The starter model is catalogued as a gemini model on purpose — the server allow-list, the packs
 * and the pickers all derive from that, and `model-packs.ts` says so explicitly. But it is served
 * from OUR key through the metered proxy, and which model that is will change. So the house brain
 * wears the HOUSE mark: naming this month's supplier on the surface is a claim we would have to
 * un-tell, and it already contradicted the label, which has always read "NeuraMesh Starter".
 *
 * The fallback is the house mark too, not Anthropic's. A model missing from the catalogue used to
 * silently claim to be Anthropic's here (and Google's in ProviderLogo, which took the gemini
 * branch by falling through) — two different wrong vendors for the same unknown string. A neutral
 * mark is the only honest answer to "we do not recognise this".
 */
export const providerIdForModel = (m: string): ProviderMarkId => {
  if (m === STARTER_MODEL) return 'neuramesh';
  return MODEL_GROUPS.find((g) => g.models.includes(m))?.providerId ?? 'neuramesh';
};

/**
 * Which VENDOR must be configured for a model to run — a different question from which mark it
 * wears, which is why it is a different function.
 *
 * `null` means "nobody": the house brain is served by the platform through the metered proxy, so
 * it needs no credential at all. That is precisely what makes it the model a workspace can use
 * with nothing connected, and callers asking "can we serve this?" must read null as YES rather
 * than falling through to a provider check that would demand Google keys for our own brain.
 */
export const vendorForModel = (m: string): ProviderId | null => {
  if (m === STARTER_MODEL) return null;
  return MODEL_GROUPS.find((g) => g.models.includes(m))?.providerId ?? null;
};

/** can this client actually run the model — the house brain always can. */
export const modelServiceable = (m: string, ready: ReadonlySet<string>): boolean => {
  const vendor = vendorForModel(m);
  return vendor === null ? m === STARTER_MODEL : ready.has(vendor);
};
