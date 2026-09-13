// Dependency preflight (triage-preflight round): the gate, the coverage split, and the card.
import { describe, expect, it } from 'vitest';
import { checkNeeds, coverageNote, liveConnectors, needBlock, parseNeed, stripNeed, type ConnectorState, type Need } from '../src/needs';

const NEEDS: Need[] = [{ kind: 'connector', min: 1, any: ['x', 'linkedin', 'instagram', 'tiktok'], why: 'the radar reads real conversations' }];
const rows = (...pairs: Array<[string, string]>): ConnectorState[] => pairs.map(([provider, status]) => ({ provider, status }));

describe('checkNeeds — at least one connector, and the run covers every one that is live', () => {
  it('nothing connected ⇒ blocked, with every network on offer', () => {
    const v = checkNeeds(NEEDS, []);
    expect(v.ok).toBe(false);
    expect(v.live).toEqual([]);
    expect(v.missing).toEqual(['x', 'linkedin', 'instagram', 'tiktok']);
  });
  it('X alone ⇒ runs, and LinkedIn is not required (George: optional if x is connected)', () => {
    const v = checkNeeds(NEEDS, rows(['x', 'connected']));
    expect(v.ok).toBe(true);
    expect(v.live).toEqual(['x']);
    expect(v.readable).toEqual(['x']);
    expect(v.unread).toEqual([]);
  });
  it('more than one ⇒ it runs for BOTH, split by what can actually be read', () => {
    const v = checkNeeds(NEEDS, rows(['x', 'connected'], ['linkedin', 'connected']));
    expect(v.live).toEqual(['x', 'linkedin']);
    expect(v.readable).toEqual(['x']);
    expect(v.unread).toEqual(['linkedin']);
  });
  it('only an unreadable connector ⇒ it still runs, for that connector', () => {
    const v = checkNeeds(NEEDS, rows(['linkedin', 'connected']));
    expect(v.ok).toBe(true);
    expect(v.live).toEqual(['linkedin']);
    expect(v.readable).toEqual([]);
  });
  it('a dead grant is NOT live — reauth_required would start a run that fails on its first read', () => {
    expect(checkNeeds(NEEDS, rows(['x', 'reauth_required'])).ok).toBe(false);
    expect(liveConnectors(rows(['x', 'revoked'], ['linkedin', 'connected']))).toEqual(['linkedin']);
  });
  it('an ask with no declared needs is never gated', () => {
    expect(checkNeeds(undefined, []).ok).toBe(true);
  });
});

describe('coverageNote — the run is told how to cover each network', () => {
  it('names the readable ones and forbids numbers on the rest', () => {
    const note = coverageNote(checkNeeds(NEEDS, rows(['x', 'connected'], ['instagram', 'connected'])));
    expect(note).toContain('search_x');
    expect(note).toContain('instagram');
    expect(note).toContain('source:"web"');
  });
});

describe('the nmneed block', () => {
  const data = { channel: 'c1', ask: 'Reply radar', why: 'nothing is connected', connect: ['x' as const, 'linkedin' as const], readable: ['x' as const] };
  it('round-trips and strips', () => {
    const body = `Before I staff this:\n\n${needBlock(data)}`;
    expect(parseNeed(body)!.connect).toEqual(['x', 'linkedin']);
    expect(stripNeed(body)).toBe('Before I staff this:');
  });
  it('a block offering nothing to connect parses as null — no dead-end card', () => {
    expect(parseNeed(needBlock({ ...data, connect: [] }))).toBeNull();
  });
});
