// The open pull requests that /v1/repo/changes adds for the Product page's Releases tab (2026-11-22):
// one page of the open list, mapped to the fields the page reads, and a failed read is an empty list
// so the merged facts beside it still answer.
import { describe, expect, it } from 'vitest';
import { readOpenPulls } from '../src/github-reads';

const reply = (status: number, body: unknown) => (async (input: string | URL | Request) => {
  expect(String(input)).toBe('https://api.github.com/repos/acme/widgets/pulls?state=open&sort=updated&direction=desc&per_page=30');
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}) as unknown as typeof fetch;

describe('readOpenPulls', () => {
  it('maps each open pull request to the page fields', async () => {
    const out = await readOpenPulls('acme/widgets', { token: 't', fetchFn: reply(200, [
      { number: 44, title: 'Export jobs to CSV', draft: true, html_url: 'https://github.com/acme/widgets/pull/44', created_at: '2026-11-20T09:00:00Z', updated_at: '2026-11-21T09:00:00Z', labels: [{ name: 'feature' }], head: { ref: 'nm/44-export' }, user: { login: 'ada' } },
      { number: 43, title: 'Fix the login loop', html_url: 'https://github.com/acme/widgets/pull/43', created_at: '2026-11-19T09:00:00Z', updated_at: '2026-11-19T10:00:00Z', user: null },
    ]) });
    expect(out).toEqual([
      { number: 44, title: 'Export jobs to CSV', draft: true, author: 'ada', branch: 'nm/44-export', labels: ['feature'], createdAt: '2026-11-20T09:00:00Z', updatedAt: '2026-11-21T09:00:00Z', url: 'https://github.com/acme/widgets/pull/44' },
      { number: 43, title: 'Fix the login loop', draft: false, author: null, branch: '', labels: [], createdAt: '2026-11-19T09:00:00Z', updatedAt: '2026-11-19T10:00:00Z', url: 'https://github.com/acme/widgets/pull/43' },
    ]);
  });

  it.each([403, 500])('a refusal of %i is an empty list, never a throw', async (status) => {
    expect(await readOpenPulls('acme/widgets', { fetchFn: reply(status, { message: 'no' }) })).toEqual([]);
  });
});
