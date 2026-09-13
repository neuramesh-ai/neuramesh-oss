import { describe, expect, it } from 'vitest';
import { addressedIn, bareAddressRe, humanHandles, mentionRe, tokenizeDraft, type Mentionable } from '../src/mentions';

describe('mentionRe', () => {
  it('matches @name case-insensitively, anywhere in the body', () => {
    expect(mentionRe('rex').test('@rex can you look?')).toBe(true);
    expect(mentionRe('rex').test('please @Rex now')).toBe(true);
    expect(mentionRe('rex').test('end of line @rex')).toBe(true);
  });
  it('guards the end boundary against word chars and hyphens', () => {
    expect(mentionRe('echo').test('@echo-orch hi')).toBe(false);
    expect(mentionRe('echo').test('@echobot hi')).toBe(false);
    expect(mentionRe('echo').test('@echo, hi')).toBe(true);
    expect(mentionRe('echo-orch').test('@echo-orch hi')).toBe(true);
  });
  it('escapes regex specials in names', () => {
    expect(() => mentionRe('we.ird+name')).not.toThrow();
    expect(mentionRe('we.ird').test('@wexird')).toBe(false);
  });
});

describe('bareAddressRe', () => {
  it('matches a leading bare name, tolerating leading whitespace and any punctuation after', () => {
    expect(bareAddressRe('rex').test('rex can we make a pdf version of the report?')).toBe(true);
    expect(bareAddressRe('rex').test('  Rex, ship it')).toBe(true);
    expect(bareAddressRe('rex').test('rex: status?')).toBe(true);
    expect(bareAddressRe('rex').test('rex')).toBe(true);
  });
  it('never matches mid-sentence or as a prefix of a longer word', () => {
    expect(bareAddressRe('rex').test('hey rex, got a sec?')).toBe(false);
    expect(bareAddressRe('rex').test('can rex do it?')).toBe(false);
    expect(bareAddressRe('rex').test('rexes are cool')).toBe(false);
    expect(bareAddressRe('rex').test('rex-2 take this')).toBe(false);
    expect(bareAddressRe('rex-2').test('rex-2 take this')).toBe(true);
  });
  it('does not match @mentions (those are the explicit form)', () => {
    expect(bareAddressRe('rex').test('@rex hi')).toBe(false);
  });
});

describe('addressedIn', () => {
  it('is true for an @mention anywhere OR a leading bare name', () => {
    expect(addressedIn('ship it @patch', 'patch')).toBe(true);
    expect(addressedIn('patch can you profile it?', 'patch')).toBe(true);
    expect(addressedIn('the patch for auth is ready', 'patch')).toBe(false);
    expect(addressedIn('deploy the patch', 'patch')).toBe(false);
  });
});

describe('tokenizeDraft', () => {
  const people: Mentionable[] = [
    { name: 'rex', kind: 'agent', here: true },
    { name: 'patch', kind: 'agent', here: true },
    { name: 'tracy', kind: 'agent', here: false },
    { name: 'george', kind: 'human', here: true },
  ];

  it('returns [] for empty text', () => {
    expect(tokenizeDraft('', people)).toEqual([]);
  });

  it('tokenizes a leading bare agent name', () => {
    expect(tokenizeDraft('rex can we make a pdf?', people)).toEqual([
      { kind: 'bare', text: 'rex', name: 'rex' },
      { kind: 'text', text: ' can we make a pdf?' },
    ]);
  });

  it('keeps mid-sentence bare names and unknown words as plain text', () => {
    expect(tokenizeDraft('hey rex, ping patch', people)).toEqual([{ kind: 'text', text: 'hey rex, ping patch' }]);
  });

  it('never emits a bare token for out-of-room agents or humans', () => {
    expect(tokenizeDraft('tracy take a look', people)).toEqual([{ kind: 'text', text: 'tracy take a look' }]);
    expect(tokenizeDraft('george take a look', people)).toEqual([{ kind: 'text', text: 'george take a look' }]);
  });

  it('tokenizes @mentions with here/who flags, case preserved in text', () => {
    expect(tokenizeDraft('cc @Patch and @tracy and @george', people)).toEqual([
      { kind: 'text', text: 'cc ' },
      { kind: 'mention', text: '@Patch', name: 'patch', here: true, who: 'agent' },
      { kind: 'text', text: ' and ' },
      { kind: 'mention', text: '@tracy', name: 'tracy', here: false, who: 'agent' },
      { kind: 'text', text: ' and ' },
      { kind: 'mention', text: '@george', name: 'george', here: true, who: 'human' },
    ]);
  });

  it('applies the hyphen boundary: @name never claims a longer hyphenated name', () => {
    const roster: Mentionable[] = [
      { name: 'echo', kind: 'agent', here: true },
      { name: 'echo-orch', kind: 'agent', here: true },
    ];
    expect(tokenizeDraft('@echo-orch hi', roster)).toEqual([
      { kind: 'mention', text: '@echo-orch', name: 'echo-orch', here: true, who: 'agent' },
      { kind: 'text', text: ' hi' },
    ]);
  });

  it('prefers the longest bare-name match', () => {
    const roster: Mentionable[] = [
      { name: 'gem', kind: 'agent', here: true },
      { name: 'gemma', kind: 'agent', here: true },
    ];
    expect(tokenizeDraft('gemma review this', roster)[0]).toEqual({ kind: 'bare', text: 'gemma', name: 'gemma' });
  });

  it('combines a leading bare token with later @mentions', () => {
    expect(tokenizeDraft('rex loop in @patch too', people)).toEqual([
      { kind: 'bare', text: 'rex', name: 'rex' },
      { kind: 'text', text: ' loop in ' },
      { kind: 'mention', text: '@patch', name: 'patch', here: true, who: 'agent' },
      { kind: 'text', text: ' too' },
    ]);
  });

  it('leaves unknown @tokens plain', () => {
    expect(tokenizeDraft('@nobody hi', people)).toEqual([{ kind: 'text', text: '@nobody hi' }]);
  });

  it('preserves leading whitespace before a bare token', () => {
    expect(tokenizeDraft('  rex go', people)).toEqual([
      { kind: 'text', text: '  ' },
      { kind: 'bare', text: 'rex', name: 'rex' },
      { kind: 'text', text: ' go' },
    ]);
  });
});

describe('humanHandles', () => {
  it('uses the first name lowercased as the handle', () => {
    expect(humanHandles(['George Alonge'])).toEqual([{ name: 'george', label: 'George Alonge' }]);
    expect(humanHandles(['maria'])).toEqual([{ name: 'maria', label: 'maria' }]);
  });

  it('demotes ALL members sharing a first name to full-name slugs — no ambiguous short handle', () => {
    expect(humanHandles(['George Alonge', 'George Smith'])).toEqual([
      { name: 'george-alonge', label: 'George Alonge' },
      { name: 'george-smith', label: 'George Smith' },
    ]);
  });

  it('a single-word name IS its full slug, so it keeps the short handle in a collision', () => {
    expect(humanHandles(['George', 'George Alonge'])).toEqual([
      { name: 'george', label: 'George' },
      { name: 'george-alonge', label: 'George Alonge' },
    ]);
  });

  it('suffixes -2/-3 in input order when full slugs are identical too', () => {
    expect(humanHandles(['George Alonge', 'George Alonge'])).toEqual([
      { name: 'george-alonge', label: 'George Alonge' },
      { name: 'george-alonge-2', label: 'George Alonge' },
    ]);
  });

  it('never shadows a reserved (agent) name — case-insensitively', () => {
    expect(humanHandles(['Rex Ryder'], ['rex'])).toEqual([{ name: 'rex-ryder', label: 'Rex Ryder' }]);
    expect(humanHandles(['Rex'], ['Rex'])).toEqual([{ name: 'rex-2', label: 'Rex' }]);
  });

  it('skips members with no usable name', () => {
    expect(humanHandles([null, undefined, '', '   ', '田中'])).toEqual([]);
  });

  it('folds accents and strips punctuation so handles stay [\\w-] tokens', () => {
    expect(humanHandles(["José O'Brien"])).toEqual([{ name: 'jose', label: "José O'Brien" }]);
    expect(humanHandles(["José O'Brien", 'José García'])).toEqual([
      { name: 'jose-obrien', label: "José O'Brien" },
      { name: 'jose-garcia', label: 'José García' },
    ]);
    expect(humanHandles(['Jean-Luc Picard'])).toEqual([{ name: 'jean-luc', label: 'Jean-Luc Picard' }]);
  });

  it('produced handles round-trip through the mention grammar', () => {
    const roster: Mentionable[] = humanHandles(['George Alonge', 'George Smith'], ['rex']).map((h) => ({
      name: h.name,
      kind: 'human',
      here: true,
    }));
    expect(tokenizeDraft('cc @george-alonge on this', roster)).toEqual([
      { kind: 'text', text: 'cc ' },
      { kind: 'mention', text: '@george-alonge', name: 'george-alonge', here: true, who: 'human' },
      { kind: 'text', text: ' on this' },
    ]);
    // the bare short form stays plain text — nobody owns it
    expect(tokenizeDraft('@george on this', roster)).toEqual([{ kind: 'text', text: '@george on this' }]);
    expect(mentionRe('george-alonge').test('ping @george-alonge please')).toBe(true);
  });
});
