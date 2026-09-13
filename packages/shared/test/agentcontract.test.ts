// The pure half of an agent contract: substitution and precedence.
import { describe, expect, it } from 'vitest';
import { composePrompt, resolveInstructions, isLocalOverride } from '../src/agentcontract';

describe('composePrompt', () => {
  it('substitutes what it knows', () => {
    expect(composePrompt('You are ${name} in #${room}.', { name: 'rex', room: 'dev' }))
      .toBe('You are rex in #dev.');
  });

  it('a known-but-empty variable collapses (an optional block that is absent this turn)', () => {
    expect(composePrompt('start${projLine}end', { projLine: '' })).toBe('startend');
    expect(composePrompt('start${projLine}end', { projLine: undefined })).toBe('startend');
  });

  // The failure this guards against: blanking an unknown name silently deletes whichever RULE it
  // sat inside, and the only symptom is an agent quietly not doing something. Left intact, a typo
  // is visible in the prompt and greppable in a log.
  it('leaves an UNKNOWN placeholder intact rather than blanking it', () => {
    expect(composePrompt('a ${typoName} b', { real: 'x' })).toBe('a ${typoName} b');
  });

  it('handles dotted and repeated names', () => {
    expect(composePrompt('${a.b} and ${a.b}', { 'a.b': 'z' })).toBe('z and z');
  });

  it('leaves ordinary prose containing $ or braces alone', () => {
    expect(composePrompt('costs $20 and {braces} survive', {})).toBe('costs $20 and {braces} survive');
  });
});

describe('resolveInstructions — local › baseline › shipped', () => {
  it('the local file always wins', () => {
    expect(resolveInstructions({ local: 'mine', baseline: 'team', shipped: 'factory' })).toBe('mine');
  });

  it('falls through to the synced baseline, then the shipped contract', () => {
    expect(resolveInstructions({ baseline: 'team', shipped: 'factory' })).toBe('team');
    expect(resolveInstructions({ shipped: 'factory' })).toBe('factory');
    expect(resolveInstructions({})).toBe(null);
  });

  // clearing the field asks for the layer BENEATH, not for an agent with no instructions
  it('blank-but-present is not a value', () => {
    expect(resolveInstructions({ local: '   ', baseline: 'team' })).toBe('team');
    expect(resolveInstructions({ local: '', baseline: '', shipped: 'factory' })).toBe('factory');
  });

  it('trims, so trailing newlines from a file edit are not a difference', () => {
    expect(resolveInstructions({ local: '  mine\n' })).toBe('mine');
  });
});

describe('isLocalOverride — drives the overlay’s Reset state', () => {
  it('true only when this machine says something different', () => {
    expect(isLocalOverride('mine', 'factory')).toBe(true);
    expect(isLocalOverride('same', 'same')).toBe(false);
    expect(isLocalOverride('  same \n', 'same')).toBe(false);
    expect(isLocalOverride('', 'factory')).toBe(false);
    expect(isLocalOverride(null, 'factory')).toBe(false);
  });
});
