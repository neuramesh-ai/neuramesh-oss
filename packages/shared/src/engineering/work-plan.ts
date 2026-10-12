import type { EngineeringWorkPlan } from './handoff';
import type { EngineeringMessage, EngineeringSession } from './domain';

/** Older clients stored the latest plan outside the transcript. Recover its position from the
 * proposal receipt or timestamp. New proposals are explicit messages and retain every revision. */
export function engineeringWorkPlanMessages(session: EngineeringSession): EngineeringMessage[] {
  const { messages, workPlan } = session;
  if (!workPlan?.trim() || messages.some((item) => item.kind === 'work_plan' && item.body === workPlan)) return messages;
  const lastIndex = (test: (item: EngineeringMessage) => boolean) => {
    for (let i = messages.length - 1; i >= 0; i--) if (test(messages[i]!)) return i;
    return -1;
  };
  let index = lastIndex((item) => item.role === 'tool' && /propose[_ ]work[_ ]plan/i.test(item.body));
  if (index < 0 && session.pendingModeHandoff?.toolName !== 'propose_work_plan'
    && !messages.some((item) => item.tone === 'plan' && item.body === workPlan)) return messages;
  const createdAt = session.pendingModeHandoff?.createdAt;
  if (index < 0 && createdAt) index = lastIndex((item) => item.createdAt <= createdAt);
  if (index < 0) index = messages.length - 1;
  const anchor = messages[index];
  const plan: EngineeringMessage = { id: `stored-plan-${session.id}`, role: 'assistant', kind: 'work_plan', tone: 'plan', body: workPlan, createdAt: createdAt ?? anchor?.createdAt ?? session.updatedAt };
  return [...messages.slice(0, index + 1), plan, ...messages.slice(index + 1)];
}

/** Keep the formal plan readable by older clients; the separate agent report belongs to its transcript message. */
export function engineeringWorkPlanText(plan: EngineeringWorkPlan): string {
  return [plan.summary.trim(),
    plan.keyPoints?.length ? `## Key points\n\n${plan.keyPoints.map((point) => `- ${point.trim()}`).join('\n')}` : '',
    plan.considerations?.length ? `## Before starting\n\n${plan.considerations.map((point) => `- ${point.trim()}`).join('\n')}` : '',
    `${plan.keyPoints?.length || plan.considerations?.length ? '## Steps\n\n' : ''}${plan.steps.map((step, i) => `${i + 1}. ${step.description} (${step.target})`).join('\n')}`,
  ].filter(Boolean).join('\n\n');
}
