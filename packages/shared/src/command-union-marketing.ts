import { z } from 'zod';
import { MARKETING_RELEASES, SETUP_RELEASES_VALUE } from './command-union-schedule';

export const MARKETING_COMMANDS = [
  // Start or resume project-owned marketing setup without changing the project's conversation kind.
  z.object({ type: z.literal('marketing.start'), project: z.string().uuid() }),
  // marketing HQ setup (marketing-channel plan §4.3): point the room at the product. Writes the
  // profile onto channels.marketing and fans out the bootstrap task ("Build the brand foundation")
  // through the ordinary task path, so triage/staffing take it from there. Human-only; FREE on
  // every plan by design (round 2), and so is the daily release watch it plants (2026-10-03).
  z.object({
    type: z.literal('marketing.setup'),
    channel: z.string().min(1), // channel id
    website: z.string().trim().max(400).optional(),
    focus: z.array(z.enum(['social', 'content', 'seo', 'email', 'ads'])).max(5).optional(),
    goal: z.string().trim().max(300).optional(), // the human's stated aim, in their words
    // step 5, release drafts (docs/design/release-drafts-2026-09 §4.7): the repository to watch,
    // draft the latest release now (a free one-shot), watch daily (a Team routine)
    releases: MARKETING_RELEASES.optional(),
  }),
  // flip one marketing MCP integration on the room (marketing.mcp.<provider>) — the daemon
  // attaches the enabled servers to marketer research runs with MACHINE-LOCAL creds
  // (integrations-and-skills-plan.md: read paths local, publish custody stays ours)
  z.object({
    type: z.literal('marketing.set_integration'),
    channel: z.string().min(1), // channel id
    provider: z.enum(['posthog', 'x', 'meta', 'tiktok']),
    enabled: z.boolean(),
  }),
  // one answered SETUP-FLOW step (shared/setupflows.ts), written as it lands — what makes an
  // abandoned wizard resumable. flow/step must name a registered flow; the value's shape is
  // checked against the step in the handler (a website string vs a focus array). Human-only:
  // setup is the human's checklist by construction, like the flow's completing command.
  z.object({
    type: z.literal('setup.step'),
    channel: z.string().min(1), // channel id
    flow: z.string().min(1), // the registered flow id, e.g. 'marketing.v1'
    step: z.string().min(1), // a step id of that flow
    value: z.union([z.string().trim().max(400), z.array(z.string().trim().max(40)).max(8), SETUP_RELEASES_VALUE]).optional(),
  }),
  // release-day backfill (idempotent, daemon boot): setup tasks for flow-bearing rooms that
  // predate setup flows and were never configured. Returns how many were created.
  z.object({ type: z.literal('setup.backfill'), workspace: z.string().min(1) }),
] as const;
