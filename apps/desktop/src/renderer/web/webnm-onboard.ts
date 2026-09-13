// the browser's Launch step (cloud-first W5): what nm.onboard means when there is no local
// machine to run anything on.
//
// the desktop's onboard (sync.ts) does five things: create the workspace, set credentials,
// register THIS Mac, register the crew against it, and start an agent host in-process. the
// browser can do three of them. it cannot register a machine — a browser tab is not one —
// and it must not start a host, because the agents run on the workspace's CLOUD machine,
// which the fleet provisioned the moment the wizard's first step minted the workspace.
//
// so the crew registers against the RUNNER, and the daemon already living in that pod picks
// the agents up through sync. that is the whole difference.

import { resolvePackRoles } from '@neuramesh/shared';
import type { PowerSyncDatabase } from '@powersync/web';
import { runtimeForModel } from '../src/lib/models';
import { postCommand, type WebNmConfig } from './webnm';

interface OnboardInput {
  name: string;
  slug: string;
  providers: Array<{ provider: string; mode: 'apikey' | 'subscription'; key: string }>;
  activeModelPack?: string;
  agents: Array<{ name: string; role: string; model: string; runtime?: string; emoji?: string; description?: string; channels: string[] }>;
}

/** the workspace's runner, once it has synced down. autoprovision creates the row inside
 *  workspace.create, so this is a sync wait, not a provisioning wait — the pod can still be
 *  starting, which is fine: agents are rows, and the daemon claims them when it wakes. */
async function waitForRunner(db: PowerSyncDatabase, workspaceId: string, timeoutMs = 45_000): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const rows = await db
      .getAll<{ id: string }>('select id from machines where workspace_id = ? and kind = ? limit 1', [workspaceId, 'runner'])
      .catch(() => [] as { id: string }[]);
    if (rows[0]?.id) return rows[0].id;
    if (Date.now() > deadline) return null;
    await new Promise((r) => setTimeout(r, 1_000));
  }
}

export function onboardOverrides(cfg: WebNmConfig, db: PowerSyncDatabase): Record<string, unknown> {
  return {
    onboard: async (input: OnboardInput) => {
      // the workspace was minted at the wizard's FIRST step — that is what the fleet
      // provisioned the machine against, so arriving here without one is a broken flow,
      // not something to paper over by creating a second workspace.
      const workspaceId = localStorage.getItem('nm:web:workspaceId');
      if (!workspaceId) throw new Error('no workspace for this onboarding — restart from the first step');

      if (input.activeModelPack) {
        await postCommand(cfg, { type: 'workspace.update', workspace: workspaceId, activeModelPack: input.activeModelPack }).catch(() => {});
      }

      const machineId = await waitForRunner(db, workspaceId);
      if (!machineId) {
        // loud and specific: the crew has nowhere to run, and silently "finishing" would
        // hand the human an empty workspace that looks complete.
        throw new Error('your cloud machine has not registered yet — give it a moment and try again');
      }

      for (const p of input.providers) {
        if (p.mode === 'subscription') {
          // a browser cannot complete a vendor sign-in; the machine does it later through the
          // in-thread terminal. recording the MODE now is what makes that card appear.
          await postCommand(cfg, { type: 'credential.set', workspace: workspaceId, provider: p.provider, scope: 'workspace', authMode: 'subscription' }).catch(() => {});
        } else if (p.key.trim()) {
          await postCommand(cfg, { type: 'credential.set', workspace: workspaceId, provider: p.provider, scope: 'workspace', authMode: 'apikey', token: p.key.trim() });
        }
      }

      for (const a of input.agents) {
        await postCommand(cfg, {
          type: 'agent.register',
          workspace: workspaceId,
          machineId,
          name: a.name,
          role: a.role,
          model: a.model,
          runtime: a.runtime ?? 'claude-code',
          emoji: a.emoji,
          ...(a.description?.trim() ? { description: a.description.trim() } : {}),
          channels: a.channels.length ? a.channels : ['general'],
        });
      }

      // the two host-managed seats the desktop also plants: the curator owns skill-pack
      // imports, and bosun holds the release gate that defaults ON for PR-backed tasks.
      // #build, not #dev: 'dev' is the legacy engineering-room name and onboarding does not
      // seed it, so registering there returns NOT_FOUND (found by the live crew-bind test).
      // onboarding only ever picks builtin packs, so there are no custom packs to resolve.
      const roles = resolvePackRoles(input.activeModelPack ?? null, []);
      for (const seat of [
        { name: 'curator', role: 'curator', model: roles?.curator, channels: ['build'] },
        { name: 'bosun', role: 'shipper', emoji: '🦭', model: roles?.shipper, channels: ['build'] },
      ]) {
        await postCommand(cfg, {
          type: 'agent.register',
          workspace: workspaceId,
          machineId,
          ...seat,
          runtime: seat.model ? runtimeForModel(seat.model) : undefined,
        }).catch(() => {});
      }

      return { workspaceId, machineId };
    },
  };
}
