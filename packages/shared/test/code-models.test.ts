// The code model rules (code-models.ts): a coding conversation runs its own pick, else the NeuraMesh brain,
// and its menu reads the one machine the session runs on, where a Google sign-in never runs code.
import { describe, expect, it } from 'vitest';
import { CODE_GEMINI_NOTE, codeFootText, codeMachineOf, codeModelOf, codeProviderStates, codeRunsHere, codeVendorOf, machineRuntimeList } from '../src/code-models';
import { STARTER_MODEL } from '../src/rates';

const me = 'u-ana';
const cloud = { id: 'm-cloud', owner_user_id: me, kind: 'member', runtimes: JSON.stringify(['claude-code', 'gemini']) };
const laptop = { id: 'm-mac', owner_user_id: me, kind: 'local', runtimes: JSON.stringify(['codex']) };
const theirs = { id: 'm-bo', owner_user_id: 'u-bo', kind: 'member', runtimes: JSON.stringify(['codex']) };

describe('codeModelOf', () => {
  it('runs the pick, and with no pick the NeuraMesh brain, never the developer seat', () => {
    expect(codeModelOf(null)).toBe(STARTER_MODEL);
    expect(codeModelOf(undefined)).toBe(STARTER_MODEL);
    expect(codeModelOf('')).toBe(STARTER_MODEL);
    expect(codeModelOf('claude-opus-5')).toBe('claude-opus-5');
  });
});

describe('codeMachineOf', () => {
  it('takes the machine the session names, else the person\'s own cloud machine', () => {
    expect(codeMachineOf([laptop, cloud], 'm-mac', me)?.id).toBe('m-mac');
    expect(codeMachineOf([laptop, cloud], null, me)?.id).toBe('m-cloud');
    expect(codeMachineOf([theirs], null, me)).toBeNull();
  });
});

describe('codeProviderStates', () => {
  const configured = new Set(['anthropic', 'openai', 'gemini']);
  it('reads the session\'s one machine, and Gemini runs code only on an API key', () => {
    expect(codeProviderStates(cloud, configured, false)).toEqual({ anthropic: 'ready', openai: 'signin', gemini: 'connect' });
    expect(codeProviderStates(cloud, configured, true)).toEqual({ anthropic: 'ready', openai: 'signin', gemini: 'ready' });
    // the laptop beside it does not make the cloud session's ChatGPT ready: only the session's machine counts
    expect(codeProviderStates(laptop, configured, true)).toEqual({ anthropic: 'signin', openai: 'ready', gemini: 'connect' });
  });
  it('with no machine nothing runs, and a provider set up asks for a sign-in', () => {
    expect(codeProviderStates(null, new Set(['anthropic']), false)).toEqual({ anthropic: 'signin', openai: 'connect', gemini: 'connect' });
  });
  it('reads a bad runtimes column as no runtimes', () => {
    expect(machineRuntimeList({ runtimes: 'not json' })).toEqual([]);
    expect(machineRuntimeList({ runtimes: JSON.stringify(['codex', 7]) })).toEqual(['codex']);
  });
});

describe('codeRunsHere and the foot', () => {
  const states = codeProviderStates(cloud, new Set(['gemini']), false);
  it('the NeuraMesh brain always runs, a provider runs when the machine serves it', () => {
    expect(codeVendorOf(STARTER_MODEL)).toBeNull();
    expect(codeRunsHere(STARTER_MODEL, states)).toBe(true);
    expect(codeRunsHere('claude-opus-5', states)).toBe(true);
    expect(codeRunsHere('gemini-3.1-pro-preview', states)).toBe(false);
  });
  it('says why a model cannot run code here, else what a pick does', () => {
    expect(codeFootText('gemini-3.1-pro-preview', states, 'session')).toBe('Gemini cannot run code on this machine. Pick another model.');
    expect(codeFootText('claude-opus-5', states, 'session')).toBe('This session runs on this model. A pick here changes it.');
    expect(codeFootText(STARTER_MODEL, states, 'start')).toBe('The session starts on this model. With no pick, it runs on the NeuraMesh brain.');
    expect(CODE_GEMINI_NOTE).not.toMatch(/[—;]/);
  });
});
