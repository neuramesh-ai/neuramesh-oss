import { IMPLEMENTATION_PLAN_SKILL, TASK_HANDOFF_SKILL } from '@neuramesh/shared';
import type { SeedPack } from './skill-seed';

export const TASK_SKILL_SEED: SeedPack[] = [{
  pack: { name: 'neuramesh-work', description: 'Context-rich task handoffs and reviewable implementation plans for every agent.', source_url: 'https://github.com/alonge-dev/neuramesh', source_ref: 'main', version: '1' },
  skills: [
    { name: 'task-handoff', description: 'Create a task with role, context, requirements, done criteria and validation evidence.', body: TASK_HANDOFF_SKILL },
    { name: 'implementation-plan', description: 'Write or revise a repository-informed implementation plan with the shared review standard.', body: IMPLEMENTATION_PLAN_SKILL },
  ],
}];
