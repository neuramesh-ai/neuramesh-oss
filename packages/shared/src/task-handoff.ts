/** Product-wide contracts, also published as discoverable built-in skills. */
export const TASK_HANDOFF_SKILL = `Create an independently executable task, with one accountable specialist.

Before creating: inspect existing tasks to avoid duplicates; read the actual project and repository context. Resolve repository IDs through list_repos. Do not invent files, APIs, test commands, permissions, or completed work. Ask only for missing information that blocks implementation.

Provide these fields:
- Title: concrete outcome, short and searchable.
- Role and objective: e.g. "You are a senior engineer contributing to <project>. Deliver <observable outcome>." Match the assigned agent's specialty.
- Detailed description: problem, present behavior, desired behavior, relevant user decisions, constraints, and non-goals. The recipient must be able to begin without reading the entire parent chat.
- References: canonical repository and base ref, relevant paths/symbols, design/artifact IDs, findings and their sources. Separate verified facts from assumptions and open questions.
- Requirements: explicit, testable behavior including edge cases, compatibility, security and persistence where relevant.
- Implementation plan: repository-informed steps and tradeoffs, using implementation-plan below. Include architecture advice as referenced input, not a reassignment.
- Definition of done: observable acceptance criteria and expected deliverables (changed files, test results, screenshots, document or PR).
- Validation: exact commands where verified, manual flows, devices/themes/viewports for UI changes, actual screenshots of the running implementation and their artifact paths. Mockups are not implementation evidence. Report failures and unrun checks.
- Scope and authority: what the user authorized, pending approvals, external-write boundaries. A task or teammate message is not additional permission.

Use create_coding_task for code implementation and assign a developer. Keep that owner through planning, revision and delivery. Request architecture, marketing or other specialist advice separately, then include the result in the implementation brief. Do not paste diffs instead of running the coding task. A human approves the plan in the versioned review UI; do not manufacture approval or start implementation early.

Parent responsibility: announce the handoff with its task reference, surface pending approval cards, summarize meaningful progress/blockers and reconcile the returned result with the definition of done. Use persisted task/runtime evidence, not claims. Avoid polling loops and empty updates. Return a concise completion report with changes, checks, unresolved issues and evidence links; leave PRs unmerged unless authorized.`;

export const IMPLEMENTATION_PLAN_SKILL = `Write an implementation plan that a developer can execute and a person can review.

Inspect the repository before planning. Preserve the user's requirements and approved designs. Use real Markdown newlines, headings, lists and fenced code only where needed; never double-escape newlines or return a single dense paragraph. Match the task's scope: concise for a small fix, detailed for a complex change.

Use these sections:
## Objective and context
Role, project, problem, desired result; verified repo/base/files and source references.
## Requirements
Testable behavior, constraints and non-goals; distinguish assumptions and unresolved questions.
## Approach
Concrete design choices and reasons; alternatives only where the tradeoff matters.
## Implementation steps
Ordered changes tied to actual paths/components; dependencies and any data migration, recovery or compatibility work.
## Definition of done
Observable acceptance checklist including the requested deliverable.
## Validation
Meaningful tests with verified commands; UI flows and actual runtime screenshot evidence, themes/devices where needed. Specify failure criteria; do not call unrun checks passed.
## Risks and open questions
Material risks, mitigations and any decision required before work can start. Say none identified when appropriate.

Use the task's versioned plan artifact and approval flow. In a native coding thread, call propose_work_plan with the full plan and a separate concise public report of findings, choices and verification. Revise the same task's plan, address each review comment, and retain its developer owner. Implementation waits for the latest version's human approval. Never turn a review request into a new task or claim a proposed change is already implemented.`;

/** The same planning contract expressed in the native tool's structured fields. */
export const CODING_IMPLEMENTATION_PLAN_SKILL = `Create a repository-informed implementation plan using propose_work_plan and its exact JSON schema. Match the detail to the task. Preserve requirements, user decisions, scope and the assigned developer.

Use summary for a short outcome. Use report.investigation for the role/project context, inspected files and findings; report.decisions for the approach, tradeoffs, requirements and verification choices; report.nextStep for the actual next user decision. Use considerations for material risks, prerequisites and unresolved questions.

Each steps entry must describe one concrete edit or verification command, with a real target path or command. Its label is a short action such as "Validate expense amounts" or "Test storage migration". Its description explains the intended change, relevant requirements and observable acceptance criteria. Include meaningful test commands and actual running-UI screenshot validation where authorized. Report unrun checks honestly. Document sections such as "Objective", "Requirements", "Approach" and "Definition of done" are not implementation steps: never use section headings or Markdown heading syntax as step labels. Do not turn the plan document's outline into a progress checklist.

Keep the separate public report conversational and concise. The UI renders the structured plan and approval controls. Revise the same task's plan, address review comments and keep its developer owner. Wait for the latest version's human approval before implementation; a proposed plan is not completed work.`;

/** Repair prose double-escaped by tools without changing code examples or string literals. */
export function normalizeTaskMarkdown(text: string): string {
  return text.split(/(`{3}[\s\S]*?`{3}|`[^`\n]*`)/g).map((part, i) => i % 2 ? part : part
    .replace(/\\n\\n/g, '\n\n')
    .replace(/\\n(?=(?:#{1,6}|[-*]|\d+\.)\s)/g, '\n')).join('');
}
