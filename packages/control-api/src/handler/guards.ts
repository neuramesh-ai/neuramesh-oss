// Actor identity + capability guards — extracted from handler.ts (track C1).
// Who an actor IS and what it may do, in one place: every command branch reads these
// rather than restating the rule.
import { formatAddress, type Actor, type ActorRef, type Task } from '@neuramesh/shared';
import { clerkPrimaryEmail } from '../clerk';
import { DomainError } from '../errors';
import type { Store } from '../store';

export function actorAddress(actor: Actor): string {
  return formatAddress({ kind: actor.kind, id: actor.id });
}

/**
 * The address this caller has actually PROVEN they own — the single gate on answering an
 * invitation. When Clerk is configured we re-read its primary email and demand `verified`,
 * rather than trusting the copy nm_users cached at sign-in: an address can be replaced or lose
 * verification after the row was written, and this is exactly the boundary where that matters.
 *
 * With no CLERK_SECRET_KEY (dev stack, tests) clerkPrimaryEmail returns null and we fall back to
 * the stored address. That is the dev/legacy identity path, where the JWT sub IS our uuid and
 * there is no provider to ask.
 */
export async function verifiedEmailFor(store: Store, userId: string): Promise<string | null> {
  const identity = await store.userIdentity(userId);
  if (!identity) return null;
  if (identity.clerkUserId) {
    const primary = await clerkPrimaryEmail(identity.clerkUserId);
    // A configured Clerk that says "not verified" is a REFUSAL, not a reason to fall back to the
    // cached address — falling back would hand the unverified case exactly what it wants.
    if (primary) return primary.verified ? primary.email : null;
  }
  return identity.email;
}

export function sameActor(ref: ActorRef | null, actor: Actor): boolean {
  return ref !== null && ref.kind === actor.kind && ref.id === actor.id;
}

// who may author/curate the skill library: humans, the orchestrator, or the
// dedicated Curator agent (imports packs + curates). Workers only propose.
export function mayCurate(actor: Actor): boolean {
  return actor.kind === 'human' || actor.role === 'orchestrator' || actor.role === 'curator';
}

// Agent permission policy is security config — humans configure it (Phase 2 adds the
// orchestrator for contextual, task-scoped generation). Never a worker or a subject agent.
export function mayConfigurePolicy(actor: Actor): boolean {
  return actor.kind === 'human';
}

/**
 * The confirm-card FLOOR under agent-issued creates that must never happen silently
 * (2026-08-18 audit, doctrine §4: "confirm first via card" lived only in prompt etiquette,
 * while the server allowed the orchestrator both project.create and agent.register
 * unconditionally — a silent hire or project was one bad turn away).
 *
 * The floor: a decision CARD naming the thing must be on file in this workspace, recent. A
 * clicked accept arrives with the card `answered`; the documented free-text path ("the human
 * approves in their own words") arrives while the card is still `open` — both pass, because the
 * card EXISTS and is in front of the human. What cannot pass is the silent path: no card was
 * ever posted. Dismissed cards are a decline and do not count.
 */
export async function requireConfirmCard(store: Store, workspace: string, needle: string, what: string): Promise<void> {
  const RECENT_MS = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const target = needle.trim().toLowerCase();
  const decisions = await store.listDecisions(workspace);
  const card = decisions.find((d) =>
    d.status !== 'dismissed'
    && d.question.toLowerCase().includes(target)
    && now - Date.parse(d.createdAt) < RECENT_MS,
  );
  if (!card) {
    throw new DomainError('CONFIRM_CARD_REQUIRED',
      `${what} needs the human's confirmation card first: post an nmq card naming "${needle}" and act only on their answer — never silently`);
  }
}

// parse a GitHub repo reference into its parts. v1 = public github.com only; the
// executing machine's own git creds authenticate at push time (no tokens stored).
// Accepts a full URL, a scheme-less github.com/<org>/<repo>, or an <org>/<repo>
// shorthand — so the orchestrator can attach a repo the human named loosely.
export function parseRepoUrl(raw: string): { provider: string; orgName: string; name: string; cloneUrl: string } {
  const s = raw.trim().replace(/\.git$/, '').replace(/\/+$/, '');
  const gh = /^(?:https?:\/\/)?github\.com\/([\w.-]+)\/([\w.-]+)$/.exec(s);
  if (gh) return { provider: 'github', orgName: gh[1]!, name: gh[2]!, cloneUrl: `https://github.com/${gh[1]}/${gh[2]}.git` };
  const bare = /^([\w][\w.-]*)\/([\w][\w.-]*)$/.exec(s); // bare <org>/<repo> → assume github
  if (bare) return { provider: 'github', orgName: bare[1]!, name: bare[2]!, cloneUrl: `https://github.com/${bare[1]}/${bare[2]}.git` };
  // v1 is github-only (the PR flow runs on `gh`); a non-github host can't be pushed/PR'd, so reject it
  // rather than store a repo the loop can never use.
  throw new DomainError('INVALID_INPUT', 'paste a public GitHub repo URL, e.g. https://github.com/<org>/<repo>');
}

// a project's display name → a base url-slug; the store resolves it to a
// workspace-unique slug (appends -2, -3… on collision).
export function slugify(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'project';
}

export function taskTarget(task: Task): string {
  return `task:${task.number}`;
}
