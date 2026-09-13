// Image mime truth (2026-08-20): the bytes outrank every declaration in the pipeline — this
// sniffer is what stops a webp wearing a png label from dying at X's finalize.
import { describe, expect, it } from 'vitest';
import { genImageItemId, sniffImageMime } from '../src/images';

const bytes = (...parts: Array<number[] | string>): Uint8Array => {
  const out: number[] = [];
  for (const p of parts) {
    if (typeof p === 'string') for (const c of p) out.push(c.charCodeAt(0));
    else out.push(...p);
  }
  while (out.length < 16) out.push(0);
  return new Uint8Array(out);
};

describe('sniffImageMime', () => {
  it('recognizes the four formats X accepts by their magic numbers', () => {
    expect(sniffImageMime(bytes([0x89], 'PNG', [0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png');
    expect(sniffImageMime(bytes([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffImageMime(bytes('GIF89a'))).toBe('image/gif');
    expect(sniffImageMime(bytes('RIFF', [0x10, 0x00, 0x00, 0x00], 'WEBP'))).toBe('image/webp');
  });

  it('answers null for the unrecognizable — the caller falls back to the declaration', () => {
    expect(sniffImageMime(bytes('<svg xmlns=""'))).toBeNull();
    expect(sniffImageMime(new Uint8Array(4))).toBeNull(); // too short to say anything
  });
});

// ONE matcher, because three places must agree: the two wake paths that draw, and the wake GATE
// that decides whether this machine may serve the wake at all (they disagreed, 2026-09-05).
describe('the draw marker', () => {
  const ITEM = '0f2c4a1b-9d3e-4c77-8a21-5b6d0e7f1234';

  it('finds the draft the card asked to draw', () => {
    expect(genImageItemId(`Generate the image for this draft.\u2039gen-image:${ITEM}\u203a`)).toEqual(ITEM);
  });

  it('an ordinary message asks for nothing', () => {
    expect(genImageItemId('can you redraw the second one?')).toBeNull();
    expect(genImageItemId('')).toBeNull();
  });

  it('a marker without a plausible id is not a draw request', () => {
    expect(genImageItemId('\u2039gen-image:xyz\u203a')).toBeNull();
  });
});
