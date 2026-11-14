import { z } from 'zod';
import type { ModeDecision, PolicyAction } from '@neuramesh/shared';
import { starterGenerate, type StarterCall } from './host/starterproxy';
import { replyText } from './host/starterthoughts';

const verdictSchema = z.object({ verdict: z.enum(['allow', 'ask']), reason: z.string().trim().min(1).max(200) }).strict();
export const REVIEW_DEADLINE_MS = 2500;
export type ActionReviewer = (actions: readonly PolicyAction[]) => Promise<ModeDecision>;
type HouseService = Pick<StarterCall, 'apiUrl' | 'workspace' | 'actorId'>;

// A shell line can include secrets, embedded instructions or compound commands.
// Only send a bounded, recognized operation to the separate reviewer. Never
// transmit file contents, environment, URL queries, arbitrary argv or tool payloads.
const reviewable = /^(?:(?:npm|pnpm|yarn|bun) (?:run )?(?:build|lint|typecheck|test)|cargo (?:check|test)|go test \.\/\.\.\.|git (?:status|diff(?:\s+--stat)?|branch|log(?:\s+--oneline|\s+-\d+)?)|ls(?:\s+-[a-zA-Z0-9]+)?|pwd|node\s+--check\s+[\w./-]+)$/;

function reviewFacts(actions: readonly PolicyAction[]) {
  if (actions.length >= 1 && actions.length <= 4 && actions.every(a => a.capability === 'shell.exec' && a.command && reviewable.test(a.command.trim()))) {
    return { operation: actions.map(a => a.command!.trim()).join(' && '), scope: 'current project worktree' };
  }
  if (actions.length !== 1) return null;
  const action = actions[0]!;
  if (action.capability === 'net.egress' && action.host) return { operation:'fetch public web content', scope:'structured read with machine egress checks' };
  if (action.capability === 'tool.mcp' && action.tool && /(?:^|__)(?:get|read|list|lookup)(?:_[a-z_]+)?$/.test(action.tool)) {
    return { operation:'read from a connected tool', scope:'existing project connection' };
  }
  return null;
}

/** Authority comes from the human's Auto Review selection and the host sandbox.
 * The managed service receives one question without tools or the working agent's history. */
export function houseActionReviewer(service: HouseService, generate = starterGenerate): ActionReviewer {
  return async actions => {
    if (process.env.NM_ENGINEERING_SUBSCRIPTION_ONLY === '1') return { verdict: 'ask', reason: 'Workspace credit use is disabled for this run.' };
    const facts = reviewFacts(actions);
    if (!facts) {
      return { verdict: 'ask', reason: 'The action needs a human scope check.' };
    }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error('Review deadline')); }, REVIEW_DEADLINE_MS);
    });
    try {
      const response = await Promise.race([deadline, generate({ ...service, purpose: 'action-review',
        contents: [{ role: 'user', parts: [{ text: JSON.stringify(facts) }] }],
        config: { systemInstruction: 'You independently review one project action. Allow routine local verification or scoped read-only work. Ask for uncertainty, external writes, sensitive access or broader authority. Return only a JSON object with verdict ("allow" or "ask") and a short reason.' },
        signal: controller.signal,
      })]);
      const result = verdictSchema.safeParse(JSON.parse(replyText(response)));
      if (result.success) return result.data;
    } catch {
      if (controller.signal.aborted) return { verdict: 'ask', reason: 'Auto Review took too long. You can approve or decline now.' };
    } finally { clearTimeout(timer!); }
    return { verdict: 'ask', reason: 'Auto Review could not verify this action.' };
  };
}
