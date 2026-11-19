import { describe, expect, it } from 'vitest';
import { intakeOf, INTAKE_KINDS } from '../src/intake';

const stored = (kind: string) => JSON.stringify({ v: 1, kind, confidence: 0.9, title: 'Launch email', name: 'launch-email', plan: ['Draft it'], subtasks: [], workspace: 'none', source: 'starter' });

describe('intake kinds', () => {
  it('has a marketing kind and a finance kind, and no content kind', () => {
    expect(INTAKE_KINDS).toContain('marketing');
    expect(INTAKE_KINDS).toContain('finance');
    expect(INTAKE_KINDS).not.toContain('content');
  });

  it('reads a decision stored as content as marketing', () => {
    expect(intakeOf(stored('content'))?.kind).toBe('marketing');
  });

  it('reads marketing and finance as they are, and refuses an unknown kind', () => {
    expect(intakeOf(stored('marketing'))?.kind).toBe('marketing');
    expect(intakeOf(stored('finance'))?.kind).toBe('finance');
    expect(intakeOf(stored('sales'))).toBeNull();
  });
});
