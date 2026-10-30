import type { Actor } from '@neuramesh/shared';
import type { Env, Hono } from 'hono';
import type { Command } from './commands';
import { DomainError } from './errors';
import { localMode } from './localmode';
import type { Store } from './store';

// Roll out only after clients expose the activation screen. Local installations never pay.
export const activationEnabled = (): boolean => !localMode() && process.env['NM_REQUIRE_TRIAL_ACTIVATION'] === '1';
export const needsActivation = (plan: string): boolean => activationEnabled() && plan !== 'cloud';
export const ACTIVATION_MESSAGE = 'Add payment details in NeuraMesh HQ to activate cloud work. No charge during the trial.';

export async function requireActivation(store: Store, workspace: string): Promise<void> {
  if (activationEnabled() && needsActivation(await store.workspacePlan(workspace))) {
    throw new DomainError('ACTIVATION_REQUIRED', ACTIVATION_MESSAGE);
  }
}

// Setup, account access and stopping work remain possible before activation.
const SETUP = new Set<Command['type']>(['agent.register', 'workspace.create', 'workspace.update', 'workspace.delete', 'workspace.leave',
  'workspace.accept_invite', 'workspace.decline_invite', 'workspace.revoke_invite', 'workspace.remove_member', 'credential.set',
  'account.delete', 'member.update_profile', 'task.cancel', 'thread.settle', 'run.settle', 'schedule.delete']);

export async function requireCommandActivation(store: Store, cmd: Command): Promise<void> {
  if (!activationEnabled() || SETUP.has(cmd.type)) return;
  if (cmd.type === 'schedule.set_status' && cmd.status === 'paused') return;
  const workspace = 'workspace' in cmd && typeof cmd.workspace === 'string' ? cmd.workspace
    : 'taskId' in cmd && typeof cmd.taskId === 'string' ? (await store.getTask(cmd.taskId))?.workspace : null;
  if (workspace) await requireActivation(store, workspace);
}

/** Register after authentication; billing and read access stay available. */
export function activationRoutes<E extends Env & { Variables: { actor: Actor } }>(app: Hono<E>, store: Store): void {
  // These direct routes do not pass through executeCommand. Clone the body so streaming
  // handlers retain their input. Billing and read access stay available.
  app.use('/v1/*', async (c, next) => {
    if (activationEnabled() && c.req.method === 'POST' &&
        /^\/v1\/(messages|starter(?:\/.*)?|machines\/wake)$/.test(c.req.path)) {
      const body = await c.req.raw.clone().json().catch(() => null) as { workspace?: unknown } | null;
      if (typeof body?.workspace === 'string') await requireActivation(store, body.workspace);
    }
    return next();
  });
  app.get('/v1/workspaces', async (c) => c.json({ workspaces: (await store.listWorkspaces(c.get('actor').id))
    .map((w) => ({ ...w, activationRequired: needsActivation(w.plan) })) }));
}
