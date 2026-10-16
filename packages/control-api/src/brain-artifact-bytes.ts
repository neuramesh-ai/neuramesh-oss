import { BrainError } from './brain-error';

/** Validate without repeated regexp groups: V8 exhausts its regexp stack on large files. */
export function brainArtifactBytes(encoded: string): Buffer {
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
  if (encoded.length % 4 !== 0 || /[^A-Za-z0-9+/]/.test(encoded.slice(0, encoded.length - padding))) {
    throw new BrainError('INVALID_INPUT', 'Artifact content must use valid base64.', 400);
  }
  // Check the decoded length before allocating the buffer; padding still counts on the wire.
  if (encoded.length / 4 * 3 - padding > 16 * 1024 * 1024) {
    throw new BrainError('TOO_LARGE', 'An artifact must be at most 16 MiB.', 413);
  }
  return Buffer.from(encoded, 'base64');
}
