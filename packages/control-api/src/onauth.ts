// What happens the first time an identity resolves: claim pending invitations, and send the
// welcome email. Called from every auth path (/auth/clerk, /auth/clerk/password,
// /auth/clerk/signup, /auth/desktop/complete) — resolveClerkUser is the ONE place they all
// converge, so this is the only hook that cannot be bypassed by a sign-in route.
//
// Fire-and-forget from the caller's point of view: a mail outage must never fail a sign-in.
import { FREE_SEAT_CAP, planLabel, renderJoined, renderWelcome } from '@neuramesh/shared';
import { ensureFirstWorkspace } from './first-workspace';
import { APP_URL, sendEmail, unsubscribeUrl } from './mail';
import type { Store } from './store';

export interface AuthArrival {
  userId: string;
  email: string | null;
  /** Has the auth provider VERIFIED this address? Invites are claimed on the verified email —
   *  matching an unverified one would let anyone join a workspace by claiming someone's
   *  address at sign-up. Unknown => treat as unverified. */
  emailVerified: boolean;
  /** resolveClerkUser's `created` — true only on the very first resolution of this identity. */
  isNew: boolean;
  /** Clerk's first_name, when the profile has one: it names the workspace a first sign-in creates. */
  firstName?: string | null;
}

/**
 * Reports the invitations WAITING on this arrival's verified address — it no longer joins them
 * to anything (0113). Signing in used to write the membership itself, which had two costs: an
 * already-signed-in user never got one (the claim only ran on a sign-in event, and the desktop's
 * token refresh doesn't come through here), and a single stray invite silently bound an account
 * to a workspace it had no way to leave. Accepting is now its own act — see
 * `workspace.accept_invite`. Never throws.
 */
export async function onAuthArrival(store: Store, a: AuthArrival): Promise<{ pending: string[] }> {
  const pending: string[] = [];
  try {
    if (a.email && a.emailVerified) {
      for (const inv of await store.pendingInvitesForEmail(a.email)) {
        pending.push(inv.workspaceId);
        console.log(`invite_pending user=${a.userId} workspace=${inv.workspaceId} role=${inv.role}`);
      }
    }

    // The first hosted sign-in creates the workspace (first-workspace.ts): a person with no
    // membership and no invitation waiting gets one, through workspace.create, once. Awaited, so
    // the site's very next GET /v1/workspaces already lists it.
    await ensureFirstWorkspace(store, { userId: a.userId, email: a.email, firstName: a.firstName ?? null, pending });

    // Welcome. Suppressed when an invitation is waiting: the first thing they'll see is a card
    // asking whether to join someone's workspace, so the solo "your crew, named" tour is the
    // wrong first email — whether or not they end up saying yes.
    if (a.isNew && a.email && pending.length === 0) {
      const rendered = renderWelcome({
        downloadUrl: `${APP_URL}/downloads`,
        unsubscribeUrl: unsubscribeUrl(a.userId),
      });
      await queueAndSend(store, {
        userId: a.userId, toEmail: a.email, template: 'welcome',
        kind: 'lifecycle', dedupeKey: `welcome:${a.userId}`,
      }, rendered, unsubscribeUrl(a.userId));
    }
  } catch (e) {
    // A sign-in must never fail because mail did.
    console.error('on_auth_arrival failed:', e instanceof Error ? e.message : e);
  }
  return { pending };
}

/** The inviter's "they joined" email — fires on ACCEPT now, not on sign-in, because that is when
 *  the membership actually exists. Fire-and-forget: a mail outage must never fail the join. */
export async function onInviteAccepted(
  store: Store,
  a: { joinedEmail: string; workspaceId: string; workspaceName: string; role: string; inviterEmail: string | null; seatsUsed: number; plan: string; userId: string },
): Promise<void> {
  try {
    if (!a.inviterEmail) return;
    const seatLine = a.plan === 'cloud' ? null : `${a.seatsUsed} of ${FREE_SEAT_CAP} · ${planLabel('free')} plan`;
    const rendered = renderJoined({
      joinedEmail: a.joinedEmail, workspace: a.workspaceName, role: a.role,
      seatLine, settingsUrl: `${APP_URL}/downloads`,
    });
    await queueAndSend(store, {
      workspace: a.workspaceId, toEmail: a.inviterEmail, template: 'joined',
      kind: 'transactional', dedupeKey: `invite_accepted:${a.workspaceId}:${a.userId}`,
    }, rendered, null);
  } catch (e) {
    console.error('on_invite_accepted failed:', e instanceof Error ? e.message : e);
  }
}

/** Outbox row first, then transport: a failed send leaves a retryable row, and the UNIQUE
 *  dedupe_key means a retry (or a second host) can never double-send. */
export async function queueAndSend(
  store: Store,
  meta: {
    workspace?: string | null; userId?: string | null; toEmail: string; template: string;
    kind: 'transactional' | 'lifecycle' | 'broadcast'; dedupeKey: string; payload?: unknown;
  },
  rendered: { subject: string; preheader: string; html: string; text: string },
  unsubUrl: string | null,
): Promise<'sent' | 'skipped' | 'failed' | 'duplicate'> {
  // lifecycle + broadcast respect opt-out; transactional never does
  if (meta.kind !== 'transactional' && meta.userId && (await store.emailSuppressed(meta.userId))) {
    return 'skipped';
  }
  const row = await store.enqueueEmail({ ...meta, subject: rendered.subject });
  if (!row) return 'duplicate'; // already queued or sent — the constraint did its job
  const r = await sendEmail({ to: meta.toEmail, email: rendered, unsubscribeUrl: unsubUrl });
  await store.markEmail(row.id, { status: r.status, providerId: r.providerId ?? null, error: r.error ?? null });
  return r.status;
}
