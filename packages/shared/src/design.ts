import { trimEndChars } from './linear';

export const DESIGN_PROVIDERS = ['iris', 'claude-design'] as const;
export type DesignProvider = (typeof DESIGN_PROVIDERS)[number];

export const CLAUDE_DESIGN_MCP_URL = 'https://api.anthropic.com/v1/design/mcp';
export const CLAUDE_DESIGN_APP_URL = 'https://claude.ai/design';
export const DESIGN_PROVIDER_QUESTION = 'Where should Iris draft this?';

export const DESIGN_PROVIDER_OPTIONS = [
  {
    label: 'Draft here with Iris',
    description: 'Fast, self-contained HTML mockups in this task.',
    icon: 'iris',
    provider: 'iris',
  },
  {
    label: 'Use Claude Design',
    description: 'Work in an editable canvas, then let Iris sync the review snapshot here.',
    icon: 'claude-design',
    provider: 'claude-design',
  },
] as const;

export function designProviderFromDecision(
  answer: string,
  options: Array<{ label: string; provider?: string }>,
): DesignProvider | null {
  const provider = options.find((o) => o.label === answer)?.provider;
  return provider === 'iris' || provider === 'claude-design' ? provider : null;
}

export function designProviderQuestionBlock(): string {
  return `\`\`\`nmq\n${JSON.stringify({
    question: DESIGN_PROVIDER_QUESTION,
    kind: 'design-provider',
    options: DESIGN_PROVIDER_OPTIONS,
    allowOther: false,
  })}\n\`\`\``;
}

/** Latest design request wins; revision rounds keep the provider selected at routing time. */
export function designProviderFromEvents(
  events: Array<{ type: string; payload?: Record<string, unknown> | null }>,
): DesignProvider | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event?.type !== 'task.design_provider_selected' && event?.type !== 'task.design_requested') continue;
    const provider = event.payload?.['provider'];
    if (provider === 'claude-design' || provider === 'iris') return provider;
  }
  return null;
}

/**
 * Accept only a concrete Claude Design project link, never the home/settings fallback.
 *
 * The project id must be a WHOLE uuid. A prefix used to pass — and that is not
 * theoretical: #1034 shipped `…/design/p/9c0ce167-0db6-4c46-858f-2c` into the thread
 * because the link was harvested from a tool-result log line that had already been
 * sliced to 160 chars mid-uuid. claude.ai answers a cut id with "Project not found",
 * so a lenient match here durably persists a dead link. Rather drop it than post it.
 */
const CLAUDE_DESIGN_PROJECT_PATH = /^\/design\/p\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:\/|$)/i;

export function claudeDesignUrlFromText(text: string | null | undefined): string | null {
  const candidates = (text ?? '').match(/https:\/\/claude\.ai\/design(?:\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*)?(?:\?[A-Za-z0-9._~!$&'()*+,;=:@%/?-]*)?/g) ?? [];
  for (const raw of candidates) {
    try {
      const url = new URL(trimEndChars(raw, '),.;'));
      if (url.protocol === 'https:' && url.hostname === 'claude.ai' && CLAUDE_DESIGN_PROJECT_PATH.test(url.pathname)) return url.toString();
    } catch { /* malformed model output */ }
  }
  return null;
}

/**
 * The PROJECT root of a Claude Design link — `https://claude.ai/design/p/<uuid>`, with any file
 * path, query or fragment stripped.
 *
 * `claudeDesignUrlFromText` deliberately keeps whatever the agent posted, because a link to one
 * direction is a useful link. But the handoff card's button says **Open Claude Design**, which
 * is a promise about the PROJECT: opening it on `?open_file=direction-1.html` drops the human
 * into the first direction with no way to reach the other two (George, live 2026-08-11). A
 * control that names the project opens the project.
 */
export function claudeDesignProjectUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const hit = /^\/design\/p\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(u.pathname);
    if (u.protocol !== 'https:' || u.hostname !== 'claude.ai' || !hit) return null;
    return `https://claude.ai/design/p/${hit[1]!.toLowerCase()}`;
  } catch { return null; }
}

export function claudeDesignPromptBlock(taskNumber?: number, title?: string): string {
  const projectName = taskNumber ? `#${taskNumber} ${(title ?? '').trim()}`.trim().slice(0, 80) : 'the task number and title';
  return `CLAUDE DESIGN MODE — the human explicitly chose Claude Design for this round. You are still the designer and you still own the NeuraMesh design workflow.

THE POINT OF THIS MODE IS AN EDITABLE PROJECT THE HUMAN CAN OPEN. Reading existing projects is not this mode; a round that leaves nothing to open has failed its one job.
1. Call \`create_project\` FIRST, named exactly "${projectName}". Do NOT reuse or write into an existing project — every task gets its own, or the human opens someone else's work.
   (A rework round reuses THIS task's project from the earlier round if you can identify it by that name; otherwise create it.)
2. Build the design in that project with \`write_files\` — that is the canvas the human will edit.
3. THEN export the current revision as self-contained HTML into .nm-evidence/design/. The daemon collects those files and proposes them through the normal human review gate.

- Never skip the exported HTML snapshot: the approved snapshot, not the mutable external project, is the visual contract the architect and the build receive.
- The project link is taken from your create_project call, not from your prose — do not paste project URLs you found by listing projects; they are other people's work.
- If you cannot create a project (consent not granted, tool unavailable), say so plainly in your summary and deliver the HTML mockups anyway. An honest snapshot-only round is fine; a link to an unrelated project is not.`;
}
