// PROOF OF AN ADDRESS FOR AN IN-APP SIGN-UP (R10 lane A, NM-010, 2026-11-09).
//
// /auth/clerk/signup creates the Clerk user through the Backend API, and Clerk marks an address
// created that way VERIFIED. So anyone could sign up as victim@company.com (any address with a
// pending invitation and no account yet), read /v1/invites/mine and accept: the workspace, its
// messages, repositories and credentials, by squatting an address. Every invitation check reads
// "verified" from Clerk (handler/guards.ts verifiedEmailFor, onauth.ts), and Clerk's answer is not
// proof for these accounts.
//
// Now an account made by that door is SELF-ASSERTED (nm_users.email_self_asserted, migration 0186)
// until the person opens a link we mail to the address AND types the password of the account there:
// an HMAC over the user and the address, keyed from the mail secret the server already holds, that
// expires. Until then the address claims no invitation and reads none, and the signup credits wait
// too (workspace-birth.ts), so a stranger's address buys nothing. The flag is set in the INSERT of the
// row (pgstore resolveClerkUser), also for a row that is made again for a Clerk identity whose address
// the Backend API verified (strategy `admin`), so account.delete cannot wash it. The hosted Clerk
// sign-up (the /auth/desktop handoff) verifies by email code and never sets the flag.
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Env, Hono } from 'hono';
import { allowHit } from './auth-throttle';
import { clerkVerifyPassword } from './clerk';
import { sqlOf } from './credits';
import { API_URL, sendEmail } from './mail';
import { grantSignupOnce } from './workspace-birth';
import type { Store } from './store';

const TTL_MS = 3 * 24 * 60 * 60 * 1000;
const key = (): string => process.env['NM_MAIL_SECRET'] ?? process.env['CLERK_SECRET_KEY'] ?? 'dev-mail-secret';
const mac = (body: string): string => createHmac('sha256', key()).update(`email-proof:${body}`).digest('base64url');

/** the link's token: user, address, expiry and their MAC */
export function emailProofToken(userId: string, email: string, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ u: userId, e: email.trim().toLowerCase(), x: now + TTL_MS })).toString('base64url');
  return `${body}.${mac(body)}`;
}

/** the user and address a token proves, or null (forged, expired, malformed) */
export function verifyEmailProof(token: string, now = Date.now()): { userId: string; email: string } | null {
  const [body = '', sig = ''] = token.split('.');
  const want = Buffer.from(mac(body));
  const got = Buffer.from(sig);
  if (!body || want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { u?: unknown; e?: unknown; x?: unknown };
    if (typeof p.u !== 'string' || typeof p.e !== 'string' || typeof p.x !== 'number' || p.x < now) return null;
    return { userId: p.u, email: p.e };
  } catch { return null; }
}

/** is this account's address only the sign-up's say-so? The in-memory store has no flag: no. A
 *  lookup that fails answers YES: the invitation boundary fails closed. */
export async function emailSelfAsserted(store: Store, userId: string): Promise<boolean> {
  const sql = sqlOf(store);
  if (!sql) return false;
  try {
    const [row] = await sql`select email_self_asserted from nm_users where id = ${userId}::uuid`;
    return row ? row['email_self_asserted'] === true : false;
  } catch (e) {
    console.error('email_self_asserted lookup failed:', e);
    return true;
  }
}

/** mail the proof link; best effort (a mail outage leaves the account self-asserted, never open) */
export async function sendEmailProof(userId: string, email: string): Promise<void> {
  const url = `${API_URL}/auth/verify-email/${emailProofToken(userId, email)}`;
  await sendEmail({
    to: email,
    email: {
      subject: 'Confirm your email for NeuraMesh',
      preheader: 'Open the link and type the password of your account.',
      html: `<p>Confirm that this address is yours. Then you can finish your NeuraMesh account and accept an invitation to this address.</p><p><a href="${url}">Confirm my email</a></p><p style="color:#8f8f8f">The link works for three days. The page asks for the password of your account. If you did not create an account, ignore this email.</p>`,
      text: `Confirm that this address is yours. Then you can finish your NeuraMesh account:\n\n${url}\n\nThe link works for three days. The page asks for the password of your account. If you did not create an account, ignore this email.`,
    },
  }).catch((e: unknown) => console.error('email proof send failed:', e));
}

const PROOF_MAIL = { max: 1, windowMs: 10 * 60_000 };
const PROOF_TRIES = { max: 10, windowMs: 15 * 60_000 };

/** an account whose address is not proven yet gets its link again when it signs in, at most one mail
 *  each ten minutes: the first mail can fail or expire, and no other door sends one. 'sent' or null. */
export async function resendEmailProof(store: Store, userId: string, email: string): Promise<'sent' | null> {
  if (!(await emailSelfAsserted(store, userId)) || !allowHit(`proof-mail:${userId}`, PROOF_MAIL)) return null;
  void sendEmailProof(userId, email);
  return 'sent';
}

const esc = (s: string): string => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

/** one small page in both themes, the shape of the unsubscribe page (mail.ts) */
function page(title: string, inner: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title} · NeuraMesh</title>
<style>
 :root{color-scheme:light dark;--ink:#38332d;--paper:#f4f2ed;--surface:#fbfaf7;--line:#e7e2da;--body:#585249;--warn:#a2452f}
 @media(prefers-color-scheme:dark){:root{--ink:#d9d5ce;--paper:#1b1a18;--surface:#201f1c;--line:#2a2825;--body:#b7b4ac;--warn:#e08a72}}
 *{margin:0;padding:0;box-sizing:border-box}
 body{background:var(--paper);color:var(--ink);font-family:'Geist',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;
      display:grid;place-items:center;min-height:100vh;padding:24px;-webkit-font-smoothing:antialiased}
 .c{width:100%;max-width:460px;background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:34px}
 .m{display:flex;align-items:center;gap:9px;font-weight:800;letter-spacing:-.028em;margin-bottom:20px}
 .t{width:22px;height:22px;border-radius:7px;background:var(--ink);color:var(--paper);display:grid;place-items:center;font-size:12px}
 h1{font-size:24px;letter-spacing:-.026em;line-height:1.18;margin-bottom:12px}
 p{color:var(--body);font-size:15.5px;line-height:1.6}
 form{display:grid;gap:8px;margin:18px 0 14px}
 label{font-size:13px;font-weight:600}
 input{font:inherit;color:var(--ink);background:var(--paper);border:1px solid var(--line);border-radius:8px;padding:10px 12px;width:100%}
 input:focus-visible,button:focus-visible{outline:2px solid var(--ink);outline-offset:2px}
 button{font:inherit;font-weight:600;color:var(--paper);background:var(--ink);border:0;border-radius:8px;padding:11px 14px;margin-top:6px;cursor:pointer}
 .e{color:var(--warn);margin-top:12px}
 .s{font-size:13.5px}
</style></head><body><div class="c">
 <div class="m"><span class="t">N</span>NeuraMesh</div>
 <h1>${title}</h1>${inner}
</div></body></html>`;
}
const EXPIRED = page('That link expired', '<p>That link expired or is not valid. Sign in to NeuraMesh to get a new link.</p>');
const DONE = page('Your email is confirmed', '<p>Go to NeuraMesh. You can accept an invitation to this address now.</p>');
const form = (email: string, error = ''): string => page('Confirm your email',
  `<p>Type the password of the NeuraMesh account for <b>${esc(email)}</b>.</p>${error ? `<p class="e" role="alert">${error}</p>` : ''}
 <form method="post"><label for="pw">Password</label><input id="pw" name="password" type="password" autocomplete="current-password" required autofocus><button type="submit">Confirm my email</button></form>
 <p class="s">If you did not create this account, close this page.</p>`);

/** /auth/verify-email/:token, public like /u/:token.
 *
 *  THE LINK ALONE PROVES NOTHING ABOUT THE ACCOUNT (the security lane's review, 2026-11-13). A bare GET
 *  cleared the flag, so a mail scanner that follows links, or the invited person who opens a mail
 *  that they expected, proved the account of a stranger who knows its password. The proof is two
 *  facts together now: the link reached the mailbox, and the person who opens it knows the password of
 *  the account. The GET only shows the question. */
export function emailProofRoutes<E extends Env>(app: Hono<E>, store: Store): void {
  app.get('/auth/verify-email/:token', async (c) => {
    const proof = verifyEmailProof(c.req.param('token'));
    const sql = sqlOf(store);
    if (!proof || !sql) return c.html(EXPIRED, 400);
    // a read only: the address must still be the account's, or the link is an old one
    const rows = await sql`select 1 from nm_users where id = ${proof.userId}::uuid and lower(email) = ${proof.email}`;
    return rows.length ? c.html(form(proof.email)) : c.html(EXPIRED, 400);
  });
  app.post('/auth/verify-email/:token', async (c) => {
    const proof = verifyEmailProof(c.req.param('token'));
    const sql = sqlOf(store);
    if (!proof || !sql) return c.html(EXPIRED, 400);
    if (!allowHit(`proof:${proof.userId}`, PROOF_TRIES)) return c.html(form(proof.email, 'Too many tries. Wait some minutes, then try again.'), 429);
    const body = (await c.req.parseBody().catch(() => ({}))) as Record<string, unknown>;
    const password = typeof body['password'] === 'string' ? body['password'] : '';
    // the address must still be the account's: a changed address needs its own proof
    const [row] = await sql`select clerk_user_id from nm_users where id = ${proof.userId}::uuid and lower(email) = ${proof.email}`;
    if (!row) return c.html(EXPIRED, 400);
    const clerkId = row['clerk_user_id'] as string | null;
    const knows = !!password && !!clerkId && (await clerkVerifyPassword(clerkId, password).catch(() => false));
    if (!knows) return c.html(form(proof.email, 'That password is not correct.'), 401);
    await sql`update nm_users set email_self_asserted = false where id = ${proof.userId}::uuid and lower(email) = ${proof.email}`;
    // the sign-up credits that waited go to the one workspace this person OWNS (NM-024 claims them once).
    // a workspace that the person only joined gets nothing.
    const owned = (await store.listWorkspaces(proof.userId).catch(() => [])).filter((w) => w.role === 'owner');
    if (owned.length === 1 && owned[0]) await grantSignupOnce(store, proof.userId, owned[0].id).catch(() => false);
    return c.html(DONE);
  });
}
