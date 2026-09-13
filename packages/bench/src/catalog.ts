// The set of models to benchmark, drawn from @neuramesh/shared's single-source catalog — so
// benchmarking a newly released model is: add it to CURRENT_MODELS, then re-run `pnpm bench`.
import { CURRENT_MODELS, MODEL_ID_SET, providerForModel, runtimeForModel, type Provider, type Runtime } from '@neuramesh/shared';
import { isPriced } from './pricing';
import { isLabeled } from './labels';

export interface CatalogModel {
  id: string;
  runtime: Runtime;
  provider: Provider;
}

export function allCurrentModels(): CatalogModel[] {
  const ids = [...CURRENT_MODELS['claude-code'], ...CURRENT_MODELS.codex, ...CURRENT_MODELS.gemini];
  return ids.map((id) => ({ id, runtime: runtimeForModel(id), provider: providerForModel(id) }));
}

/**
 * Every model must carry a price and a label BEFORE the first paid call. A missing price used to
 * cost $0, which wins the value tiebreak outright; a missing label rendered a raw id on the public
 * page. Both were only visible after a run had already spent the money.
 */
function assertPricedAndLabeled(ids: string[]): void {
  const unpriced = ids.filter((id) => !isPriced(id));
  const unlabeled = ids.filter((id) => !isLabeled(id));
  const problems: string[] = [];
  if (unpriced.length) problems.push(`no PRICING row: ${unpriced.join(', ')} (packages/bench/src/pricing.ts)`);
  if (unlabeled.length) problems.push(`no LABELS row: ${unlabeled.join(', ')} (packages/bench/src/labels.ts)`);
  if (problems.length) throw new Error(`cannot benchmark — ${problems.join(' · ')}`);
}

/** Resolve a `--models a,b,c` arg (or 'all'/undefined) to catalog entries, rejecting unknown ids. */
export function resolveModels(arg?: string): CatalogModel[] {
  const ids = !arg || arg === 'all' ? allCurrentModels().map((m) => m.id) : arg.split(',').map((s) => s.trim()).filter(Boolean);
  for (const id of ids) {
    if (!MODEL_ID_SET.has(id)) throw new Error(`unknown model id: "${id}" (not in the @neuramesh/shared catalog)`);
  }
  assertPricedAndLabeled(ids);
  return ids.map((id) => ({ id, runtime: runtimeForModel(id), provider: providerForModel(id) }));
}
