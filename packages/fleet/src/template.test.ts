import { describe, expect, it } from 'vitest';
import { renderDocs, renderTemplate } from './template.js';

describe('renderTemplate', () => {
  it('substitutes vars strictly', () => {
    expect(renderTemplate('name: ${A}-${B}', { A: 'x', B: 'y' })).toBe('name: x-y');
  });

  it('throws on a missing var — silently-empty manifests are how isolation bugs ship', () => {
    expect(() => renderTemplate('name: ${NOPE}', {})).toThrow(/NOPE/);
  });

  it('drops #optional lines when their value is empty, keeps them otherwise', () => {
    const t = 'a: 1\nrc: ${RC} #optional\nb: 2';
    expect(renderTemplate(t, { RC: '' })).toBe('a: 1\nb: 2');
    expect(renderTemplate(t, { RC: 'gvisor' })).toBe('a: 1\nrc: gvisor\nb: 2');
  });
});

describe('renderDocs', () => {
  it('splits multi-doc yaml and parses objects', () => {
    const docs = renderDocs('apiVersion: v1\nkind: Namespace\nmetadata:\n  name: ${N}\n---\napiVersion: v1\nkind: Secret\nmetadata:\n  name: s\n  namespace: ${N}', { N: 'ws-a' });
    expect(docs.map((d) => d.kind)).toEqual(['Namespace', 'Secret']);
    expect(docs[0]!.metadata.name).toBe('ws-a');
  });
});
