// A person's model for each agent (agent-models.ts, 0148): the synced column reads tolerantly, a level
// rides only a model that takes one, and seatModel puts the requester's pick below the conversation's
// own word and above every workspace-wide default.
import { describe, expect, it } from 'vitest';
import { levelFor, parseAgentModels, pickFor, takesThinking, thinkingFor, thinkingLevelsFor } from '../src/agent-models';
import { PACKS, seatModel } from '../src/model-packs';
import { STARTER_MODEL } from '../src/rates';

describe('takesThinking', () => {
  it('Claude and GPT take a level, Gemini from 3 up except Flash-Lite, the NeuraMesh brain never', () => {
    expect(takesThinking('claude-sonnet-5')).toBe(true);
    expect(takesThinking('gpt-5.6-terra')).toBe(true);
    expect(takesThinking('gemini-3.8-flash')).toBe(true);
    expect(takesThinking('gemini-4-carbon')).toBe(true);
    expect(takesThinking('gemini-4-neon')).toBe(true);
    expect(takesThinking('gemini-4-hydrogen')).toBe(true);
    expect(takesThinking('gemini-3.1-pro-preview')).toBe(true);
    expect(takesThinking('gemini-3.1-flash-lite')).toBe(false);
    expect(takesThinking('gemini-2.5-pro')).toBe(false);
    expect(takesThinking(STARTER_MODEL)).toBe(false);
    expect(takesThinking(null)).toBe(false);
  });
});

describe('thinkingLevelsFor', () => {
  it('Neon and Hydrogen add Extra high, every other model that thinks stops at High', () => {
    expect(thinkingLevelsFor('gemini-4-neon')).toEqual(['low', 'medium', 'high', 'xhigh']);
    expect(thinkingLevelsFor('gemini-4-hydrogen')).toEqual(['low', 'medium', 'high', 'xhigh']);
    for (const m of ['gemini-4-carbon', 'gemini-4-argon', 'gemini-3.8-flash', 'claude-opus-5-5', 'gpt-6-astra']) {
      expect(thinkingLevelsFor(m), m).toEqual(['low', 'medium', 'high']);
    }
    expect(thinkingLevelsFor('gemini-3.1-flash-lite')).toEqual([]);
    expect(thinkingLevelsFor(STARTER_MODEL)).toEqual([]);
  });
  it('levelFor keeps a level the model takes and lowers Extra high to the model\'s top level', () => {
    expect(levelFor('gemini-4-neon', 'xhigh')).toBe('xhigh');
    expect(levelFor('gemini-4-carbon', 'xhigh')).toBe('high');
    expect(levelFor('gemini-4-carbon', 'low')).toBe('low');
    expect(levelFor(STARTER_MODEL, 'high')).toBeNull();
    expect(levelFor('gemini-4-neon', null)).toBeNull();
  });
});

describe('parseAgentModels', () => {
  it('reads the jsonb object and the replica\'s JSON text the same way', () => {
    const raw = { a1: { model: 'claude-opus-5', thinking: 'high' } };
    expect(parseAgentModels(raw)).toEqual(raw);
    expect(parseAgentModels(JSON.stringify(raw))).toEqual(raw);
  });
  it('drops an unknown model, a bad level, and a level the model does not take', () => {
    expect(parseAgentModels({
      a1: { model: 'claude-opus-99', thinking: 'high' },
      a2: { model: 'claude-opus-5', thinking: 'turbo' },
      a3: { model: STARTER_MODEL, thinking: 'high' },
      a4: 'claude-opus-5',
    })).toEqual({ a2: { model: 'claude-opus-5' }, a3: { model: STARTER_MODEL } });
  });
  it('keeps Extra high on a model that takes it and drops it on one that does not', () => {
    expect(parseAgentModels({ a1: { model: 'gemini-4-neon', thinking: 'xhigh' }, a2: { model: 'gemini-4-carbon', thinking: 'xhigh' } }))
      .toEqual({ a1: { model: 'gemini-4-neon', thinking: 'xhigh' }, a2: { model: 'gemini-4-carbon' } });
  });
  it('nothing, garbage and an array all read as no pick', () => {
    expect(parseAgentModels(null)).toEqual({});
    expect(parseAgentModels('{not json')).toEqual({});
    expect(parseAgentModels([{ model: 'claude-opus-5' }])).toEqual({});
    expect(pickFor(null, 'a1')).toBeNull();
  });
});

describe('thinkingFor', () => {
  const pick = { model: 'claude-opus-5', thinking: 'low' as const };
  it('gives the person\'s level when the run takes the picked model', () => {
    expect(thinkingFor('claude-opus-5', pick)).toBe('low');
  });
  it('gives nothing when the run takes another model (a conversation\'s override), or no level is set', () => {
    expect(thinkingFor(STARTER_MODEL, pick)).toBeNull();
    expect(thinkingFor('claude-sonnet-5', pick)).toBeNull();
    expect(thinkingFor('claude-opus-5', { model: 'claude-opus-5' })).toBeNull();
    expect(thinkingFor('claude-opus-5', null)).toBeNull();
  });
});

describe('seatModel with the requester\'s pick', () => {
  const dev = { role: 'developer' as const, currentModel: 'claude-sonnet-5' };
  it('the pick beats a manual pin, a project pack and the workspace default', () => {
    expect(seatModel({ ...dev, memberPick: 'gpt-5.6-terra' })).toBe('gpt-5.6-terra');
    expect(seatModel({ ...dev, modelSource: 'manual', memberPick: 'gpt-5.6-terra' })).toBe('gpt-5.6-terra');
    const pack = Object.keys(PACKS)[0]!;
    expect(seatModel({ ...dev, projectPack: pack, memberPick: 'gpt-5.6-terra' })).toBe('gpt-5.6-terra');
  });
  it('the conversation\'s own word beats the pick', () => {
    expect(seatModel({ ...dev, memberPick: 'gpt-5.6-terra', threadOverride: { developer: STARTER_MODEL } })).toBe(STARTER_MODEL);
  });
  it('no pick leaves the old order exactly as it was', () => {
    expect(seatModel({ ...dev, memberPick: null })).toBe('claude-sonnet-5');
    expect(seatModel({ ...dev, modelSource: 'manual', memberPick: null })).toBe('claude-sonnet-5');
  });
});
