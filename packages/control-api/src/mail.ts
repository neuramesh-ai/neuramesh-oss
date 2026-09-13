// Outbound email through Resend. Gated on RESEND_API_KEY — absent, every entry is a hard
// no-op (OSS/local/CI/echo never send), mirroring analytics.ts and billing.ts.
//
// Raw fetch, no SDK: Resend's send API is one POST, and build:vercel externalizes every
// dependency by name in an esbuild flag list — a new package means touching the bundle
// config to wrap a single HTTP call. clerk.ts sets the precedent.
//
// This module NEVER decides who gets mail. It renders and transmits; the outbox row and the
// suppression rules live in the store (docs/27 §3).
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { RenderedEmail } from '@neuramesh/shared';

const KEY = process.env['RESEND_API_KEY'];
const FROM = process.env['NM_MAIL_FROM'] ?? 'NeuraMesh <hello@notifications.neuramesh.app>';
const REPLY_TO = process.env['NM_MAIL_REPLY_TO'] ?? '';
const DRY_RUN = process.env['NM_MAIL_DRY_RUN'] === '1';
/** Pre-launch seatbelt: when set, anything outside the list is skipped, not sent. */
const ALLOWLIST = (process.env['NM_MAIL_ALLOWLIST'] ?? '')
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

/** User-facing destinations (download, billing, /join). The WEB app. */
export const APP_URL = process.env['NM_APP_URL'] ?? 'https://neuramesh.app';
/** Where THIS server answers. The unsubscribe route lives on the control-api, not the web app,
 *  so its link — and the List-Unsubscribe header Gmail calls — must resolve here or one-click
 *  unsubscribe silently 404s into the marketing site's SPA catch-all. */
export const API_URL = process.env['NM_API_URL'] ?? 'https://api.neuramesh.app';

export function mailEnabled(): boolean {
  return !!KEY || DRY_RUN;
}

/** Is this address allowed to receive mail right now? The allowlist is a deploy-time gate,
 *  separate from per-user opt-out (which is a query concern, not a transport one). */
export function allowedRecipient(to: string): boolean {
  return ALLOWLIST.length === 0 || ALLOWLIST.includes(to.trim().toLowerCase());
}

export interface SendResult {
  status: 'sent' | 'skipped' | 'failed';
  providerId?: string;
  error?: string;
}

/**
 * Hand one rendered email to Resend. Returns a result rather than throwing: the caller writes
 * the outcome onto the outbox row either way, and one bad address must never abort a batch.
 */
export async function sendEmail(input: {
  to: string;
  email: RenderedEmail;
  /** Lifecycle/broadcast only. Drives the List-Unsubscribe headers Gmail and Yahoo expect. */
  unsubscribeUrl?: string | null;
  fetchFn?: typeof fetch;
}): Promise<SendResult> {
  const { to, email } = input;
  if (!allowedRecipient(to)) {
    console.log(`mail_skipped to=${redact(to)} template_subject="${email.subject}" reason=allowlist`);
    return { status: 'skipped', error: 'not in NM_MAIL_ALLOWLIST' };
  }
  if (DRY_RUN || !KEY) {
    console.log(`mail_dry_run to=${redact(to)} subject="${email.subject}" bytes=${email.html.length}`);
    return { status: DRY_RUN ? 'skipped' : 'skipped', error: DRY_RUN ? 'NM_MAIL_DRY_RUN=1' : 'RESEND_API_KEY unset' };
  }

  const headers: Record<string, string> = {};
  if (input.unsubscribeUrl) {
    // One-click unsubscribe. Required of bulk senders by Gmail/Yahoo since Feb 2024; we do it
    // from the first email rather than the first complaint.
    headers['List-Unsubscribe'] = `<${input.unsubscribeUrl}>`;
    headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
  }

  const body: Record<string, unknown> = {
    from: FROM,
    to: [to],
    subject: email.subject,
    html: email.html,
    text: email.text, // multipart: HTML-only mail scores worse with spam filters
  };
  if (REPLY_TO) body['reply_to'] = REPLY_TO;
  if (Object.keys(headers).length) body['headers'] = headers;

  try {
    const res = await (input.fetchFn ?? fetch)('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
    if (!res.ok || !json.id) {
      const error = json.message ?? json.name ?? `resend responded ${res.status}`;
      console.error(`mail_failed to=${redact(to)} subject="${email.subject}" error="${error}"`);
      return { status: 'failed', error };
    }
    console.log(`mail_sent to=${redact(to)} subject="${email.subject}" id=${json.id}`);
    return { status: 'sent', providerId: json.id };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error(`mail_failed to=${redact(to)} error="${error}"`);
    return { status: 'failed', error };
  }
}

/** Logs carry addresses; keep them non-reconstructable. `ge****@example.com` */
function redact(to: string): string {
  const [user = '', domain = ''] = to.split('@');
  return `${user.slice(0, 2)}****@${domain}`;
}

// ── unsubscribe tokens ─────────────────────────────────────────────────────
// HMAC over the user id, so one-click unsubscribe needs no login and no lookup table, and a
// token can't be forged into someone else's preferences.

const SECRET = process.env['NM_MAIL_SECRET'] ?? process.env['CLERK_SECRET_KEY'] ?? 'dev-mail-secret';

export function unsubscribeToken(userId: string): string {
  const sig = createHmac('sha256', SECRET).update(userId).digest('base64url').slice(0, 32);
  return `${userId}.${sig}`;
}

export function unsubscribeUrl(userId: string): string {
  return `${API_URL}/u/${unsubscribeToken(userId)}`;
}

/** Verify a token from the unsubscribe route. Returns the user id, or null. */
export function verifyUnsubscribeToken(token: string): string | null {
  const i = token.lastIndexOf('.');
  if (i <= 0) return null;
  const userId = token.slice(0, i);
  const given = Buffer.from(token.slice(i + 1));
  const want = Buffer.from(createHmac('sha256', SECRET).update(userId).digest('base64url').slice(0, 32));
  if (given.length !== want.length || !timingSafeEqual(given, want)) return null;
  return userId;
}

/** The page behind a one-click unsubscribe link (app.ts /u/:token — moved here verbatim when
 *  the ratchet cap forced a leaf out of app.ts; the token half already lives above). Self-
 *  contained and themed — it is the last thing someone sees from us, so it should not look
 *  like a 500. */
export function unsubscribePage(ok: boolean): string {
  const title = ok ? "You're unsubscribed" : 'That link has expired';
  const body = ok
    ? 'You will not receive onboarding or product email from NeuraMesh again. Anything you asked for directly — an invitation, a failed post — still reaches you.'
    : 'We could not verify that unsubscribe link. Reply to any NeuraMesh email and we will take you off the list by hand.';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · NeuraMesh</title>
<style>
 :root{color-scheme:light dark;--ink:#38332d;--paper:#f4f2ed;--surface:#fbfaf7;--line:#e7e2da;--body:#585249}
 @media(prefers-color-scheme:dark){:root{--ink:#d9d5ce;--paper:#1b1a18;--surface:#201f1c;--line:#2a2825;--body:#b7b4ac}}
 *{margin:0;padding:0;box-sizing:border-box}
 body{background:var(--paper);color:var(--ink);font-family:'Geist',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;
      display:grid;place-items:center;min-height:100vh;padding:24px;-webkit-font-smoothing:antialiased}
 .c{max-width:460px;background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:34px}
 .m{display:flex;align-items:center;gap:9px;font-weight:800;letter-spacing:-.028em;margin-bottom:20px}
 .t{width:22px;height:22px;border-radius:7px;background:var(--ink);color:var(--paper);display:grid;place-items:center;font-size:12px}
 h1{font-size:24px;letter-spacing:-.026em;line-height:1.18;margin-bottom:12px}
 p{color:var(--body);font-size:15.5px;line-height:1.6}
</style></head><body><div class="c">
 <div class="m"><span class="t">N</span>NeuraMesh</div>
 <h1>${title}</h1><p>${body}</p>
</div></body></html>`;
}

// ── invite tokens ──────────────────────────────────────────────────────────
// The emailed token is random; only its sha256 is stored (0092), so a database read can
// never yield a working invite link.

export function inviteAcceptUrl(token: string): string {
  return `${APP_URL}/join?token=${encodeURIComponent(token)}`;
}
