// The release card (src/releasecard.ts): the palette picker's three cases, the wrap and the fit,
// and real PNGs out of resvg-wasm at the three sizes. The wasm is never stubbed: a load failure
// here is the finding, not something to paper over.
import { describe, expect, it } from 'vitest';
import { cardFontBuffers, DEFAULT_CARD_PALETTE, escapeXml, fitTitle, luminance, pickCardPalette, releaseCardSvg, renderReleaseCard, SIZES, wrapTitle } from '../src/releasecard';

const SAMPLE = 'The browser terminal: a shell on your cloud machine from any browser';
const card = (over: Partial<Parameters<typeof renderReleaseCard>[0]> = {}) => ({ tag: 'v0.134.0', title: SAMPLE, product: 'neuramesh', palette: DEFAULT_CARD_PALETTE, size: 'square' as const, ...over });

// PNG: 8 magic bytes, then the IHDR chunk (length, "IHDR", width, height, big-endian)
function ihdr(png: Uint8Array): { width: number; height: number } {
  const b = Buffer.from(png.buffer, png.byteOffset, png.byteLength);
  expect([...b.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  expect(b.toString('latin1', 12, 16)).toBe('IHDR');
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

describe('pickCardPalette', () => {
  it('falls back to the house palette when there is no read', () => {
    expect(pickCardPalette(null)).toEqual(DEFAULT_CARD_PALETTE);
    expect(pickCardPalette({ palette: [] })).toEqual(DEFAULT_CARD_PALETTE);
    expect(pickCardPalette({ palette: ['red', '#12'] })).toEqual(DEFAULT_CARD_PALETTE);
  });

  it('takes a dark ground, a light ink and the most saturated color from a dark site', () => {
    expect(pickCardPalette({ palette: ['#0b0f19', '#e5e7eb', '#3b82f6', '#9ca3af'] })).toEqual({ bg: '#0b0f19', ink: '#e5e7eb', accent: '#3b82f6' });
  });

  it('keeps the house ground under a light site and still takes its accent', () => {
    expect(pickCardPalette({ palette: ['#f7f3ee', '#e0574f', '#c9a27e'] })).toEqual({ bg: '#161616', ink: '#f7f3ee', accent: '#e0574f' });
  });

  it('takes a brand color as the ground when it is dark enough, and the next saturated color as the accent', () => {
    // #834a2b sits at luminance 0.099, under the 0.1 bar, so it is the ground and not the accent
    expect(pickCardPalette({ palette: ['#f7f3ee', '#834a2b', '#c9a27e'] })).toEqual({ bg: '#834a2b', ink: '#f7f3ee', accent: '#c9a27e' });
  });

  it('a mid blue is not a ground: the tally that painted neuramesh.app blue (2026-09-18) keeps the house ground', () => {
    // the live read: chart series, no dark, no light. #4f7bb0 sits at luminance 0.19 and used to pass as a ground
    const live = ['#77ac8d', '#3f9268', '#4f7bb0', '#6a63bc', '#6b665f', '#7ba1c4', '#9793d2', '#a89ccf'];
    expect(pickCardPalette({ palette: live }).bg).toBe(DEFAULT_CARD_PALETTE.bg);
  });

  it('the site\'s declared tokens win over the tally: neuramesh.app is graphite, light ink and ember', () => {
    const live = ['#77ac8d', '#3f9268', '#4f7bb0', '#6a63bc'];
    expect(pickCardPalette({ palette: live, tokens: { bg: '#0d0d0d', ink: '#e8e6e3', accent: '#c58a63' } })).toEqual({ bg: '#0d0d0d', ink: '#e8e6e3', accent: '#c58a63' });
    // a declared ink or accent that cannot read on the ground yields to the tally and the house
    expect(pickCardPalette({ palette: live, tokens: { bg: '#0d0d0d', ink: '#111111', accent: '#101010' } })).toEqual({ bg: '#0d0d0d', ink: DEFAULT_CARD_PALETTE.ink, accent: '#3f9268' });
  });

  it('refuses an accent that would vanish on the ground', () => {
    // #14142a is saturated enough but sits at contrast 1.05 against #101018
    expect(pickCardPalette({ palette: ['#101018', '#14142a'] })).toEqual({ bg: '#101018', ink: '#eaeaea', accent: '#834a2b' });
  });

  it('measures luminance the WCAG way', () => {
    expect(luminance('#000000')).toBe(0);
    expect(luminance('#ffffff')).toBeCloseTo(1, 5);
    expect(luminance('#161616')).toBeLessThan(0.2);
  });
});

describe('the wrap and the fit', () => {
  it('wraps greedily at the character budget', () => {
    expect(wrapTitle(SAMPLE, 24)).toEqual(['The browser terminal: a', 'shell on your cloud', 'machine from any browser']);
    expect(wrapTitle('one', 24)).toEqual(['one']);
    expect(wrapTitle('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij']);
  });

  it('steps the size down until three lines hold the exact text', () => {
    const { lines, size } = fitTitle(SAMPLE, SIZES.square.title, SIZES.square.w - 2 * SIZES.square.pad);
    expect(lines).toHaveLength(3);
    expect(lines.join(' ')).toBe(SAMPLE);
    expect(size).toBeLessThan(SIZES.square.title);
    expect(size).toBeGreaterThanOrEqual(Math.round(SIZES.square.title * 0.7));
    const short = fitTitle('Whiteboards', SIZES.square.title, 888);
    expect(short).toEqual({ lines: ['Whiteboards'], size: 88 });
  });

  it('ellipsizes the third line only at the floor', () => {
    const long = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ');
    const { lines, size } = fitTitle(long, 88, 888);
    expect(lines).toHaveLength(3);
    expect(size).toBe(62);
    expect(lines[2]!.endsWith('…')).toBe(true);
  });

  it('escapes the text into the SVG and refuses a color that is not hex', () => {
    const svg = releaseCardSvg(card({ title: 'Tom & Jerry <3 "quotes"', product: "o'neil" }));
    // 23 characters wrap to two lines at 88px, so the fragments are asserted line by line
    expect(svg).toContain('>Tom &amp; Jerry &lt;3</text>');
    expect(svg).toContain('>&quot;quotes&quot;</text>');
    expect(svg).toContain('O&apos;NEIL');
    expect(svg).not.toContain('<3');
    expect(escapeXml('<&>')).toBe('&lt;&amp;&gt;');
    expect(() => releaseCardSvg(card({ palette: { ...DEFAULT_CARD_PALETTE, accent: 'red' } }))).toThrow(/rrggbb/);
  });
});

describe('renderReleaseCard', () => {
  it.each([
    ['square', 1080, 1080],
    ['wide', 1200, 675],
    ['story', 1080, 1920],
  ] as const)('renders a %s PNG of %i by %i', async (size, width, height) => {
    const png = await renderReleaseCard(card({ size }));
    expect(ihdr(png)).toEqual({ width, height });
    expect(png.byteLength).toBeGreaterThan(2_000);
  });

  it('renders a title that wraps to three lines', async () => {
    const png = await renderReleaseCard(card({ title: SAMPLE, size: 'wide' }));
    expect(ihdr(png)).toEqual({ width: 1200, height: 675 });
  });

  it('sets the title in the Medium cut, not a synthesized weight', async () => {
    // the process is initialized by now, so resvg is used directly for the one-cut control render
    const both = await renderReleaseCard(card({ title: 'Whiteboards' }));
    const { Resvg } = (await import('@resvg/resvg-wasm')) as unknown as { Resvg: new (svg: string, o: object) => { render(): { asPng(): Uint8Array } } };
    const regularOnly = new Resvg(releaseCardSvg(card({ title: 'Whiteboards' })), { font: { fontBuffers: [cardFontBuffers()[1]!], defaultFontFamily: 'NeuraMesh Sans' } }).render().asPng();
    expect(ihdr(regularOnly)).toEqual({ width: 1080, height: 1080 });
    expect(Buffer.compare(Buffer.from(both), Buffer.from(regularOnly))).not.toBe(0);
  });
});
