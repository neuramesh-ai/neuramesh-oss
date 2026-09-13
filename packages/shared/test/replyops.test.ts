// Reply opportunities (reply-radar round): the shape guard, the block round-trip, and the
// in-place revision that keeps a row's letter.
import { describe, expect, it } from 'vitest';
import { REPLIES_CAP, applyReplyRevision, cleanReplies, parseReplies, repliesBlock, stripReplies } from '../src/replyops';

const target = { handle: '@austinxwalker', name: 'Austin Walker', url: 'https://x.com/austinxwalker/status/1', platform: 'x' as const, source: 'connector' as const, text: 'what is your reset?', age: '14h', metrics: { impressions: 4164, likes: 58 } };

describe('cleanReplies — a row without a target post is not a reply opportunity', () => {
  it('drops rows missing a handle, link, target text or draft', () => {
    const items = cleanReplies([
      { letter: 'a', target, draft: 'walk hard, lift light' },
      { target: { ...target, url: 'not-a-url' }, draft: 'x' },
      { target: { ...target, text: '' }, draft: 'x' },
      { target, draft: '   ' },
      { target: { ...target, handle: '' }, draft: 'x' },
      null,
      'nope',
    ]);
    expect(items.length).toBe(1);
    expect(items[0]!.letter).toBe('A');
    expect(items[0]!.target.handle).toBe('austinxwalker'); // the @ is the card's, not the data's
  });
  it('assigns letters when the model omits them, and caps the list', () => {
    const items = cleanReplies(Array(20).fill({ target, draft: 'reply' }));
    expect(items.length).toBe(REPLIES_CAP);
    expect(items.map((i) => i.letter).slice(0, 3)).toEqual(['A', 'B', 'C']);
  });
  it('keeps only real metric numbers — a string or a negative is dropped, not coerced', () => {
    const [it0] = cleanReplies([{ target: { ...target, metrics: { impressions: '4k', likes: -2, reposts: 11 } }, draft: 'r' }]);
    expect(it0!.target.metrics).toEqual({ impressions: undefined, likes: undefined, reposts: 11, replies: undefined });
  });
});

describe('cleanReplies — every ready network, honest about what was measured', () => {
  it('keeps a LinkedIn row and defaults an unknown platform to x', () => {
    const items = cleanReplies([
      { target: { ...target, platform: 'linkedin', url: 'https://linkedin.com/posts/1' }, draft: 'a considered take' },
      { target: { ...target, platform: 'myspace' }, draft: 'r' },
    ]);
    expect(items.map((i) => i.target.platform)).toEqual(['linkedin', 'x']);
  });
  it('a web-found row can NEVER carry metrics — only a connector read measures reach', () => {
    const [web] = cleanReplies([{ target: { ...target, platform: 'linkedin', source: 'web', metrics: { impressions: 9000 } }, draft: 'r' }]);
    expect(web!.target.source).toBe('web');
    expect(web!.target.metrics).toBeUndefined();
  });
});

describe('the nmreply block round-trip', () => {
  const data = { report: 'engage-report-2026-08-22.md', channel: 'ch1', baseline: 'your posts: 1–12 impressions', items: [{ letter: 'A', target, draft: 'walk hard' }] };
  it('parses what it writes; prose survives the strip', () => {
    const body = `Six worth joining:\n\n${repliesBlock(data)}`;
    const parsed = parseReplies(body)!;
    expect(parsed.report).toBe(data.report);
    expect(parsed.baseline).toBe(data.baseline);
    expect(parsed.items[0]!.target.url).toBe(target.url);
    expect(stripReplies(body)).toBe('Six worth joining:');
  });
  it('a block with no valid rows parses as null — no empty card ever renders', () => {
    expect(parseReplies(repliesBlock({ ...data, items: [] }))).toBeNull();
    expect(parseReplies('no block here')).toBeNull();
  });
});

describe('applyReplyRevision — the row keeps its letter and its place', () => {
  const items = cleanReplies([{ letter: 'A', target, draft: 'first' }, { letter: 'B', target, draft: 'second' }]);
  it('rewrites one row in place, leaving the rest untouched', () => {
    const next = applyReplyRevision(items, { letter: 'b', draft: 'rewritten' })!;
    expect(next.map((i) => i.letter)).toEqual(['A', 'B']);
    expect(next[1]!.draft).toBe('rewritten');
    expect(next[0]!.draft).toBe('first');
  });
  it('attaches a drawn image without touching the text', () => {
    const next = applyReplyRevision(items, { letter: 'A', imageArtifactId: 'art-1', imageBrief: 'warm gold key light' })!;
    expect(next[0]).toMatchObject({ draft: 'first', imageArtifactId: 'art-1', imageBrief: 'warm gold key light' });
  });
  it('returns null for a letter no row carries — the tool reports it instead of adding a row', () => {
    expect(applyReplyRevision(items, { letter: 'z', draft: 'x' })).toBeNull();
  });
});
