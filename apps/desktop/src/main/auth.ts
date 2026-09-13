// Supabase session auth for cloud mode (NM_AUTH=supabase). Dev mode keeps the
// local-stack dev identity. Session persists in userData; tokens auto-refresh.
import { readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';

const SUPABASE_URL = process.env['NM_SUPABASE_URL'] ?? '';
const ANON_KEY = process.env['NM_SUPABASE_ANON_KEY'] ?? '';

export interface Session {
  access_token: string;
  refresh_token: string;
  expires_at: number; // epoch seconds
  user: { id: string; email: string };
}

const sessionPath = () => join(app.getPath('userData'), 'session.json');
let session: Session | null = null;

export function loadSession(): Session | null {
  try {
    session = JSON.parse(readFileSync(sessionPath(), 'utf8')) as Session;
  } catch {
    session = null;
  }
  return session;
}

function save(s: Session | null) {
  session = s;
  if (s) {
    mkdirSync(app.getPath('userData'), { recursive: true });
    writeFileSync(sessionPath(), JSON.stringify(s));
  } else {
    rmSync(sessionPath(), { force: true });
  }
}

function requireCloudConfig() {
  if (!SUPABASE_URL || !ANON_KEY) {
    throw new Error('cloud auth is not configured — launch via scripts/cloud-app.sh (or set NM_SUPABASE_URL + NM_SUPABASE_ANON_KEY)');
  }
}

async function tokenRequest(body: Record<string, string>, grant: string): Promise<Session> {
  requireCloudConfig();
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=${grant}`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as any;
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description ?? data.msg ?? `auth failed (${res.status})`);
  }
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + (data.expires_in ?? 3600),
    user: { id: data.user.id, email: data.user.email },
  };
}

export async function login(email: string, password: string): Promise<Session> {
  const s = await tokenRequest({ email, password }, 'password');
  save(s);
  return s;
}

// GitHub sign-in: PKCE through the system browser with a loopback callback —
// the gh-CLI pattern. GitHub credentials never touch an embedded webview.
const OAUTH_PORT = 52414;
const OAUTH_REDIRECT = `http://127.0.0.1:${OAUTH_PORT}/auth/callback`;

export async function loginWithGitHub(): Promise<Session> {
  requireCloudConfig();
  const { createHash, randomBytes } = await import('node:crypto');
  const { createServer } = await import('node:http');
  const { shell } = await import('electron');

  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');

  const code = await new Promise<string>((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', OAUTH_REDIRECT);
      if (url.pathname !== '/auth/callback') {
        res.writeHead(404).end();
        return;
      }
      const err = url.searchParams.get('error_description') ?? url.searchParams.get('error');
      const authCode = url.searchParams.get('code');
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(
        `<body style="background:#121212;color:#fafafa;font:14px -apple-system;display:grid;place-items:center;height:100vh">
           <div>${err ? 'Sign-in failed — return to NeuraMesh.' : 'Signed in ✓ — you can close this tab and return to NeuraMesh.'}</div>
         </body>`,
      );
      server.close();
      clearTimeout(timer);
      if (err || !authCode) reject(new Error(err ?? 'no authorization code returned'));
      else resolve(authCode);
    });
    const timer = setTimeout(() => {
      server.close();
      reject(new Error('GitHub sign-in timed out (2 minutes)'));
    }, 120_000);
    server.once('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    server.listen(OAUTH_PORT, '127.0.0.1', () => {
      const authorize =
        `${SUPABASE_URL}/auth/v1/authorize?provider=github` +
        `&redirect_to=${encodeURIComponent(OAUTH_REDIRECT)}` +
        `&code_challenge=${challenge}&code_challenge_method=s256`;
      void shell.openExternal(authorize);
    });
  });

  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=pkce`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ auth_code: code, code_verifier: verifier }),
  });
  const data = (await res.json()) as any;
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description ?? data.msg ?? `code exchange failed (${res.status})`);
  }
  const s: Session = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + (data.expires_in ?? 3600),
    user: { id: data.user.id, email: data.user.email },
  };
  save(s);
  return s;
}

export function logout() {
  save(null);
}

export async function getAccessToken(): Promise<{ token: string; expiresAt: Date }> {
  if (!session) loadSession();
  if (!session) throw new Error('not signed in');
  if (session.expires_at - Math.floor(Date.now() / 1000) < 300) {
    try {
      const s = await tokenRequest({ refresh_token: session.refresh_token }, 'refresh_token');
      save(s);
      console.log(`auth_refresh ok exp_in=${s.expires_at - Math.floor(Date.now() / 1000)}s`);
    } catch (err) {
      // refresh token revoked/expired — session is dead; land on Login cleanly
      console.error('auth_refresh failed — returning to sign-in:', err instanceof Error ? err.message : err);
      save(null);
      app.relaunch();
      app.exit(0);
      throw err;
    }
  }
  return { token: session!.access_token, expiresAt: new Date(session!.expires_at * 1000) };
}

export function sessionExpiresAt(): number | null {
  if (!session) loadSession();
  return session ? session.expires_at * 1000 : null;
}

export function currentUser(): { id: string; email: string } | null {
  if (!session) loadSession();
  return session?.user ?? null;
}
