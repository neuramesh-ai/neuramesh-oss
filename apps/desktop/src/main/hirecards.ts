// Hire cards — the copy a human answers to approve a hire, and how an answer resolves back
// to a role. Split out of seed.ts.
import { runtimeForModel, type AgentRole } from '@neuramesh/shared';
import { AGENT_NAME_RE, HIREABLE_ROLES, HIRE_DECLINE_LABEL, hireAcceptLabel, hireQuestion } from './hire';

// The clicked accept posts "**<question>** → <accept label>" (QuestionFlow's
// answer format); this extracts [1] the task number (optional), [2] the name,
// [3] the role TEXT. The role group deliberately accepts ANY parenthesized text,
// not just HIREABLE_ROLES: the card label is LLM-authored and drifts (the #1010
// failure wrote the specialty — "(marketing strategist)" — where the role goes;
// the old enum-only alternation dropped the human's click on the floor, and the
// LLM fallback stood down because clicked accepts are the system's to execute).
// A click on a hire card is ALWAYS a hire: match it, then resolveHireRole() maps
// drifted text to a real role instead of losing the confirmation.
import { descriptionFor, type AgentHireFacts, type AgentHirePlan, type HireableRole } from './seed';

export const HIRE_CONFIRM_RE = new RegExp(
  String.raw`\*\*Hire a new agent for #[a-z0-9._-]+(?: to take #(\d+))?\?\*\*\s*(?:→|->)\s*Hire @?([a-z0-9][a-z0-9._-]*)\s*\(([^)\n]{1,60})\)`,
  'i',
);

// Resolve the answer line's "(<role>)" capture to a hireable role. Precedence:
// a valid answer-line role → the card JSON's machine `hire.role` → `worker` (the
// research/analysis/report class — the right default for a specialist whose label
// named a specialty instead of a role). `fellBack` tells the caller the label text
// wasn't a role, so it can be preserved as the brief rather than lost.
export function resolveHireRole(answerRole: string, cardRole?: string | null): { role: HireableRole; fellBack: boolean } {
  const a = answerRole.trim().toLowerCase();
  if ((HIREABLE_ROLES as readonly string[]).includes(a)) return { role: a as HireableRole, fellBack: false };
  const c = (cardRole ?? '').trim().toLowerCase();
  if ((HIREABLE_ROLES as readonly string[]).includes(c)) return { role: c as HireableRole, fellBack: true };
  return { role: 'worker', fellBack: true };
}

// One prose spec of the exact card shape, interpolated into BOTH the
// create_agent tool description and the channel prompt's staffing rule so the
// format the LLM emits and the format the confirm watch parses cannot drift.
export const HIRE_CARD_SPEC =
  'The hire card is an nmq block whose question is EXACTLY `Hire a new agent for #<channel>?` ' +
  '(append ` to take #<task number>` when a task is waiting), with option one labeled EXACTLY ' +
  `\`Hire @<name> (<role>)\` where <role> is one of ${HIREABLE_ROLES.join('|')} — the specialty ` +
  '(e.g. "marketing strategist") goes in the description and the `hire.brief`, NEVER in the ' +
  'parentheses (description = the one-line specialty remit), option two `Not now`, ' +
  'allowOther true, and a machine field `hire` = {"name","role","brief","taskNumber"} mirroring ' +
  'the proposal. A clicked accept is executed by the system directly — you only act when the ' +
  'human replies in their own words.';

/** Full message body (lead line + nmq block) proposing a hire — used verbatim
 * by the echo stub and as the reference shape for the live prompt/tool. The
 * `hire` field rides inside the nmq JSON (the renderer ignores unknown keys) so
 * the deterministic confirm can recover the brief without parsing prose. */
export function buildHireCard(p: {
  chanSlug: string;
  name: string;
  role: HireableRole;
  taskNumber?: number;
  remit?: string;
  brainNote?: string;
}): string {
  const remit = p.remit ?? `${p.role} for #${p.chanSlug}`;
  const card = {
    question: hireQuestion(p.chanSlug, p.taskNumber),
    options: [
      { label: hireAcceptLabel(p.name, p.role), description: p.brainNote ? `${remit} · ${p.brainNote}` : remit },
      { label: HIRE_DECLINE_LABEL, description: `leave ${p.taskNumber ? `#${p.taskNumber}` : 'the work'} unassigned — staff the room later from the Agents view` },
    ],
    allowOther: true,
    hire: { name: p.name, role: p.role, brief: p.remit ?? null, taskNumber: p.taskNumber ?? null },
  };
  const lead = p.taskNumber
    ? `Nobody registered to #${p.chanSlug} can take #${p.taskNumber} — I can hire a specialist for it.`
    : `Nobody registered to #${p.chanSlug} fits this work — I can hire a specialist.`;
  return `${lead}\n\n\`\`\`nmq\n${JSON.stringify(card)}\n\`\`\``;
}

/** The design approval gate releases a task into planning. If that room has no
 * architect, turn the otherwise-silent staffing hole into a task-linked nmq
 * decision. Existing workspace architects are added; only an empty workspace
 * proposes a human-approved hire. The hire card deliberately has no task number:
 * adding the new architect to the room wakes the board-driven planning flow, while
 * the generic hire confirmer must not try to `task.offer` a planning task. */
export function buildPlanningArchitectCard(p: {
  chanSlug: string;
  taskNumber: number;
  existingArchitect?: string | null;
  hireName?: string;
}): string {
  const lead = `🏗 Planning handoff for #${p.taskNumber}: the design is approved, but #${p.chanSlug} has no architect yet.`;
  if (p.existingArchitect) {
    const name = p.existingArchitect;
    const card = {
      question: `Add @${name} to #${p.chanSlug}?`,
      options: [
        { label: `Add @${name}`, description: `${name} joins #${p.chanSlug} and starts the implementation plan for #${p.taskNumber}` },
        { label: 'Not now', description: `keep #${p.taskNumber} waiting in planning` },
      ],
      allowOther: true,
    };
    return `${lead} @${name} already works in this workspace — add them here to continue.\n\n\`\`\`nmq\n${JSON.stringify(card)}\n\`\`\``;
  }
  const name = p.hireName ?? 'atlas';
  const card = {
    question: hireQuestion(p.chanSlug),
    options: [
      { label: hireAcceptLabel(name, 'architect'), description: `Plan approved designs and turn them into implementation-ready build contracts for #${p.chanSlug}` },
      { label: HIRE_DECLINE_LABEL, description: `keep #${p.taskNumber} waiting in planning — staff the room later from the Agents view` },
    ],
    allowOther: true,
    hire: { name, role: 'architect', brief: `Turn approved designs in #${p.chanSlug} into implementation-ready plans.`, taskNumber: null },
  };
  return `${lead} There isn't an architect elsewhere in this workspace, so I can create one with your approval.\n\n\`\`\`nmq\n${JSON.stringify(card)}\n\`\`\``;
}

export function planAgentHire(f: AgentHireFacts): AgentHirePlan {
  const name = f.name.trim().toLowerCase();
  if (!AGENT_NAME_RE.test(name)) {
    return { action: 'refuse', reason: `"${f.name}" isn't a valid agent name — lowercase letters/digits with . _ -, starting with a letter or digit` };
  }
  if (!(HIREABLE_ROLES as readonly string[]).includes(f.role)) {
    return { action: 'refuse', reason: `"${f.role}" isn't a hireable role — pick one of: ${HIREABLE_ROLES.join(', ')}` };
  }
  const e = f.existing;
  if (e && !e.retired) {
    // register upserts by name WITHOUT changing role — never repoint a live
    // agent (the iris doctrine above): its machine/brain would be stolen silently.
    if (e.inChannel) return { action: 'refuse', reason: `@${name} is already registered to this channel — offer them the task instead of hiring` };
    if (e.role === f.role) return { action: 'add_to_channel', reason: `@${name} (${e.role}) already works elsewhere in this workspace — adding them to the channel instead of hiring a duplicate` };
    return { action: 'refuse', reason: `an agent named @${name} already exists with role ${e.role} — registering never changes role, so pick a different name for a ${f.role}` };
  }
  if (e && e.retired && e.role !== f.role) {
    return { action: 'refuse', reason: `@${name} is retired with role ${e.role} — re-registering that name rehires them as-is; pick a new name for a ${f.role}` };
  }
  const rehire = !!e; // retired same-role: the upsert clears retired_at — history stays attached
  // pack-default brain for the role; an unmanaged/unknown pack falls back to the
  // ORCHESTRATOR'S OWN brain (its credentials are proven working right now) —
  // never the server default, which may name a provider this workspace can't run.
  const packModel = f.packRoles?.[f.role as AgentRole] ?? null;
  const model = packModel ?? f.orchestrator.model;
  const runtime = packModel ? runtimeForModel(packModel) : f.orchestrator.runtime;
  return {
    action: 'register',
    rehire,
    model,
    runtime,
    cmd: {
      type: 'agent.register',
      workspace: f.workspace,
      machineId: f.machineId,
      name,
      role: f.role,
      model,
      runtime,
      channels: [f.channelId],
      ...(descriptionFor(f.description, f.brief, f.role) ? { description: descriptionFor(f.description, f.brief, f.role) } : {}),
      ...(f.brief ? { brief: f.brief } : {}),
    },
  };
}
