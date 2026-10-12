import { expect, it } from 'vitest';
import { controlApiRequestUrl } from './brain-endpoint';

it('routes only exact first-party brain paths to the large-body ingress', () => {
  const path = '/v1/brain/threads/test?workspace=one';
  expect(controlApiRequestUrl('https://api.neuramesh.app/', path)).toBe(`https://relay.neuramesh.app${path}`);
  expect(controlApiRequestUrl('https://hq.neuramesh.app/', path)).toBe(`https://relay.neuramesh.app${path}`);
  expect(controlApiRequestUrl('https://hq.neuramesh.app', '/v1/commands')).toBe('https://hq.neuramesh.app/v1/commands');
  expect(controlApiRequestUrl('https://api.neuramesh.app', '/v1/commands')).toBe('https://api.neuramesh.app/v1/commands');
  for (const origin of ['', 'http://127.0.0.1:8898', 'https://custom.example/api', 'https://api.neuramesh.app.evil.test', 'https://api.neuramesh.app:8443', 'https://hq.neuramesh.app.evil.test', 'http://hq.neuramesh.app']) {
    expect(controlApiRequestUrl(origin, path)).toBe(`${origin}${path}`);
  }
});

it('trims a long run of slashes in one pass', () => {
  // a /\/+$/ replace backtracks over a run of slashes that does not end the string (CodeQL js/polynomial-redos)
  const slashes = '/'.repeat(100_000);
  const started = performance.now();
  expect(controlApiRequestUrl(`https://custom.example${slashes}x`, '/v1/commands')).toBe(`https://custom.example${slashes}x/v1/commands`);
  expect(controlApiRequestUrl(`https://custom.example${slashes}x`, '/v1/brain/t')).toBe(`https://custom.example${slashes}x/v1/brain/t`);
  expect(performance.now() - started).toBeLessThan(1_000);
  expect(controlApiRequestUrl('https://api.neuramesh.app/////', '/v1/brain/t')).toBe('https://relay.neuramesh.app/v1/brain/t');
  expect(controlApiRequestUrl('https://custom.example/api//', '/v1/commands')).toBe('https://custom.example/api/v1/commands');
});
