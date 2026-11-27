import type { Spec } from '@json-render/core';

export type NextAsk = { label: string; prompt: string };

/** The FollowUps of a spec, in order. The chat column shows them beside the composer, so a canvas draws no FollowUps card. */
export function followUpsOf(spec: Spec | null | undefined): NextAsk[] {
  if (!spec) return [];
  const out: NextAsk[] = [];
  for (const el of Object.values(spec.elements ?? {})) {
    if (el?.type !== 'FollowUps') continue;
    const items = (el.props as { items?: unknown } | undefined)?.items;
    if (!Array.isArray(items)) continue;
    for (const it of items) {
      const { label, prompt } = (it ?? {}) as Partial<NextAsk>;
      if (typeof label === 'string' && typeof prompt === 'string' && label.trim() && prompt.trim() && !out.some((o) => o.label === label)) out.push({ label, prompt });
    }
  }
  return out.slice(0, 3);
}
