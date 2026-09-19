// THE BROWSER'S WRITE LANES — everything a human CHANGES on the task, agent and room
// surfaces, ported from the desktop's IPC handlers (apps/desktop/src/main/sync/ipc/*).
//
// The reads landed first (webnm-rooms/-convo/-rows), so hq could show the workspace and do
// nothing to it: every button reached the warn-once proxy, which resolves an inert empty. An
// unwired READ degrades to "nothing here yet"; an unwired WRITE degrades to a button that
// looks like it worked. That is the gap this file closes.
//
// Two rules run through all of it:
//
//  · ALMOST EVERY WRITE IS ONE `postCommand`. The desktop's handlers are thin passes to
//    POST /v1/commands; the page posts the same command with the same fields, so there is one
//    command vocabulary and not a web dialect of it. Each method names its type inline.
//
//  · A WRITE MUST NOT FAIL SILENTLY. `postCommand` throws on a non-ok response and nothing
//    here catches it. SUBTASKS_PENDING, CHAT_THREAD, NOT_PERMITTED, SHIP_ITEMS_PENDING and
//    the rest of the FSM's refusals ARE the product — swallowing one turns an enforced
//    invariant into a mystery. The callers already render `e.message`.
//
// Typed `Partial<NMBridge>`, never `Record<string, unknown>`: the overrides go through a proxy,
// so an untyped bag typechecks whatever it holds and a wrong SHAPE fails only in use. That is
// not hypothetical — `send` is POSITIONAL (channelId, body, opts) and was first written in
// webnm-convo.ts as one options object, which would have posted `undefined` as every message
// body and compiled cleanly. Half the methods here are positional and half take one object;
// the compiler is what keeps them apart.
import { MACHINE_ONLINE_MS, isCustomPackId, resolvePackRoles, runtimeForModel, type AgentRole, type CustomModelPack, type ThreadMode } from '@neuramesh/shared';
import type { PowerSyncDatabase } from '@powersync/web';
import type { NMBridge } from '../src/bridge/nm';
import type { TaskRow } from '../src/bridge/rows-board';
import { switchTo } from './slugroute';
import { authHeaders, postCommand, type WebNmConfig } from './webnm';

/** one command, typed to what the contract promises back. The CAST is on the response only —
 *  the arguments are checked against NMBridge, which is where the breakage lives. */
const cmd = <T>(cfg: WebNmConfig, c: Record<string, unknown>): Promise<T> => postCommand(cfg, c) as Promise<T>;

async function apiGet<T>(cfg: WebNmConfig, path: string): Promise<T> {
  const res = await fetch(`${cfg.apiUrl}${path}`, { headers: await authHeaders(cfg) });
  if (!res.ok) throw new Error(`${path} failed ${res.status}`);
  return (await res.json()) as T;
}

/**
 * WHICH MACHINE a browser-registered agent runs on. `agent.register` requires one and a browser
 * is not a machine, so this has to be answered rather than passed through: the desktop sends
 * `thisMachineId` and the page has no equivalent.
 *
 * The workspace's cloud runner first — that is the premise of the web client, and where
 * webnm-onboard.ts already registers the whole crew. Then wherever this workspace's crew
 * ALREADY lives, because a workspace built on a Mac and later staffed from hq should hire onto
 * the host that is running the rest of it, not be told it has nowhere to run. Then the machine
 * seen most recently. No machine at all is a real error, said plainly.
 *
 * Liveness outranks headcount, and it is a PREFERENCE rather than a filter. Ordering by crew size
 * first would hire onto a laptop that has been shut for a week over the runner that is awake now.
 * Filtering on it instead would be worse: MACHINE_ONLINE_MS is a 90s heartbeat window, so a runner
 * one beat late would make hiring fail outright — which is exactly what the error below tells you
 * to wait through. The threshold is imported, never redeclared, so there is one definition of
 * "online" in the product.
 */
async function hostMachine(db: PowerSyncDatabase, ws: string): Promise<string> {
  const [row] = await db.getAll<{ id: string }>(
    `select m.id from machines m where m.workspace_id = ?
      order by (coalesce(m.kind, 'local') = 'runner') desc,
               (m.last_seen_at > ?) desc,
               (select count(*) from agents a where a.machine_id = m.id and a.retired_at is null) desc,
               m.last_seen_at desc
      limit 1`,
    [ws, new Date(Date.now() - MACHINE_ONLINE_MS).toISOString()],
  ).catch(() => [] as Array<{ id: string }>);
  if (!row?.id) throw new Error('this workspace has no machine to run an agent on yet — give the cloud machine a moment');
  return row.id;
}

/** ported from sync.ts + sync/ipc/task.ts + sync/ipc/messages.ts — the board's write surface */
function taskWrites(cfg: WebNmConfig, db: PowerSyncDatabase): Partial<NMBridge> {
  const ws = () => cfg.workspaceId();
  return {
    // the FSM's whole human-facing verb set in one door (accept/approve/request_changes/block/
    // cancel/promote/reopen/approve_plan/approve_design/approve_ship_plan/finish_subtask/…).
    // The two field quirks are the desktop's and are load-bearing: block carries `reason`,
    // everything else carries `feedback`; `input` rides only the two design commands that
    // declare fields for it, so it cannot leak into a schema that would reject it.
    taskAction: (type: string, taskId: string, feedback?: string, input?: { provider?: 'iris' | 'claude-design'; designer?: string; kind?: string }) =>
      postCommand(cfg, {
        type, taskId,
        ...(feedback ? (type === 'task.block' ? { reason: feedback } : { feedback }) : {}),
        ...(type === 'task.request_design' || type === 'task.select_design_provider' ? input : {}),
      }),

    createTask: (channelId: string, title: string, opts?: Parameters<NMBridge['createTask']>[2]) =>
      cmd<{ task: TaskRow }>(cfg, {
        type: 'task.create', workspace: ws(), channel: channelId, title,
        // the ask itself, so nothing the human typed is lost to a title cap
        description: opts?.description || undefined,
        thread: opts?.thread, offerTo: opts?.offerTo, project: opts?.project,
        ...(opts?.repoId ? { repo: { id: opts.repoId, baseRef: opts.baseRef ?? 'main' } } : {}),
        ...(opts?.backlog ? { backlog: true } : {}),
        kind: opts?.kind || undefined,
        // plan-first units (docs/41): the plan rides the create, so the unit is born in
        // plan_review with its journey declared and its conversation set
        ...(opts?.plan ? { plan: { legs: opts.plan.legs, subtasks: opts.plan.subtasks ?? [], approach: opts.plan.approach } } : {}),
        originThread: opts?.originThread,
      }),

    // channel/project are INHERITED from the parent server-side; pass the parent's own
    subtaskAdd: async (parentId: string, title: string, description?: string) => {
      const [row] = await db.getAll<{ channel_id: string; workspace_id: string }>('select channel_id, workspace_id from tasks where id = ?', [parentId]);
      if (!row) throw new Error('parent task not found');
      return postCommand(cfg, { type: 'task.create', workspace: row.workspace_id, channel: row.channel_id, title, parent: parentId, description: description || undefined });
    },

    taskSetDod: (taskId: string, dod: string) => cmd<{ ok: boolean }>(cfg, { type: 'task.set_definition_of_done', taskId, dod }),
    // the backlog scratch-board edit (docs/15) — the server freezes details once work is staged
    taskUpdateDetails: (taskId: string, fields: { title?: string; description?: string }) =>
      cmd<{ ok: boolean }>(cfg, { type: 'task.update_details', taskId, title: fields.title, description: fields.description }),

    // an nmq card's authoritative flip (docs/12). The reply message posts separately via
    // send/sendThread — this is only the bookkeeping Mission Control renders.
    decisionAction: (type: 'decision.answer' | 'decision.dismiss', decisionId: string, answer?: string) =>
      postCommand(cfg, { type, decisionId, ...(type === 'decision.answer' ? { answer } : {}) }),

    // the ship checklist (docs/23). Owner enforcement is SERVER-side — an agent can never tick
    // a human item — so there is deliberately no client guard here.
    shipItem: (taskId: string, itemId: string, state: 'pending' | 'done' | 'na', note?: string) =>
      postCommand(cfg, { type: 'task.check_ship_item', taskId, itemId, state, note: note || undefined }),
    shipItemAdd: (taskId: string, title: string, detail?: string) =>
      postCommand(cfg, { type: 'task.add_ship_item', taskId, title, detail: detail || undefined, owner: 'human' }),

    pinMessage: (messageId: string, pinned: boolean) => postCommand(cfg, { type: 'message.pin', message: messageId, pinned }),

    /**
     * A message in a TASK thread. Local-first like `send` (webnm-convo.ts): the row lands in the
     * replica and the shared ps_crud uploader posts it, so an offline reply queues instead of
     * being lost with the request.
     *
     * ATTACHMENTS ARE DROPPED, and the desktop's are not: `insertAttachments` writes an
     * artifacts row from bytes `attachStage` put on disk, and the browser has no staging lane
     * yet (nm.attachStage is still the warn-once proxy). Wiring the row without the bytes would
     * put a permanently broken thumbnail in the thread, so the text goes and the file does not.
     */
    sendThread: async (taskId: string, channelId: string, body: string, opts?: { id?: string; attachments?: { id: string; name: string; mime: string }[] }) => {
      const id = opts?.id ?? crypto.randomUUID();
      await db.execute(
        `insert into messages (id, workspace_id, channel_id, task_id, author_kind, author_id, body, created_at)
         values (?, ?, ?, ?, 'human', ?, ?, ?)`,
        [id, ws(), channelId, taskId, cfg.actorId(), body, new Date().toISOString()],
      );
      if (opts?.attachments?.length) console.warn('[webnm] sendThread: attachments need the staging lane — text sent, files dropped');
      return { id };
    },
  };
}

/** ported from sync.ts + sync/ipc/agents.ts — hiring, editing, retiring, and room membership */
function crewWrites(cfg: WebNmConfig, db: PowerSyncDatabase): Partial<NMBridge> {
  const ws = () => cfg.workspaceId();
  return {
    registerAgent: async (input: Parameters<NMBridge['registerAgent']>[0]) => {
      const machineId = await hostMachine(db, ws());
      const runtime = input.runtime ?? 'claude-code';
      const { agentId } = await cmd<{ agentId: string }>(cfg, {
        type: 'agent.register', workspace: ws(), machineId,
        name: input.name, role: input.role, model: input.model, runtime,
        // the two strings (0110) — omitted rather than sent empty, so a create with blank
        // fields leaves them null instead of tripping the server's min(1)
        ...(input.description?.trim() ? { description: input.description.trim() } : {}),
        ...(input.brief?.trim() ? { brief: input.brief.trim() } : {}),
        channels: input.channels,
      });
      if (input.apiKey) {
        // the per-agent key lands under the RUNTIME's provider (codex→openai, gemini→gemini)
        const provider = runtime === 'codex' ? 'openai' : runtime === 'gemini' ? 'gemini' : 'anthropic';
        await postCommand(cfg, { type: 'credential.set', workspace: ws(), scope: 'agent', agentId, provider, token: input.apiKey });
      }
      return { agentId };
    },

    // the daemon re-reads a brain change live and re-routes that agent's next turn
    agentUpdate: (input: Parameters<NMBridge['agentUpdate']>[0]) =>
      postCommand(cfg, { type: 'agent.update', agent: input.agentId, model: input.model, runtime: input.runtime, name: input.name, description: input.description, brief: input.brief, modelSource: input.modelSource }),
    // soft + human-only; the server refuses while the agent has open work. Rehire = register the name again.
    agentRetire: (agentId: string) => cmd<{ ok: boolean; agentId: string; alreadyRetired: boolean }>(cfg, { type: 'agent.retire', agent: agentId }),
    agentConnectRemote: (cardUrl: string, channels: string[]) =>
      cmd<{ ok: boolean; agentId: string; name: string }>(cfg, { type: 'agent.connect_remote', workspace: ws(), channels, cardUrl: cardUrl.trim() }),
    syncAgents: () => cmd<{ ok: boolean; registered: number }>(cfg, { type: 'workspace.sync_agents', workspace: ws() }),

    // the crew rail's ± and the People ±. Adding a person is NOT an invite: no seat is
    // consumed and no workspace access is granted (0094).
    addAgentToChannel: (channelId: string, agent: string) => cmd<{ ok: boolean }>(cfg, { type: 'channel.add_agent', workspace: ws(), channel: channelId, agent }),
    removeAgentFromChannel: (channelId: string, agent: string) => cmd<{ ok: boolean }>(cfg, { type: 'channel.remove_agent', workspace: ws(), channel: channelId, agent }),
    addPersonToChannel: (channelId: string, person: string) => cmd<{ ok: boolean }>(cfg, { type: 'channel.add_person', workspace: ws(), channel: channelId, person }),
    removePersonFromChannel: (channelId: string, person: string) => cmd<{ ok: boolean }>(cfg, { type: 'channel.remove_person', workspace: ws(), channel: channelId, person }),
  };
}

/** ported from sync/ipc/projects.ts — rooms, projects and a conversation's own settings */
function roomWrites(cfg: WebNmConfig): Partial<NMBridge> {
  const ws = () => cfg.workspaceId();
  return {
    channelCreate: (projectId: string, slug: string, topic?: string) =>
      cmd<{ ok: boolean; channelId: string; slug: string }>(cfg, { type: 'channel.create', workspace: ws(), project: projectId, slug: slug.trim(), topic: (topic ?? '').trim() }),
    // safe because a channel is identified by its id, never its slug
    channelRename: (channelId: string, slug?: string, topic?: string) =>
      cmd<{ ok: boolean; channelId: string; slug: string }>(cfg, { type: 'channel.rename', channel: channelId, slug: slug?.trim(), topic: topic?.trim() }),
    channelDelete: (channelId: string) => postCommand(cfg, { type: 'channel.delete', channel: channelId }),
    // the desktop follows this with ensureMarketingSeedsRef to staff the new HQ on the spot.
    // That is a HOST job (it plants the pack + plume on the machine running the daemon), so the
    // browser leaves it to the cloud daemon's own boot backfill rather than faking it.
    channelKind: (channelId: string, kind: 'build' | 'marketing') => cmd<{ ok: boolean; channelId: string }>(cfg, { type: 'channel.set_kind', channel: channelId, kind }),

    projectCreate: (name: string, description?: string, slug?: string, newChannels?: string[], identity?: { website?: string; logoUrl?: string }) =>
      cmd<{ ok: boolean; projectId: string; slug: string }>(cfg, {
        type: 'project.create', workspace: ws(), name: name.trim(), ...(slug ? { slug } : {}),
        description: (description ?? '').trim(), website: identity?.website?.trim() || undefined,
        logoUrl: identity?.logoUrl || undefined, newChannels: newChannels ?? [],
      }),
    // website/logoUrl: '' clears the stored value, undefined keeps it — which is exactly what
    // JSON.stringify already does with an undefined key, so the fields pass through as written
    projectUpdate: (projectId: string, name?: string, description?: string, autoOpenPr?: boolean, runCiBeforeMerge?: boolean, shipGate?: boolean, identity?: { website?: string; logoUrl?: string }, modelPack?: string) =>
      postCommand(cfg, { type: 'project.update', project: projectId, name: name?.trim(), description: description?.trim(), website: identity?.website?.trim(), logoUrl: identity?.logoUrl, autoOpenPr, runCiBeforeMerge, shipGate, modelPack }),
    projectArchive: (projectId: string, archived: boolean) => postCommand(cfg, { type: archived ? 'project.archive' : 'project.unarchive', project: projectId }),
    projectDelete: (projectId: string) => postCommand(cfg, { type: 'project.delete', project: projectId }),

    // docs/34 — the escalation valve on an OPEN conversation. HUMAN_ONLY server-side.
    threadSetMode: (threadId: string, mode: ThreadMode) => postCommand(cfg, { type: 'thread.set_mode', workspace: ws(), threadId, mode }),
    // docs/10 §15 — `override: null` is Reset, the WHOLE override
    threadSetBrain: (threadId: string, override: Record<string, string> | null) => postCommand(cfg, { type: 'thread.set_brain', workspace: ws(), threadId, override }),
    threadArchive: (threadId: string) => postCommand(cfg, { type: 'thread.archive', workspace: ws(), threadId }),
    threadUpdate: (threadId: string, fields: { title?: string; description?: string }) => postCommand(cfg, { type: 'thread.update', workspace: ws(), threadId, ...fields }),
    threadUnarchive: (threadId: string) => postCommand(cfg, { type: 'thread.unarchive', workspace: ws(), threadId }),
    threadSettle: (threadId: string) => postCommand(cfg, { type: 'thread.settle', workspace: ws(), threadId }),
    threadUnsettle: (threadId: string) => postCommand(cfg, { type: 'thread.unsettle', workspace: ws(), threadId }),
  };
}

/** ported from sync/ipc/membership.ts, /settings.ts, /account.ts, /artifacts.ts — who is in the
 *  workspace, what it is configured to, and the two curation writes */
function spaceWrites(cfg: WebNmConfig, db: PowerSyncDatabase): Partial<NMBridge> {
  const ws = () => cfg.workspaceId();
  return {
    // a seat-cap rejection (PLAN_LIMIT) has to reach the caller for the upgrade flow to appear
    invite: (email: string) => cmd<{ inviteId: string; created: boolean; delivery: 'sent' | 'skipped' | 'failed' | 'queued' }>(cfg, { type: 'workspace.invite', workspace: ws(), email }),
    revokeInvite: (invite: string) => cmd<{ ok: boolean }>(cfg, { type: 'workspace.revoke_invite', workspace: ws(), invite }),
    // no membership cache to refresh here: the web re-reads /v1/workspaces on every bootstrap,
    // where the desktop had to keep `session.wsMemberships` in step by hand
    acceptInvite: (invite: string) => cmd<{ workspaceId: string; workspaceName: string; role: string }>(cfg, { type: 'workspace.accept_invite', invite }),
    declineInvite: async (invite: string) => { await postCommand(cfg, { type: 'workspace.decline_invite', invite }); return { ok: true }; },
    removeMember: (member: string) => postCommand(cfg, { type: 'workspace.remove_member', workspace: ws(), member }),

    // leaving the room you are STANDING IN leaves nowhere to be. The desktop relaunches onto
    // whatever remains; here that is a url change, which rebinds the same way (slugroute.ts).
    leaveWorkspace: async (workspace: string) => {
      await postCommand(cfg, { type: 'workspace.leave', workspace });
      if (workspace !== ws()) return { ok: true, switching: false };
      // a failed read here still has an answer: '/' re-derives the workspace at boot rather
      // than leaving the shell standing in one the human just left
      const rest = await apiGet<{ workspaces?: Array<{ id: string; slug?: string }> }>(cfg, '/v1/workspaces')
        .catch(() => ({ workspaces: [] as Array<{ id: string; slug?: string }> }));
      const next = (rest.workspaces ?? []).find((w) => w.id !== workspace && !!w.slug);
      if (next?.slug) switchTo({ id: next.id, slug: next.slug });
      else { localStorage.removeItem('nm:web:workspaceId'); window.location.assign('/'); }
      return { ok: true, switching: true };
    },

    // the control-api scopes the write to the ACTOR, so no target id is sent from the client
    updateProfile: (displayName: string) => cmd<{ ok: boolean }>(cfg, { type: 'member.update_profile', workspace: ws(), displayName: displayName.trim() }),
    // compute choice (0118/0119): where MY requests run, and who may borrow my machines. The
    // server expands a '*' share against the real roster, so the intent travels, not the list.
    setCompute: (prefs: { machine?: string | null; agents?: Record<string, string>; shares?: string[] }) =>
      cmd<{ ok: boolean }>(cfg, { type: 'member.set_compute', workspace: ws(), machine: prefs.machine, agents: prefs.agents, shares: prefs.shares }),
    shareCompute: (member: string, on: boolean) => cmd<{ ok: boolean }>(cfg, { type: 'member.share_compute', workspace: ws(), member, on }),

    workspaceUpdate: (input: { autoFailover?: boolean; activeModelPack?: string; commRules?: { ste100?: boolean; noEmdash?: boolean; custom?: string[] }; videoTier?: 'starter' | 'xpress' | 'premium' | null }) =>
      postCommand(cfg, { type: 'workspace.update', workspace: ws(), autoFailover: input.autoFailover, activeModelPack: input.activeModelPack, commRules: input.commRules, videoTier: input.videoTier }),
    // deleting the ACTIVE workspace needs no local flag on the web: the next boot reads
    // /v1/workspaces, the dead one is simply not in it, and applyBootRoute lands the shell on
    // whatever remains (or onboarding). The desktop had to set needsOnboarding because its WS
    // is bound once at startup.
    workspaceDelete: (workspaceId: string) => postCommand(cfg, { type: 'workspace.delete', workspace: workspaceId }),
    setCredential: (input: { scope: 'workspace' | 'agent'; agentId?: string; token?: string; provider?: string; authMode?: 'apikey' | 'subscription' }) =>
      postCommand(cfg, { type: 'credential.set', workspace: ws(), provider: input.provider ?? 'anthropic', scope: input.scope, agentId: input.agentId, token: input.token, authMode: input.authMode ?? 'apikey' }),

    /**
     * Applying a brain pack: re-point every PACK-MANAGED, non-remote agent to the pack's model
     * for its role, then persist active_model_pack LAST — so a stored pack id always means
     * "fully applied", and a partial failure leaves the old id plus a visible retry. Manual pins
     * (model_source='manual') and remote A2A agents are deliberately untouched.
     */
    applyPack: async (packId: string) => {
      const custom = isCustomPackId(packId)
        ? ((await apiGet<{ packs?: CustomModelPack[] }>(cfg, `/v1/model-packs?workspace=${encodeURIComponent(ws())}`)).packs ?? [])
        : [];
      const roles = resolvePackRoles(packId, custom);
      if (!roles) throw new Error(`unknown model pack: ${packId}`);
      const agents = await db.getAll<{ id: string; role: string }>(
        `select id, role from agents where workspace_id = ? and model_source = 'pack' and coalesce(kind, 'local') != 'remote' and retired_at is null`,
        [ws()],
      );
      for (const a of agents) {
        const model = roles[a.role as AgentRole] ?? roles.developer;
        await postCommand(cfg, { type: 'agent.update', agent: a.id, model, runtime: runtimeForModel(model), modelSource: 'pack' });
      }
      await postCommand(cfg, { type: 'workspace.update', workspace: ws(), activeModelPack: packId });
      return { ok: true, applied: agents.length };
    },

    // Memory curation: retire closes a fact's validity (bitemporal — history stays, prompts stop
    // injecting it); record backs the correct-this-lesson flow. The API enforces who may retire.
    memoryRetireFact: (factId: string, supersededBy?: string) =>
      cmd<{ ok: boolean; id: string; retired: boolean }>(cfg, { type: 'memory.retire_fact', factId, supersededBy: supersededBy || undefined }),
    memoryRecordLesson: (channelSlug: string, content: string) =>
      cmd<{ decision: 'add' | 'update' | 'noop'; factId: string }>(cfg, { type: 'memory.record_lesson', workspace: ws(), channel: channelSlug, content }),

    // ★ = a human shelved this (workspace-files round) — a marker, never a gate
    promoteArtifact: (artifactId: string) => postCommand(cfg, { type: 'artifact.promote', artifactId }),
    /**
     * ported from sync/ipc/workspace-files.ts nm:repo-add — a plain `repo.link` command, NOT a
     * machine question, which is why it lives here rather than with the machine-local refusals.
     * A repo is linked by URL on the server; the desktop's own handler is one `api()` call.
     *
     * `localPath` is the exception and it is passed through unchanged rather than blocked: the
     * server records where a repo lives on a MACHINE, and a browser has no path to offer, so the
     * control simply never sends one. Refusing it here would duplicate a rule that is really the
     * form's, and the desktop sends the same field to the same command.
     */
    repoAdd: (opts: { url?: string; localPath?: string; name?: string; channelSlug?: string; projectId?: string; defaultBranch?: string }) =>
      postCommand(cfg, {
        type: 'repo.link', workspace: ws(), channel: opts.channelSlug, project: opts.projectId,
        url: opts.url?.trim() || undefined, localPath: opts.localPath, name: opts.name,
        defaultBranch: opts.defaultBranch?.trim() || 'main',
      }) as Promise<{ ok: boolean; repoId: string; inserted: boolean }>,

    // the REFUSAL lives on the server (`isGateArtifact`) and postCommand surfaces its message
    // verbatim — the whole point of that refusal is naming WHICH gate stands on the file
    artifactDelete: (artifactId: string) => postCommand(cfg, { type: 'artifact.delete', artifactId }),
  };
}

export function actionOverrides(cfg: WebNmConfig, db: PowerSyncDatabase): Partial<NMBridge> {
  return { ...taskWrites(cfg, db), ...crewWrites(cfg, db), ...roomWrites(cfg), ...spaceWrites(cfg, db) };
}
