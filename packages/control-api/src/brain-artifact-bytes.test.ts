import { expect, it } from 'vitest';
import { brainArtifactBytes } from './brain-artifact-bytes';

it('decodes empty, padded and unpadded complete base64 groups exactly', () => {
  for (const bytes of [Buffer.alloc(0), Buffer.from([0xfb]), Buffer.from([0xfb, 0xff]), Buffer.from([0xfb, 0xff, 0xff])]) {
    expect(brainArtifactBytes(bytes.toString('base64'))).toEqual(bytes);
  }
});

it('accepts files through the 16 MiB boundary without exhausting the regexp stack', () => {
  for (const size of [5 * 1024 * 1024, 16 * 1024 * 1024 - 1, 16 * 1024 * 1024]) {
    const bytes = Buffer.alloc(size, 0xfb);
    expect(brainArtifactBytes(bytes.toString('base64')).equals(bytes)).toBe(true);
  }
  expect(() => brainArtifactBytes(Buffer.alloc(16 * 1024 * 1024 + 1).toString('base64')))
    .toThrow(expect.objectContaining({ code: 'TOO_LARGE', status: 413 }));
});

it('rejects invalid alphabet, incomplete groups and misplaced padding, including large inputs', () => {
  for (const encoded of ['A', 'AA', 'AAA', '=AAA', 'AA=A', 'A===', '====', 'AA==AAAA', 'AA==\n', 'AA-=', 'AA_=', 'AAé=', `${'AAAA'.repeat(2 * 1024 * 1024)}?AAA`]) {
    expect(() => brainArtifactBytes(encoded)).toThrow(expect.objectContaining({ code: 'INVALID_INPUT', status: 400 }));
  }
});
