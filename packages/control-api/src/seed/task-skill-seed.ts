import { CODING_DELIVERY_SKILL, IMPLEMENTATION_PLAN_SKILL, PUBLISH_PAGE_SKILL, TASK_HANDOFF_SKILL } from '@neuramesh/shared';
import type { SeedPack } from './skill-seed';

export const TASK_SKILL_SEED: SeedPack[] = [{
  pack: { name: 'neuramesh-work', description: 'Context-rich task handoffs, reviewable implementation plans and published pages for every agent.', source_url: 'https://github.com/alonge-dev/neuramesh', source_ref: 'main', version: '4' },
  skills: [
    { name: 'task-handoff', description: 'Create a task with role, context, requirements, done criteria and validation evidence.', body: TASK_HANDOFF_SKILL },
    { name: 'coding-delivery', description: 'Validate coding work, capture before and after evidence, self-review and prepare an approved release.', body: CODING_DELIVERY_SKILL },
    { name: 'implementation-plan', description: 'Write or revise a repository-informed implementation plan with the shared review standard.', body: IMPLEMENTATION_PLAN_SKILL },
    // plan I15: a page or a file for a link on neuramesh.page, built for the sandbox, then publish_file or ask_publish
    { name: 'publish-page', description: 'Make a beautiful page or file for a public link on neuramesh.page that works in the sandbox, then publish it or ask.', body: PUBLISH_PAGE_SKILL },
  ],
}];
