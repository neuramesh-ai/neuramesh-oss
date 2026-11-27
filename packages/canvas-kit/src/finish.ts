import { autoFixSpec, validateSpec, type Spec } from '@json-render/core';

export const MAX_ELEMENTS = 30;

type Element = { type: string; props?: Record<string, unknown>; children?: string[] };
type PropsSchema = { safeParse: (value: unknown) => { success: boolean; data?: unknown } };
/** The part of a json-render catalog that finishSpec reads. */
type Catalog = { data: { components: Record<string, unknown> }; validate: (spec: Spec) => { success: boolean } };

export type FinishedSpec = { canvas: { title: string; spec: Spec } | null; issues: string[] };

/** Repairs and validates a spec against a catalog. An invalid element is removed. A spec with no valid Canvas root is dropped.
 * The spec keeps only the elements the root reaches, in order, at most MAX_ELEMENTS. */
export function finishSpec(input: Spec, catalog: Catalog): FinishedSpec {
  const issues: string[] = [];
  let spec = autoFixSpec(structuredClone(input)).spec as Spec;
  const elements = { ...(spec.elements ?? {}) } as Record<string, Element>;
  const components = catalog.data.components as Record<string, { props: PropsSchema }>;
  for (const [key, element] of Object.entries(elements)) {
    const definition = components[element?.type];
    const parsed = definition?.props.safeParse(element.props ?? {});
    if (!definition || !parsed?.success) { issues.push(`dropped ${key} (${element?.type ?? 'unknown'})`); delete elements[key]; continue; }
    elements[key] = { ...element, props: parsed.data as Record<string, unknown>, children: (element.children ?? []).filter(child => typeof child === 'string') };
  }
  for (const element of Object.values(elements)) element.children = (element.children ?? []).filter(child => child in elements);
  const root = elements[spec.root];
  if (!root || root.type !== 'Canvas') return { canvas: null, issues: [...issues, 'no Canvas root'] };
  // Keep only what the root reaches, in order, and cap the size.
  const kept: typeof elements = {}; const queue = [spec.root];
  while (queue.length && Object.keys(kept).length < MAX_ELEMENTS) { const key = queue.shift()!; if (kept[key]) continue; kept[key] = elements[key]!; queue.push(...(elements[key]!.children ?? [])); }
  for (const element of Object.values(kept)) element.children = (element.children ?? []).filter(child => child in kept);
  spec = { root: spec.root, elements: kept } as Spec;
  const structural = validateSpec(spec);
  if (!structural.valid) issues.push(...structural.issues.map(issue => issue.message));
  const checked = catalog.validate(spec);
  if (!checked.success) return { canvas: null, issues: [...issues, 'catalog validation failed'] };
  return { canvas: { title: String(root.props?.title ?? 'Answer').slice(0, 120), spec }, issues };
}
