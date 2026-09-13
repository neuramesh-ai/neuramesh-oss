import { describe, expect, it } from 'vitest';
import { normalizeUrlInput, searchUrlFor } from '../src/browse';

describe('normalizeUrlInput', () => {
  it('returns null for empty or whitespace-only input', () => {
    expect(normalizeUrlInput('')).toBeNull();
    expect(normalizeUrlInput('   ')).toBeNull();
  });

  it('passes http(s) URLs through, normalized', () => {
    expect(normalizeUrlInput('https://example.com')).toBe('https://example.com/');
    expect(normalizeUrlInput('http://example.com/a?b=1#c')).toBe('http://example.com/a?b=1#c');
    expect(normalizeUrlInput('HTTPS://Example.COM/Path')).toBe('https://example.com/Path');
    expect(normalizeUrlInput('  https://example.com  ')).toBe('https://example.com/');
  });

  it('gives schemeless domains https', () => {
    expect(normalizeUrlInput('example.com')).toBe('https://example.com/');
    expect(normalizeUrlInput('github.com/foo/bar?tab=1')).toBe('https://github.com/foo/bar?tab=1');
    expect(normalizeUrlInput('example.com:8443/admin')).toBe('https://example.com:8443/admin');
    expect(normalizeUrlInput('example.com?q=1')).toBe('https://example.com/?q=1');
  });

  it('gives localhost-ish hosts http (dev servers rarely speak TLS)', () => {
    expect(normalizeUrlInput('localhost:5173')).toBe('http://localhost:5173/');
    expect(normalizeUrlInput('localhost')).toBe('http://localhost/');
    expect(normalizeUrlInput('127.0.0.1:8080/health')).toBe('http://127.0.0.1:8080/health');
    expect(normalizeUrlInput('0.0.0.0:3000')).toBe('http://0.0.0.0:3000/');
    expect(normalizeUrlInput('192.168.1.10:3000')).toBe('http://192.168.1.10:3000/');
    expect(normalizeUrlInput('app.localhost:4000')).toBe('http://app.localhost:4000/');
    expect(normalizeUrlInput('[::1]:8080')).toBe('http://[::1]:8080/');
  });

  it('keeps an explicit scheme on a local host', () => {
    expect(normalizeUrlInput('https://localhost:8443')).toBe('https://localhost:8443/');
    expect(normalizeUrlInput('http://example.com')).toBe('http://example.com/');
  });

  it('routes non-web schemes to search instead of executing them', () => {
    expect(normalizeUrlInput('javascript:alert(1)')).toBe(searchUrlFor('javascript:alert(1)'));
    expect(normalizeUrlInput('file:///etc/passwd')).toBe(searchUrlFor('file:///etc/passwd'));
    expect(normalizeUrlInput('data:text/html,<b>x</b>')).toBe(searchUrlFor('data:text/html,<b>x</b>'));
  });

  it('routes non-URL text to search', () => {
    expect(normalizeUrlInput('what is rust')).toBe(searchUrlFor('what is rust'));
    expect(normalizeUrlInput('rust')).toBe(searchUrlFor('rust'));
    expect(normalizeUrlInput('user:pass@example.com')).toBe(searchUrlFor('user:pass@example.com'));
  });

  it('search URLs encode the query', () => {
    expect(searchUrlFor('what is rust')).toBe('https://duckduckgo.com/?q=what%20is%20rust');
  });
});
