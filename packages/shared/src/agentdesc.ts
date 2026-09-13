// What an agent of each role does, and when to route work to it — the starting `description`
// (0110) for an agent nobody has described yet.
//
// It lives here because THREE paths create agents and they were all writing different things, or
// nothing: the onboarding wizard mints the starter crew (rex · iris · atlas · patch · scout ·
// bosun), the boot seeds backfill a missing designer/shipper/marketer, and the orchestrator hires
// specialists. Seed text written in only one of those reaches almost nobody — the wizard creates
// iris directly, so `planDesignerSeed` skips it as "already has a designer" and the designer's
// description was never applied even in a brand-new workspace (founder report: rex and iris open
// with both fields blank).
//
// These are DEFAULTS, not identity. A role default cannot tell two developers apart, which is the
// whole job of a description — so it is a floor that makes the hover card, the roster and the A2A
// card honest on day one, and the human (or the orchestrator, at hire) writes the real one. Every
// line follows the shape the research settled on: capability first, then the trigger.
import type { AgentRole } from './states';

export const ROLE_DESCRIPTION: Record<AgentRole, string> = {
  orchestrator:
    'Runs this room: turns requests into scoped tasks, routes them to the right teammate, and keeps the board moving. Route anything that needs triage, staffing, or a status answer here.',
  architect:
    'Turns approved requirements and designs into implementation-ready plans. Route work whose approach is genuinely non-obvious and needs settling before anyone builds.',
  developer:
    'Implements board tasks in a worktree and submits a PR with evidence. Route bug fixes, features and refactors — anything where the change lands in code.',
  worker:
    'Research, analysis and report-style deliverables. Route investigations, comparisons and write-ups that need sourcing rather than shipping.',
  reviewer:
    'Gates submitted work against its Definition of Done and the PR checks. Route review rounds; it approves or sends work back with specifics.',
  designer:
    'Designs user-facing work before it is built — mockups studied from the repo’s real design tokens, and the images marketing posts carry. Route any visual or UI-shaped task here.',
  marketer:
    'Brand and growth — brand docs, positioning, and platform-native content in the product’s voice. Route posts, campaigns, launch copy and messaging here; never code.',
  shipper:
    'Production readiness and release coordination. Route reviewer-approved work that has to reach prod — deploy steps, release plans, merge gates.',
  curator:
    'Keeps the team’s skill library: promotes what works, retires what does not. Route skill and convention curation here.',
  sales:
    'Outbound, prospect research and customer-facing follow-up. Route pipeline and account work here.',
};

/** The default description for a role, or null for a role we have nothing useful to say about. */
export function defaultDescription(role: string): string | null {
  return ROLE_DESCRIPTION[role as AgentRole] ?? null;
}
