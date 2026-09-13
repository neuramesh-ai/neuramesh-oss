// What a person may paste into the attach card (the mobile fix round, 2026-09-06). The server
// parses the URL and is GitHub-only (handler/repo.ts, parseRepoUrl), so this must refuse exactly
// what the server would refuse. Offering a button that earns an error card is worse than no button.
import { describe, expect, it } from 'vitest';
import { looksLikeRepoUrl } from '../src/repo-url';

describe('looksLikeRepoUrl', () => {
  it('takes the forms a person actually pastes', () => {
    expect(looksLikeRepoUrl('https://github.com/alonge-dev/neuramesh')).toBe(true);
    expect(looksLikeRepoUrl('https://github.com/alonge-dev/neuramesh.git')).toBe(true);
    expect(looksLikeRepoUrl('github.com/alonge-dev/neuramesh')).toBe(true);
    expect(looksLikeRepoUrl('alonge-dev/neuramesh')).toBe(true);
    expect(looksLikeRepoUrl('  alonge-dev/neuramesh  ')).toBe(true);
  });
  it('refuses what cannot be a repo, so the button stays quiet', () => {
    expect(looksLikeRepoUrl('')).toBe(false);
    expect(looksLikeRepoUrl('   ')).toBe(false);
    expect(looksLikeRepoUrl('neuramesh')).toBe(false);
    expect(looksLikeRepoUrl('/home/me/code/neuramesh')).toBe(false);
    expect(looksLikeRepoUrl('some repo name')).toBe(false);
  });
  it('refuses a host the loop cannot push to, the way the server does', () => {
    expect(looksLikeRepoUrl('https://gitlab.com/team/app.git')).toBe(false);
    expect(looksLikeRepoUrl('git@github.com:alonge-dev/neuramesh.git')).toBe(false);
  });
});
