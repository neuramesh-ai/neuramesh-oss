import { PULL_REQUEST_SKILL, CODING_DELIVERY_SKILL, IMPLEMENTATION_PLAN_SKILL, TASK_HANDOFF_SKILL } from '@neuramesh/shared';
import { SKILL_SEED, type SeedPack } from './skill-seed';

// Keep the upstream Git procedure and add the host-specific publishing contract.
export const DEV_SKILL_SEED: SeedPack[] = SKILL_SEED.map(pack => ({ ...pack, skills: pack.skills.map(skill =>
  skill.name === 'git-workflow-and-versioning' ? { ...skill, body: skill.body + '\n\n## NeuraMesh pull requests\n\n' + PULL_REQUEST_SKILL } : skill) }));

export const TASK_SKILL_SEED: SeedPack[] = [{
  pack: { name: 'neuramesh-work', description: 'Context-rich task handoffs and reviewable implementation plans for every agent.', source_url: 'https://github.com/alonge-dev/neuramesh', source_ref: 'main', version: '4' },
  skills: [
    { name: 'task-handoff', description: 'Create a task with role, context, requirements, done criteria and validation evidence.', body: TASK_HANDOFF_SKILL },
    { name: 'pull-request', description: 'Open a reviewable task PR, verify bot authorship and report evidence and checks.', body: PULL_REQUEST_SKILL },
    { name: 'coding-delivery', description: 'Validate coding work, capture before and after evidence, self-review and prepare an approved release.', body: CODING_DELIVERY_SKILL },
    { name: 'implementation-plan', description: 'Write or revise a repository-informed implementation plan with the shared review standard.', body: IMPLEMENTATION_PLAN_SKILL },
  ],
}];
