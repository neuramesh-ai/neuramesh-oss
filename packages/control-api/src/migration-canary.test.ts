import { afterEach, expect, it, vi } from 'vitest';
import { canaryClerkAllowed, isMigrationCanary } from './migration-canary';
import { createApp } from './app';
import { MemoryStore } from './store';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

it('keeps a production target closed except to approved QA subjects until explicit live promotion', () => {
  const env = { NM_DEPLOYMENT: 'production', NM_MIGRATION_MODE: 'canary', NM_CANARY_CLERK_USER_IDS: 'user_qa,user_second' };
  expect(canaryClerkAllowed('user_qa', env)).toBe(true);
  expect(canaryClerkAllowed('user_customer', env)).toBe(false);
  expect(canaryClerkAllowed(undefined, env)).toBe(false);
  expect(canaryClerkAllowed('user_customer', { NM_DEPLOYMENT: 'production' })).toBe(false);
  expect(canaryClerkAllowed('user_customer', { ...env, NM_MIGRATION_MODE: 'live' })).toBe(true);
  expect(isMigrationCanary({})).toBe(false);
});

it('refuses public side effects and account creation before contacting a provider during rehearsal', async () => {
  vi.stubEnv('NM_DEPLOYMENT', 'production'); vi.stubEnv('NM_MIGRATION_MODE', 'canary');
  vi.stubEnv('NM_CANARY_CLERK_USER_IDS', 'user_qa');
  const outbound = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected outbound request'));
  const app = createApp(new MemoryStore());
  for (const [method, path] of [['POST', '/webhooks/stripe'], ['GET', '/connect/github/callback'], ['POST', '/auth/clerk/signup'], ['POST', '/a2a/agents/test/tasks']] as const) {
    expect((await app.request(path, { method })).status, path).toBe(503);
  }
  expect(outbound).not.toHaveBeenCalled();
});
