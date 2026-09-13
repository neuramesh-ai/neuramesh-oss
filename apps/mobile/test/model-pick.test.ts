// The model sheet's two rules (the mobile fix round, 2026-09-06). The chip must never claim a model
// is available when its provider is not connected, and a row must not carry a line that repeats its
// own name (CLAUDE.md #11).
import { STARTER_MODEL, projectDeveloperModel } from '@neuramesh/shared';
import { describe, expect, it } from 'vitest';
import { modelNote, modelReady } from '../src/model-pick';

describe('modelReady', () => {
  it('offers the house brain with no credential of yours', () => {
    expect(modelReady(STARTER_MODEL, new Set())).toBe(true);
  });
  it('gates every other model on its own provider', () => {
    expect(modelReady('claude-sonnet-5', new Set())).toBe(false);
    expect(modelReady('claude-sonnet-5', new Set(['anthropic']))).toBe(true);
    expect(modelReady('gpt-5.5', new Set(['anthropic']))).toBe(false);
    expect(modelReady('gpt-5.5', new Set(['openai']))).toBe(true);
  });
});

describe('modelNote', () => {
  it('says why a model cannot be picked', () => {
    expect(modelNote('gpt-5.5', 'ChatGPT', false, false)).toBe('Connect ChatGPT in Keys to use this');
  });
  it('says nothing under a name that already says it all', () => {
    expect(modelNote('claude-sonnet-5', 'Claude', true, false)).toBe('');
  });
  it('marks the inherited default and the metered house brain', () => {
    expect(modelNote('claude-sonnet-5', 'Claude', true, true)).toBe("The project's default");
    expect(modelNote(STARTER_MODEL, 'NeuraMesh', true, false)).toBe('Included, metered by credits');
  });
});

describe('the inherited default', () => {
  const seat = (name: string, model: string, model_source = 'pack') => ({ name, model, model_source, role: 'developer', kind: 'local', retired_at: null });
  it('is the developer seat the machine would resolve, not the starter brain', () => {
    expect(projectDeveloperModel(null, null, [seat('patch', 'claude-opus-4-8')])).toBe('claude-opus-4-8');
  });
  it('falls back to the house brain when the workspace has no developer', () => {
    expect(projectDeveloperModel(null, null, [])).toBe(STARTER_MODEL);
  });
  it('lets the machine answer for itself once a session is connected', () => {
    expect(projectDeveloperModel('claude-sonnet-5', null, [seat('patch', 'claude-opus-4-8')])).toBe('claude-sonnet-5');
  });
});
