import { timingSafeEqual } from 'node:crypto';
import { OAuth2Client, type TokenPayload } from 'google-auth-library';

const google = new OAuth2Client();
type Verify = (token: string, audience: string) => Promise<TokenPayload | undefined>;
const verifyGoogle: Verify = async (idToken, audience) => (await google.verifyIdToken({ idToken, audience })).getPayload();

/** Production schedules use a verified Google service identity. Legacy cron auth stays scoped to its existing hosts. */
export async function cronAuthorized(header: string | undefined, env: NodeJS.ProcessEnv = process.env, verify: Verify = verifyGoogle): Promise<boolean> {
  if (env['NM_DEPLOYMENT'] !== 'production') {
    const secret = env['CRON_SECRET'];
    const expected = secret ? Buffer.from(`Bearer ${secret}`) : null;
    const actual = Buffer.from(header ?? '');
    return !!expected && actual.length === expected.length && timingSafeEqual(actual, expected);
  }
  const audience = env['NM_SCHEDULER_AUDIENCE'];
  const email = env['NM_SCHEDULER_EMAIL'];
  const token = /^Bearer (\S+)$/.exec(header ?? '')?.[1];
  if (!audience || !email || !token) return false;
  try {
    const payload = await verify(token, audience);
    return !!payload && payload.email === email && payload.email_verified === true
      && payload.aud === audience && ['accounts.google.com', 'https://accounts.google.com'].includes(payload.iss)
      && typeof payload.exp === 'number' && payload.exp > Date.now() / 1000;
  } catch { return false; }
}
