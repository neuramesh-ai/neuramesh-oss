import { defineCatalog } from '@json-render/core';
import { schema } from '@json-render/react/schema';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { applySpecPatch, createSpecStreamParser, emptySpec, finishSpec, followUps, followUpsOf, kpiTile, MAX_ELEMENTS, text } from '../src';

// A small catalog of the kind each desk builds: its own Canvas, plus the shared components.
const catalog = defineCatalog(schema, {
  components: {
    Canvas: { props: z.object({ title: text(120) }), slots: ['default'], description: 'The root.' },
    KpiTile: kpiTile,
    FollowUps: followUps,
  },
  actions: {},
});

const lines = (ops: object[]) => ops.map(op => JSON.stringify(op)).join('\n');
const el = (type: string, props: object, children: string[] = []) => ({ type, props, children });

function specOf(ops: object[]) {
  const spec = emptySpec();
  const parser = createSpecStreamParser({ onText: () => {}, onPatch: patch => applySpecPatch(spec, patch) });
  parser.push(`Text.\n\`\`\`spec\n${lines(ops)}\n\`\`\`\n`); parser.end();
  return spec;
}

describe('finishSpec', () => {
  it('keeps valid shared components and drops a type the catalog does not have', () => {
    const spec = specOf([
      { op: 'add', path: '/root', value: 'root' },
      { op: 'add', path: '/elements/root', value: el('Canvas', { title: 'Drafts this week' }, ['kpi', 'bad', 'next']) },
      { op: 'add', path: '/elements/kpi', value: el('KpiTile', { label: 'Drafts', value: 3, format: 'number' }) },
      { op: 'add', path: '/elements/bad', value: el('Script', { src: 'x' }) },
      { op: 'add', path: '/elements/next', value: el('FollowUps', { items: [{ label: 'Shorter', prompt: 'Make them shorter' }] }) },
    ]);
    const finished = finishSpec(spec, catalog);
    expect(finished.canvas?.title).toBe('Drafts this week');
    expect(Object.keys(finished.canvas!.spec.elements)).toEqual(['root', 'kpi', 'next']);
    expect(finished.issues).toContain('dropped bad (Script)');
  });

  it('drops a spec with no Canvas root', () => {
    const spec = specOf([{ op: 'add', path: '/root', value: 'kpi' }, { op: 'add', path: '/elements/kpi', value: el('KpiTile', { label: 'Drafts', value: 3, format: 'number' }) }]);
    expect(finishSpec(spec, catalog).canvas).toBeNull();
  });

  it('keeps at most MAX_ELEMENTS elements', () => {
    const keys = Array.from({ length: MAX_ELEMENTS + 5 }, (_, i) => `k${i}`);
    const spec = specOf([
      { op: 'add', path: '/root', value: 'root' },
      { op: 'add', path: '/elements/root', value: el('Canvas', { title: 'Many' }, keys) },
      ...keys.map(key => ({ op: 'add', path: `/elements/${key}`, value: el('KpiTile', { label: key, value: 1, format: 'number' }) })),
    ]);
    expect(Object.keys(finishSpec(spec, catalog).canvas!.spec.elements)).toHaveLength(MAX_ELEMENTS);
  });
});

describe('followUpsOf', () => {
  it('reads the FollowUps items of a spec, at most three', () => {
    const spec = { root: 'c', elements: {
      c: el('Canvas', { title: 'T' }, ['k', 'f']),
      k: el('KpiTile', { label: 'Posts', value: 3 }),
      f: el('FollowUps', { items: [{ label: 'Shorter', prompt: 'Make them shorter.' }, { label: 'Shorter', prompt: 'Again.' }, { label: '', prompt: 'x' }, { label: 'One more', prompt: 'Write one more.' }] }),
    } };
    expect(followUpsOf(spec as never)).toEqual([{ label: 'Shorter', prompt: 'Make them shorter.' }, { label: 'One more', prompt: 'Write one more.' }]);
  });
  it('returns nothing for no spec or no FollowUps', () => {
    expect(followUpsOf(null)).toEqual([]);
    expect(followUpsOf({ root: 'c', elements: { c: el('Canvas', { title: 'T' }) } } as never)).toEqual([]);
  });
});
