// THE COMPUTE NOTICES — what an agent says when no machine can serve a message — as DATA, in one
// place (2026-09-16). wakerouting.ts posts them; the routine resume (host/routineresume.ts) has to
// recognise them as "a reason nobody answered", never as an answer, and two copies of a string
// drift the day one of them is edited. Prefix-matched on the way back in, so the pre-2026-09
// wording (an em dash after "right now") still reads as a notice in an old thread.
//
// THE REASON IS SAID (George, 2026-09-16: "make the notice say the real reason"). The ladder knows
// only that this machine cannot serve the runtime; the credential probe knows WHY — the login on
// this machine expired, or there never was one — and the person can act on that in ten seconds.
// "No machine available" stays for the case the probe cannot explain.
import type { AuthResolution } from './runtime/authpolicy';

export type NoComputeReason = 'expired' | 'missing' | null;

/** why THIS machine cannot serve, from its own credential probe (agents.ts resolveToken) */
export function noComputeReasonOf(cred: Pick<AuthResolution, 'authMode' | 'blocked'> | null | undefined): NoComputeReason {
  if (!cred) return null;
  if (cred.blocked) return cred.blocked.reason === 'expired' ? 'expired' : 'missing';
  return cred.authMode === 'none' ? 'missing' : null;
}

export function noComputeNotice(a: { label: string; reason: NoComputeReason; cloudLacksLogin?: boolean }): string {
  const why = a.reason === 'expired'
    ? `The ${a.label} login on this machine expired.`
    : a.reason === 'missing'
      ? `This machine has no ${a.label} login.`
      : `No machine available to me can serve ${a.label}.`;
  const cloud = a.cloudLacksLogin ? ` Your cloud machine has no ${a.label} login either.` : '';
  const again = a.reason === 'expired' ? 'again ' : '';
  return `I can't run this now. ${why}${cloud} Sign in to ${a.label} ${again}on this machine, or ask a teammate to lend you a machine in Settings › Compute › Sharing.`;
}

/** the NeuraMesh brain refused the turn for credits (2026-09-25): the reason and the two ways on,
 *  never silence. The Add credits button lives on the attention bar (shared alerts.ts). */
export function noCreditsNotice(): string {
  return "I can't reply now. This workspace is out of credits. Add credits in Credits, or connect your own brain in Settings.";
}
/** how the Starter lane's refusal reads on the way out (host/orchturn.ts), so the wake can tell it apart */
export const NO_CREDITS_ERROR = 'out of credits';
export function isNoCreditsError(err: unknown): boolean {
  return err instanceof Error && err.message.startsWith(NO_CREDITS_ERROR);
}
export function sleeperNotice(whose: string, runtime: string): string {
  return `Waking ${whose}. It holds the ${runtime} login this needs. Your message is answered once it is up, usually within a couple of minutes.`;
}

/** true for the no-compute notice (any wording), the sleeper notice, and the auth-blocked card */
export function isComputeNotice(body: string | null | undefined): boolean {
  if (!body) return false;
  return /^I can't run this/.test(body)
    || /^I can't reply now\. This workspace is out of credits/.test(body)
    || /^Waking (?:your|a teammate's) cloud machine/.test(body)
    || /```nmauth\b/.test(body);
}
