import { describe, it, test, expect } from 'vitest';
import { parseDraftedPosts, parseShowLetters, normalizeDraft } from '../src/content';

test('parseDraftedPosts: a bare array of valid posts, normalized', () => {
  const posts = parseDraftedPosts(JSON.stringify([
    { platform: 'x', body: 'first' },
    { platform: 'LinkedIn', body: '  second  ', mediaUrl: 'https://cdn/x.png' },
  ]));
  expect(posts).toEqual([
    { platform: 'x', body: 'first' },
    { platform: 'linkedin', body: 'second', mediaUrl: 'https://cdn/x.png' },
  ]);
});

test('parseDraftedPosts: accepts a { posts: [...] } wrapper', () => {
  expect(parseDraftedPosts(JSON.stringify({ posts: [{ platform: 'x', body: 'hi' }] }))).toEqual([{ platform: 'x', body: 'hi' }]);
});

test('parseDraftedPosts: drops unsupported platforms and empty bodies', () => {
  const posts = parseDraftedPosts(JSON.stringify([
    { platform: 'snapchat', body: 'unsupported' },
    { platform: 'x', body: '' },
    { platform: 'x', body: '   ' },
    { platform: 'x', body: 'kept' },
  ]));
  expect(posts).toEqual([{ platform: 'x', body: 'kept' }]);
});

test('parseDraftedPosts: ignores a non-http mediaUrl', () => {
  const [p] = parseDraftedPosts(JSON.stringify([{ platform: 'instagram', body: 'b', mediaUrl: 'not-a-url' }]));
  expect(p?.mediaUrl).toBeUndefined();
});

test('parseDraftedPosts: malformed / empty input yields no posts, never throws', () => {
  expect(parseDraftedPosts('not json')).toEqual([]);
  expect(parseDraftedPosts('')).toEqual([]);
  expect(parseDraftedPosts('{}')).toEqual([]);
  expect(parseDraftedPosts('[1, "x", null, {}]')).toEqual([]);
});

test('parseDraftedPosts: caps the count', () => {
  const many = Array.from({ length: 50 }, () => ({ platform: 'x', body: 'b' }));
  expect(parseDraftedPosts(JSON.stringify(many), 5)).toHaveLength(5);
});

// The real shape seen in #1026: the model stuffed its working notes into the body, so the text
// would have PUBLISHED verbatim and the card counted 410/280 for a ~196-char post.
test('parseDraftedPosts: strips working notes from the body and keeps the image brief', () => {
  const body = [
    "Body's exhausted. Mind's still sprinting through tomorrow's meeting.",
    '',
    'flowe is a quiet way through it.',
    '',
    'Image brief: A single warm-gold lamp glowing in a dark room past midnight.',
    'Character count: 196/280',
    '(draft only, holding for approval)',
  ].join('\n');
  const [p] = parseDraftedPosts(JSON.stringify([{ platform: 'x', body }]));
  expect(p?.body).toBe("Body's exhausted. Mind's still sprinting through tomorrow's meeting.\n\nflowe is a quiet way through it.");
  expect(p?.body).not.toMatch(/character count|draft only|image brief/i);
  expect(p?.imageBrief).toBe('A single warm-gold lamp glowing in a dark room past midnight.');
});

test('parseDraftedPosts: an explicit imageBrief field wins over one parsed from the body', () => {
  const [p] = parseDraftedPosts(JSON.stringify([{ platform: 'x', body: 'hi\nImage brief: from body', imageBrief: 'declared' }]));
  expect(p?.imageBrief).toBe('declared');
  expect(p?.body).toBe('hi');
});

test('parseDraftedPosts: an entry that is ONLY working notes is dropped', () => {
  expect(parseDraftedPosts(JSON.stringify([{ platform: 'x', body: 'Character count: 10/280\n(draft only, holding for approval)' }]))).toEqual([]);
});

import { parseDraftRevisions } from '../src/content';

test('parseDraftRevisions: keys by letter, accepts #n·x / "draft a" forms', () => {
  const revs = parseDraftRevisions(JSON.stringify([
    { letter: 'a', body: 'punchier open' },
    { letter: '#1027·b', body: 'tighter', imageBrief: 'a warm lamp' },
    { letter: 'draft C', imageBrief: 'a notebook' },
  ]));
  expect(revs).toEqual([
    { letter: 'a', body: 'punchier open' },
    { letter: 'b', body: 'tighter', imageBrief: 'a warm lamp' },
    { letter: 'c', imageBrief: 'a notebook' },
  ]);
});

test('parseDraftRevisions: a { revisions: [...] } wrapper, and body working-notes stripped', () => {
  const revs = parseDraftRevisions(JSON.stringify({ revisions: [{ letter: 'a', body: 'new copy\nCharacter count: 40/280' }] }));
  expect(revs).toEqual([{ letter: 'a', body: 'new copy' }]);
});

test('parseDraftRevisions: drops entries with no letter, no change, or a duplicate letter', () => {
  const revs = parseDraftRevisions(JSON.stringify([
    { body: 'no letter' },
    { letter: 'a' },                 // nothing to change
    { letter: 'b', body: 'first b' },
    { letter: 'b', body: 'dup b' },  // duplicate letter dropped
  ]));
  expect(revs).toEqual([{ letter: 'b', body: 'first b' }]);
});

test('parseDraftRevisions: malformed input yields none, never throws', () => {
  expect(parseDraftRevisions('not json')).toEqual([]);
  expect(parseDraftRevisions('{}')).toEqual([]);
  expect(parseDraftRevisions('[1,"x",null]')).toEqual([]);
});

// The SHOW verb (live #1048): the marketer names letters, the thread re-anchors those cards.
// Before this the contract had one verb — "change this" — so "show me the drafts" left the model
// nothing to do but retype all three posts beside the cards already rendering them.
describe('parseShowLetters', () => {
  it('reads the plain comma list the contract asks for', () => {
    expect(parseShowLetters('a, b, c')).toEqual(['a', 'b', 'c']);
  });

  it('accepts the shapes a model actually reaches for', () => {
    expect(parseShowLetters('a b c')).toEqual(['a', 'b', 'c']);
    expect(parseShowLetters('["a","c"]')).toEqual(['a', 'c']);
    expect(parseShowLetters('#1048·a, #1048·b')).toEqual(['a', 'b']);
    expect(parseShowLetters('A, B')).toEqual(['a', 'b']);
  });

  it('de-duplicates and keeps the order given', () => {
    expect(parseShowLetters('c, a, c, a')).toEqual(['c', 'a']);
  });

  it('drops anything that is not a draft letter rather than guessing', () => {
    expect(parseShowLetters('all of them')).toEqual([]);
    expect(parseShowLetters('')).toEqual([]);
    expect(parseShowLetters('the first two')).toEqual([]);
  });
});

// normalizeDraft — the tool path (draft_posts / revise_posts). It is the SAME cleaner
// parseDraftedPosts runs, and these prove it: a post handed over as tool arguments must be
// stripped exactly like one written into posts.json, or the two surfaces drift and a
// "Character count: 196/280" footer publishes from one door but not the other.
test('normalizeDraft: strips working notes from the body, exactly as the file path does', () => {
  const raw = 'The real post text.\nCharacter count: 196/280\n(draft only, holding for approval)';
  expect(normalizeDraft({ platform: 'x', body: raw })).toEqual({ platform: 'x', body: 'The real post text.' });
  expect(parseDraftedPosts(JSON.stringify([{ platform: 'x', body: raw }]))).toEqual([normalizeDraft({ platform: 'x', body: raw })]);
});

test('normalizeDraft: lifts an inline image brief out of the body', () => {
  expect(normalizeDraft({ platform: 'instagram', body: 'Ship day.\nImage brief: warm gold key light on near-black' }))
    .toEqual({ platform: 'instagram', body: 'Ship day.', imageBrief: 'warm gold key light on near-black' });
});

test('normalizeDraft: an explicit imageBrief wins over one found in the body', () => {
  const p = normalizeDraft({ platform: 'x', body: 'Post.\nImage brief: inline one', imageBrief: 'declared one' });
  expect(p?.imageBrief).toBe('declared one');
});

test('normalizeDraft: null for an unsupported platform, a blank body, or notes-only text', () => {
  expect(normalizeDraft({ platform: 'snapchat', body: 'hi' })).toBeNull();
  expect(normalizeDraft({ platform: 'x', body: '   ' })).toBeNull();
  expect(normalizeDraft({ platform: 'x', body: '(draft only, holding for approval)' })).toBeNull();
});

test('normalizeDraft: keeps a real http mediaUrl and drops anything else', () => {
  expect(normalizeDraft({ platform: 'x', body: 'b', mediaUrl: 'https://cdn/x.png' })?.mediaUrl).toBe('https://cdn/x.png');
  expect(normalizeDraft({ platform: 'x', body: 'b', mediaUrl: 'not-a-url' })?.mediaUrl).toBeUndefined();
});

test('normalizeDraft: platform defaults to x when the caller omits it', () => {
  expect(normalizeDraft({ body: 'no platform named' })).toEqual({ platform: 'x', body: 'no platform named' });
});
