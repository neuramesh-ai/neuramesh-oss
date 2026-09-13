// THE ONBOARDING HANDLER — the wizard's Launch step creates (or adopts) the workspace, connects the providers,
// hires the crew and starts the agent host, on the FOREGROUND connection.
//
// REGISTRATION POSITION IS LOAD-BEARING (see whiteboards.ts): registered from where it sat.
import { ipcMain } from 'electron';
import { defaultDescription, resolvePackRoles, runtimeForModel } from '@neuramesh/shared';
import { startAgentHost } from '../agents';
import type { AgentLog } from '../agentlog';
import { actorId, api, authHeaders, cur } from '../sync';
import { connectStream } from './boot';
import { registerThisMachine } from './machine';
import { onboardTarget } from './onboard-target';

export function registerOnboardIpc(deps: { agentLog: AgentLog; killTaskPtys: (taskNumber: number) => void }): void {
  ipcMain.handle(
    'nm:onboard',
    async (
      _e,
      input: {
        /** the resumed workspace (wsident.ts): adopted when this session holds it, else created */
        workspaceId?: string;
        name: string;
        slug: string;
        providers: Array<{ provider: string; mode: 'apikey' | 'subscription'; key: string }>;
        activeModelPack?: string;
        agents: Array<{ name: string; role: string; model: string; runtime?: string; emoji?: string; description?: string; channels: string[] }>;
      },
    ) => {
      const conn = cur();
      const db = conn.db;
      if (!db) throw new Error('replica not open yet — try again in a moment');
      // the first hosted sign-in already created the person's first workspace on the server (U1b):
      // a wizard that resumed it finishes THAT one. Only a workspace nobody made yet is created.
      const target = onboardTarget(input, conn.session.wsMemberships);
      if (target.kind === 'adopt') {
        conn.ws = target.workspaceId;
        conn.wsInfo = target.info;
        console.log(`onboard_adopt ws=${conn.ws.slice(0, 8)} slug=${target.info.slug}`);
      } else {
        const created = (await api('/v1/commands', { type: 'workspace.create', name: input.name, slug: input.slug })) as { workspaceId: string };
        conn.ws = created.workspaceId;
        conn.wsInfo = { name: input.name, slug: input.slug };
      }
      conn.needsOnboarding = false;
      conn.wsAuthoritative = true; // server-created just now — connectStream may stamp + wipe the pre-onboarding generation
      // record the provider-aware pack the onboarding picked so the Brains tab shows it active
      if (input.activeModelPack) await api('/v1/commands', { type: 'workspace.update', workspace: conn.ws, activeModelPack: input.activeModelPack }).catch(() => {});
      // The first connect (at boot) bound the replica to the pre-onboarding (empty) workspace;
      // now that the real one exists, rebind + take a fresh first sync — otherwise the stream
      // stays wedged on the stale generation and the new user sees an empty app until they restart.
      await connectStream(conn);
      const machineId = await registerThisMachine(conn, actorId);
      if (!machineId) throw new Error('machine registration failed');
      for (const p of input.providers) {
        if (p.mode === 'subscription') {
          await api('/v1/commands', { type: 'credential.set', workspace: conn.ws, provider: p.provider, scope: 'workspace', authMode: 'subscription' });
        } else if (p.key.trim()) {
          await api('/v1/commands', { type: 'credential.set', workspace: conn.ws, provider: p.provider, scope: 'workspace', authMode: 'apikey', token: p.key.trim() });
        }
      }
      let orchestrator = '';
      let orchestratorId = '';
      for (const a of input.agents) {
        const reg = (await api('/v1/commands', {
          type: 'agent.register',
          workspace: conn.ws,
          machineId,
          name: a.name,
          role: a.role,
          model: a.model,
          runtime: a.runtime ?? 'claude-code',
          emoji: a.emoji,
          // the starter crew ships described (0110) — a role default the human then makes theirs
          ...(a.description?.trim() ? { description: a.description.trim() } : (defaultDescription(a.role) ? { description: defaultDescription(a.role)! } : {})),
          channels: a.channels.length ? a.channels : ['general'],
        })) as { agentId: string };
        if (a.role === 'orchestrator' && !orchestrator) { orchestrator = a.name; orchestratorId = reg.agentId; }
      }
      // #build is the seeded engineering room (the channel-kinds work; 'dev' is its legacy
      // name and onboarding has NOT seeded it since). registering these seats into 'dev'
      // failed with NOT_FOUND on every fresh workspace — invisibly, because both calls
      // swallow their error, leaving the daemon's boot backfill to quietly re-create them.
      const ONBOARD_SEAT_ROOM = 'build';
      // a Curator (host-managed, roster-visible) owns skill-pack imports — one per workspace,
      // registered to this machine in #dev (where the bundled packs live). It gets the active pack's
      // curator brain so a Gemini/OpenAI-only workspace never gets a stranded Anthropic curator.
      // onboarding only ever picks builtin packs (custom brains don't exist yet), so no custom list
      const curatorModel = resolvePackRoles(input.activeModelPack ?? null, [])?.curator;
      await api('/v1/commands', { type: 'agent.register', workspace: conn.ws, machineId, name: 'curator', role: 'curator', model: curatorModel, runtime: curatorModel ? runtimeForModel(curatorModel) : undefined, channels: [ONBOARD_SEAT_ROOM] }).catch(() => {});
      // bosun 🦭, the shipper (docs/23), joins the day-one crew: the release gate
      // defaults ON for PR-backed tasks, so the loop needs release hands from birth.
      const shipperModel = resolvePackRoles(input.activeModelPack ?? null, [])?.shipper;
      await api('/v1/commands', { type: 'agent.register', workspace: conn.ws, machineId, name: 'bosun', role: 'shipper', emoji: '🦭', brief: 'Production-readiness plans and release coordination: study the approved change, surface every manual prod step with its owner, and merge only when the checklist clears.', model: shipperModel, runtime: shipperModel ? runtimeForModel(shipperModel) : undefined, channels: [ONBOARD_SEAT_ROOM] }).catch(() => {});
      startAgentHost({ db, machineId, workspace: conn.ws, apiUrl: conn.apiUrl, ownerActorId: actorId(), agentLog: deps.agentLog, killTaskPtys: deps.killTaskPtys });
      conn.agentHostStarted = true;
      if (orchestrator && orchestratorId) {
        // templated intro authored BY the orchestrator (no model spend) — the live reply comes
        // when the human sends the guided first mention. Posting as the agent (not the human)
        // so it renders as the orchestrator greeting you, not a message you sent to yourself.
        await fetch(`${conn.apiUrl}/v1/messages`, {
          method: 'POST',
          headers: await authHeaders({ kind: 'agent', id: orchestratorId }),
          body: JSON.stringify({
            workspace: conn.ws,
            channel: 'general',
            body:
              `👋 Hey — I'm @${orchestrator}, your orchestrator. This is #general, the team's home base. ` +
              `Mention me with a goal and I'll break it into board tasks and hand them to the team. ` +
              `There's one drafted below to get you started — send it (or write your own) to see the loop run.`,
          }),
        }).catch(() => {});
      }
      return { workspaceId: conn.ws, orchestrator };
    },
  );
}
