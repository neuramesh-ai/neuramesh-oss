import { createEngineeringPlanProgress, recoverEngineeringPlanProgress, updateEngineeringPlanProgress, isEngineeringWorkPlan, type EngineeringPlanProgress, type EngineeringRuntimeEvent } from '@neuramesh/shared';

/** A proposal records intent only. File and command execution still uses the normal gates. */
export function engineeringPlanTool(emit: (event: EngineeringRuntimeEvent) => void) {
  return {
    name: 'propose_work_plan',
    description: 'In Plan mode, record an implementation plan only when the user has requested changes and the plan is ready. Do not use for questions, explanations, research, or a list of possible ideas. Supply a formal plan plus a separate conversational report explaining your investigation, the reasons for key choices and the next step. The thread shows that report above the clickable card; the pane shows the formal plan. This does not execute anything.',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['summary', 'report', 'considerations', 'steps'],
      properties: {
        summary: { type: 'string', maxLength: 400, description: 'One or two short plain-language sentences explaining the outcome. Put details in the steps.' },
        report: { type: 'object', additionalProperties: false, required: ['investigation', 'decisions', 'nextStep'], description: 'Your conversational explanation for the user, distinct from the formal plan. Explain what you actually investigated, what you learned and chose, and what happens next. Do not copy or paraphrase the plan summary as your opening.', properties: {
          investigation: { type: 'string', maxLength: 600, description: 'One or two brief first-person sentences about what you actually inspected or established during this turn and the finding that shaped the plan. Do not claim edits or successful tests that you did not perform. On a revision, say what you reconsidered or resolved. Use inline Markdown without line breaks.' },
          decisions: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'string', maxLength: 300 }, description: 'Two or three key choices and WHY they fit the findings or user request, including how you intend to verify the result. Explain tradeoffs or material constraints in plain language, rather than copying the implementation checklist. No invented risks or re-opening decisions the user already made. Inline Markdown only, no line breaks.' },
          nextStep: { type: 'string', maxLength: 300, description: 'A clear conversational next step: select Continue in Act when ready for implementation, or answer a real unresolved question first. Distinguish work already done from proposed work. Do not say implementation or verification is complete. Inline Markdown without line breaks.' },
        } },
        considerations: { type: 'array', maxItems: 3, items: { type: 'string', maxLength: 240 }, description: 'Any important prerequisites, user decisions, compatibility constraints or material risks to understand before proceeding. Empty when none are known. Do not repeat key points, raise choices the user has already resolved, or turn routine implementation details into prerequisites. Do not invent warnings or claim the absence of risk. Use inline Markdown only, with no line breaks.' },
        steps: { type: 'array', minItems: 1, maxItems: 30, items: {
          type: 'object', additionalProperties: false, required: ['label', 'action', 'target', 'description'],
          properties: { label: { type: 'string', maxLength: 100, description: 'A short single-line step title for the progress checklist, about 4–9 words.' }, action: { type: 'string', enum: ['edit', 'command'] }, target: { type: 'string', description: 'A concrete file path or command to run.' }, description: { type: 'string' } },
        } },
      },
    },
    execute: (input: unknown) => {
      if (!isEngineeringWorkPlan(input)) throw new Error('A work plan needs a summary and at least one concrete edit or command.');
      const planProgress = createEngineeringPlanProgress(input, crypto.randomUUID());
      emit({ type: 'work_plan', planId: planProgress.id, plan: input });
      return { recorded: true, planProgress, message: 'The UI now shows your investigation, key decisions and next step above the plan card. The formal plan is in the pane. Your final response must be one short readiness sentence only. Do not repeat the report or plan already rendered for the user. No changes have been applied.' };
    },
  };
}

/** Progress lives in tool receipts, so a resumed model/device sees exactly the same checklist. */
export function engineeringProgressTool(emit: (event: EngineeringRuntimeEvent) => void, readMessages: () => Promise<unknown>) {
  // Native messages may only checkpoint at turn boundaries. Keep accepted updates within this
  // runtime, then reconstruct from receipts when a mode/model/device/checkpoint creates a new one.
  let current: EngineeringPlanProgress | null | undefined;
  let queue: Promise<void> = Promise.resolve();
  return {
    name: 'update_plan_progress',
    description: 'Record execution progress for the most recent successfully proposed work plan. Use its original one-based step numbers. Start a step before working; complete it only after successful tool results, including passing tests for verification steps. Approvals are not completion. Update the previous and next active steps together. This does not execute files or commands.',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['updates'], properties: {
        updates: { type: 'array', minItems: 1, maxItems: 30, items: { type: 'object', additionalProperties: false, required: ['step', 'status'], properties: {
          step: { type: 'integer', minimum: 1, maximum: 30 }, status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
        } } },
      },
    },
    execute: (input: unknown) => {
      const result = queue.then(async () => {
        if (current === undefined) current = recoverEngineeringPlanProgress(await readMessages());
        if (!current) throw new Error('No recorded work plan is available. Continue the task without inventing progress.');
        const planProgress = updateEngineeringPlanProgress(current, (input as { updates?: unknown } | null)?.updates);
        current = planProgress;
        emit({ type: 'plan_progress', progress: planProgress });
        return { recorded: true, planProgress };
      });
      queue = result.then(() => {}, () => {});
      return result;
    },
  };
}
