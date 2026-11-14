import { describe, expect, it } from 'vitest';
import type { TokenPayload } from 'google-auth-library';
import { cronAuthorized } from './cron-auth';

const env = { NM_DEPLOYMENT: 'production', NM_SCHEDULER_AUDIENCE: 'https://nm-cr-api.run.app', NM_SCHEDULER_EMAIL: 'scheduler@prd.iam.gserviceaccount.com', CRON_SECRET: 'old-secret' };
const claims = (): TokenPayload => ({ iss: 'https://accounts.google.com', aud: env.NM_SCHEDULER_AUDIENCE, sub: 'service-identity', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 600, email: env.NM_SCHEDULER_EMAIL, email_verified: true });

describe('scheduled production invocation', () => {
  it('requires verification and the exact service identity and audience', async () => {
    let checked = false;
    expect(await cronAuthorized('Bearer signed-token', env, async (token, audience) => {
      expect(token).toBe('signed-token'); expect(audience).toBe(env.NM_SCHEDULER_AUDIENCE); checked = true; return claims();
    })).toBe(true);
    expect(checked).toBe(true);
  });
  it.each([{ email: 'other@prd.iam.gserviceaccount.com' }, { email_verified: false }, { aud: 'https://other.run.app' }, { iss: 'https://attacker.example' }, { exp: 1 }])('refuses invalid claims %j', async patch => {
    expect(await cronAuthorized('Bearer signed-token', env, async () => ({ ...claims(), ...patch }))).toBe(false);
  });
  it('refuses invalid signatures, absent configuration and the old static credential', async () => {
    const invalid = async () => { throw new Error('signature failed'); };
    expect(await cronAuthorized('Bearer old-secret', env, invalid)).toBe(false);
    expect(await cronAuthorized(undefined, env, invalid)).toBe(false);
    expect(await cronAuthorized('Bearer signed-token', { ...env, NM_SCHEDULER_EMAIL: '' }, invalid)).toBe(false);
  });
  it('retains the existing secret contract for existing non-production-profile hosts', async () => {
    expect(await cronAuthorized('Bearer old-secret', { CRON_SECRET: 'old-secret' })).toBe(true);
    expect(await cronAuthorized('Bearer wrong', { CRON_SECRET: 'old-secret' })).toBe(false);
    expect(await cronAuthorized('Bearer ', {})).toBe(false);
  });
});
