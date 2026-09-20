import { contextBridge, ipcRenderer } from 'electron';

export interface ChannelRow {
  id: string;
  slug: string;
  topic: string;
}

export interface MessageRow {
  id: string;
  author_kind: string;
  author_id: string;
  body: string;
  created_at: string;
}

/** One execution of an armed automation (0119): the conversation its slot opened. */
export interface ScheduleRunRow {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
  channel_id: string;
  channel_slug: string | null;
  /** how much of an exchange the run turned into — 1 is the prompt sitting unanswered */
  msg_count: number;
  /** the run's last line — what it produced, which is the only thing that differs run to run */
  last_body: string | null;
}

// auto-update lifecycle reflected by the renderer's update card. Mirrors the
// UpdateState union in main/update.ts and the NMBridge interface in App.tsx.
export type UpdateState =
  | { phase: 'idle' }
  | { phase: 'available'; version: string; notes: string | null }
  | { phase: 'downloading'; version: string; percent: number }
  | { phase: 'ready'; version: string }
  | { phase: 'error'; message: string };

// cold start can beat main's handler registration by a few hundred ms —
// watch subscriptions must retry or they silently never attach
function invokeRetry(channel: string, payload: unknown, attempts = 8) {
  const go = (left: number) => {
    ipcRenderer.invoke(channel, payload).catch(() => {
      if (left > 0) setTimeout(() => go(left - 1), 500);
    });
  };
  go(attempts);
}

contextBridge.exposeInMainWorld('nm', {
  electron: process.versions.electron,
  channels: (): Promise<ChannelRow[]> => ipcRenderer.invoke('nm:channels'),
  policies: () => ipcRenderer.invoke('nm:policies'),
  policySet: (input: unknown) => ipcRenderer.invoke('nm:policy-set', input),
  policyDelete: (id: string) => ipcRenderer.invoke('nm:policy-delete', { id }),
  sandboxGet: () => ipcRenderer.invoke('nm:sandbox-get'),
  footprintGet: (quick?: boolean) => ipcRenderer.invoke('nm:footprint-get', { quick }),
  footprintReclaim: () => ipcRenderer.invoke('nm:footprint-reclaim'),
  sandboxSet: (enabled: boolean) => ipcRenderer.invoke('nm:sandbox-set', { enabled }),
  send: (channelId: string, body: string, opts?: { id?: string; attachments?: { id: string; name: string; mime: string }[]; threadId?: string; rootMessageId?: string; threadMode?: 'tasks' | 'chat'; brainOverride?: Record<string, string> | null; threadMachineId?: string | null; threadOrigin?: 'desktop' | 'web' | 'routine' | null }) =>
    ipcRenderer.invoke('nm:send', { channelId, body, id: opts?.id, attachments: opts?.attachments, threadId: opts?.threadId, rootMessageId: opts?.rootMessageId, threadMode: opts?.threadMode, brainOverride: opts?.brainOverride, threadMachineId: opts?.threadMachineId, threadOrigin: opts?.threadOrigin }),
  // docs/34 — flip an OPEN conversation's Tasks toggle. Chat → tasks escalates in place (the
  // next message triages); tasks → chat stops the routing without touching an existing task.
  // Archiving a conversation (0108): it leaves Recents, the room's session list and search, and
  // lives only in Settings › Archived chats until unarchived.
  threadArchive: (threadId: string): Promise<unknown> => ipcRenderer.invoke('nm:thread-archive', { threadId }),
  threadUpdate: (threadId: string, fields: { title?: string; description?: string }): Promise<unknown> => ipcRenderer.invoke('nm:thread-update', { threadId, ...fields }),
  threadUnarchive: (threadId: string): Promise<unknown> => ipcRenderer.invoke('nm:thread-unarchive', { threadId }),
  threadSettle: (threadId: string): Promise<unknown> => ipcRenderer.invoke('nm:thread-settle', { threadId }),
  threadUnsettle: (threadId: string): Promise<unknown> => ipcRenderer.invoke('nm:thread-unsettle', { threadId }),
  watchArchivedThreads: (cb: (rows: unknown[]) => void): (() => void) => {
    const subId = crypto.randomUUID();
    const listener = (_e: unknown, p: { subId: string; rows: unknown[] }) => { if (p.subId === subId) cb(p.rows); };
    ipcRenderer.on('nm:archived-threads', listener);
    void ipcRenderer.invoke('nm:watch-archived-threads', { subId });
    return () => { ipcRenderer.removeListener('nm:archived-threads', listener); void ipcRenderer.invoke('nm:unwatch', { subId }); };
  },
  threadSetMode: (threadId: string, mode: 'tasks' | 'chat'): Promise<unknown> =>
    ipcRenderer.invoke('nm:thread-set-mode', { threadId, mode }),
  // docs/10 §15 — set (or clear, with null) this conversation's per-role brain override
  threadSetBrain: (threadId: string, override: Record<string, string> | null): Promise<unknown> => ipcRenderer.invoke('nm:thread-set-brain', { threadId, override }),
  // one seat of one conversation → a model (the auth card's "Use Starter here", 2026-09-17); the
  // main process merges it into the thread's override so the card never has to know the rest
  threadBrainRole: (threadId: string, role: string, model: string): Promise<unknown> => ipcRenderer.invoke('nm:thread-brain-role', { threadId, role, model }),
  threadBrain: (threadId: string): Promise<Record<string, string> | null> => ipcRenderer.invoke('nm:thread-brain', { threadId }),
  status: () => ipcRenderer.invoke('nm:status'),
  // stage attachment bytes locally (returns dims + a thumbnail); the row is written on send
  attachStage: (id: string, name: string, mime: string, bytes: ArrayBuffer): Promise<{ id: string; size: number; width: number | null; height: number | null; thumb: string | null }> =>
    ipcRenderer.invoke('nm:attach-stage', { id, name, mime, bytes }),
  attachDiscard: (id: string): Promise<void> => ipcRenderer.invoke('nm:attach-discard', { id }),
  watchMsgAttachments: (channelId: string, cb: (rows: unknown[]) => void): (() => void) => {
    const subId = crypto.randomUUID();
    const listener = (_e: unknown, p: { subId: string; rows: unknown[] }) => { if (p.subId === subId) cb(p.rows); };
    ipcRenderer.on('nm:msg-attachments', listener);
    void ipcRenderer.invoke('nm:watch-msg-attachments', { subId, channelId });
    return () => { ipcRenderer.removeListener('nm:msg-attachments', listener); void ipcRenderer.invoke('nm:unwatch', { subId }); };
  },
  /** a CONVERSATION's attachments — reached through its messages, since they carry no task_id */
  watchConvoAttachments: (threadId: string, cb: (rows: unknown[]) => void): (() => void) => {
    const subId = crypto.randomUUID();
    const listener = (_e: unknown, p: { subId: string; rows: unknown[] }) => { if (p.subId === subId) cb(p.rows); };
    ipcRenderer.on('nm:convo-attachments', listener);
    void ipcRenderer.invoke('nm:watch-convo-attachments', { subId, threadId });
    return () => { ipcRenderer.removeListener('nm:convo-attachments', listener); void ipcRenderer.invoke('nm:unwatch', { subId }); };
  },
  watchThreadAttachments: (taskId: string, cb: (rows: unknown[]) => void): (() => void) => {
    const subId = crypto.randomUUID();
    const listener = (_e: unknown, p: { subId: string; rows: unknown[] }) => { if (p.subId === subId) cb(p.rows); };
    ipcRenderer.on('nm:thread-attachments', listener);
    void ipcRenderer.invoke('nm:watch-thread-attachments', { subId, taskId });
    return () => { ipcRenderer.removeListener('nm:thread-attachments', listener); void ipcRenderer.invoke('nm:unwatch', { subId }); };
  },
  watchMessages: (channelId: string, cb: (rows: MessageRow[]) => void): (() => void) => {
    const subId = crypto.randomUUID();
    const listener = (_e: unknown, p: { subId: string; rows: MessageRow[] }) => {
      if (p.subId === subId) cb(p.rows);
    };
    ipcRenderer.on('nm:messages', listener);
    void ipcRenderer.invoke('nm:watch-messages', { subId, channelId });
    return () => {
      ipcRenderer.removeListener('nm:messages', listener);
      void ipcRenderer.invoke('nm:unwatch', { subId });
    };
  },
  // conversation threads: the channel's history rows, and one conversation's feed
  watchThreads: (channelId: string, cb: (rows: unknown[]) => void): (() => void) => {
    const subId = crypto.randomUUID();
    const listener = (_e: unknown, p: { subId: string; rows: unknown[] }) => { if (p.subId === subId) cb(p.rows); };
    ipcRenderer.on('nm:threads', listener);
    void ipcRenderer.invoke('nm:watch-threads', { subId, channelId });
    return () => { ipcRenderer.removeListener('nm:threads', listener); void ipcRenderer.invoke('nm:unwatch', { subId }); };
  },
  // every thread in the workspace (task threads included) — the nav history rail + overlay
  watchThreadsAll: (cb: (rows: unknown[]) => void): (() => void) => {
    const subId = crypto.randomUUID();
    const listener = (_e: unknown, p: { subId: string; rows: unknown[] }) => { if (p.subId === subId) cb(p.rows); };
    ipcRenderer.on('nm:threads-all', listener);
    void ipcRenderer.invoke('nm:watch-threads-all', { subId });
    return () => { ipcRenderer.removeListener('nm:threads-all', listener); void ipcRenderer.invoke('nm:unwatch', { subId }); };
  },
  watchHistoryAll: (cb: (rows: unknown[]) => void): (() => void) => {
    const subId = crypto.randomUUID();
    const listener = (_e: unknown, p: { subId: string; rows: unknown[] }) => { if (p.subId === subId) cb(p.rows); };
    ipcRenderer.on('nm:history-all', listener);
    invokeRetry('nm:watch-history-all', { subId });
    return () => { ipcRenderer.removeListener('nm:history-all', listener); void ipcRenderer.invoke('nm:unwatch', { subId }); };
  },
  watchConvo: (threadId: string, cb: (rows: MessageRow[]) => void): (() => void) => {
    const subId = crypto.randomUUID();
    const listener = (_e: unknown, p: { subId: string; rows: MessageRow[] }) => { if (p.subId === subId) cb(p.rows); };
    ipcRenderer.on('nm:convo', listener);
    void ipcRenderer.invoke('nm:watch-convo', { subId, threadId });
    return () => { ipcRenderer.removeListener('nm:convo', listener); void ipcRenderer.invoke('nm:unwatch', { subId }); };
  },
  watchTasks: (channelId: string, cb: (rows: unknown[]) => void): (() => void) => {
    const subId = crypto.randomUUID();
    const listener = (_e: unknown, p: { subId: string; rows: unknown[] }) => {
      if (p.subId === subId) cb(p.rows);
    };
    ipcRenderer.on('nm:tasks', listener);
    void ipcRenderer.invoke('nm:watch-tasks', { subId, channelId });
    return () => {
      ipcRenderer.removeListener('nm:tasks', listener);
      void ipcRenderer.invoke('nm:unwatch', { subId });
    };
  },
  watchThread: (taskId: string, cb: (rows: MessageRow[]) => void): (() => void) => {
    const subId = crypto.randomUUID();
    const listener = (_e: unknown, p: { subId: string; rows: MessageRow[] }) => {
      if (p.subId === subId) cb(p.rows);
    };
    ipcRenderer.on('nm:thread', listener);
    void ipcRenderer.invoke('nm:watch-thread', { subId, taskId });
    return () => {
      ipcRenderer.removeListener('nm:thread', listener);
      void ipcRenderer.invoke('nm:unwatch', { subId });
    };
  },
  sendThread: (taskId: string, channelId: string, body: string, opts?: { id?: string; attachments?: { id: string; name: string; mime: string }[] }) =>
    ipcRenderer.invoke('nm:send-thread', { taskId, channelId, body, id: opts?.id, attachments: opts?.attachments }),
  watchArtifacts: (taskId: string, cb: (rows: unknown[]) => void): (() => void) => {
    const subId = crypto.randomUUID();
    const listener = (_e: unknown, p: { subId: string; rows: unknown[] }) => {
      if (p.subId === subId) cb(p.rows);
    };
    ipcRenderer.on('nm:artifacts', listener);
    void ipcRenderer.invoke('nm:watch-artifacts', { subId, taskId });
    return () => {
      ipcRenderer.removeListener('nm:artifacts', listener);
      void ipcRenderer.invoke('nm:unwatch', { subId });
    };
  },
  watchBeats: (taskId: string, cb: (rows: unknown[]) => void): (() => void) => {
    const subId = crypto.randomUUID();
    const listener = (_e: unknown, p: { subId: string; rows: unknown[] }) => { if (p.subId === subId) cb(p.rows); };
    ipcRenderer.on('nm:beats', listener);
    void ipcRenderer.invoke('nm:watch-beats', { subId, taskId });
    return () => {
      ipcRenderer.removeListener('nm:beats', listener);
      void ipcRenderer.invoke('nm:unwatch', { subId });
    };
  },
  // Runs (docs/29): synced agent work — the room's recent runs, and every open one workspace-wide
  watchRuns: (channelId: string, cb: (rows: unknown[]) => void): (() => void) => {
    const subId = crypto.randomUUID();
    const listener = (_e: unknown, p: { subId: string; rows: unknown[] }) => { if (p.subId === subId) cb(p.rows); };
    ipcRenderer.on('nm:runs', listener);
    void ipcRenderer.invoke('nm:watch-runs', { subId, channelId });
    return () => {
      ipcRenderer.removeListener('nm:runs', listener);
      void ipcRenderer.invoke('nm:unwatch', { subId });
    };
  },
  watchOpenRuns: (cb: (rows: unknown[]) => void): (() => void) => {
    const subId = crypto.randomUUID();
    const listener = (_e: unknown, p: { subId: string; rows: unknown[] }) => { if (p.subId === subId) cb(p.rows); };
    ipcRenderer.on('nm:open-runs', listener);
    void ipcRenderer.invoke('nm:watch-open-runs', { subId });
    return () => {
      ipcRenderer.removeListener('nm:open-runs', listener);
      void ipcRenderer.invoke('nm:unwatch', { subId });
    };
  },
  // docs/31: reply tallies per root message, for the feed's "3 replies" footer
  watchReplyCounts: (channelId: string, cb: (rows: unknown[]) => void): (() => void) => {
    const subId = crypto.randomUUID();
    const listener = (_e: unknown, p: { subId: string; rows: unknown[] }) => { if (p.subId === subId) cb(p.rows); };
    ipcRenderer.on('nm:reply-counts', listener);
    void ipcRenderer.invoke('nm:watch-reply-counts', { subId, channelId });
    return () => {
      ipcRenderer.removeListener('nm:reply-counts', listener);
      void ipcRenderer.invoke('nm:unwatch', { subId });
    };
  },
  createTask: (channelId: string, title: string, opts?: { description?: string; offerTo?: string; project?: string; repoId?: string; baseRef?: string; backlog?: boolean; thread?: string }) =>
    ipcRenderer.invoke('nm:create-task', { channelId, title, ...(opts ?? {}) }),
  channelMeta: (channelId: string) => ipcRenderer.invoke('nm:channel-meta', { channelId }),
  workspaceMeta: () => ipcRenderer.invoke('nm:workspace-meta'),
  workspaceSettings: (): Promise<{ autoFailover: boolean; activeModelPack: string; commRules: unknown; plan: string; seats: number; subscriptionStatus: string | null; currentPeriodEnd: string | null; primaryMachineId: string | null }> => ipcRenderer.invoke('nm:workspace-settings'),
  workspaceUpdate: (input: { autoFailover?: boolean; activeModelPack?: string; commRules?: { ste100?: boolean; noEmdash?: boolean; custom?: string[] }; videoTier?: 'starter' | 'xpress' | 'premium' | null }) => ipcRenderer.invoke('nm:workspace-update', input),
  workspaceCreate: (input: { name: string; slug: string }): Promise<{ workspaceId: string }> => ipcRenderer.invoke('nm:workspace-create', input),
  // the nav foot's credit ring — /v1/usage over HTTP; null when this deployment doesn't serve it
  usage: (): Promise<unknown> => ipcRenderer.invoke('nm:usage'),
  devices: (): Promise<unknown> => ipcRenderer.invoke('nm:devices'),
  applyPack: (packId: string): Promise<{ ok: boolean; applied: number }> => ipcRenderer.invoke('nm:apply-pack', { packId }),
  // Custom brains (user-authored model packs) — workspace-scoped, read on demand
  modelPacks: (): Promise<{ packs: Array<{ id: string; name: string; roles: Record<string, string>; updatedAt: string }> }> => ipcRenderer.invoke('nm:model-packs'),
  modelPackSave: (input: { packId?: string; name: string; roles: Record<string, string> }): Promise<{ ok: boolean; packId: string }> => ipcRenderer.invoke('nm:model-pack-save', input),
  modelPackDelete: (packId: string): Promise<{ ok: boolean }> => ipcRenderer.invoke('nm:model-pack-delete', { packId }),
  billingCheckout: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('nm:billing-checkout'),
  creditsHistory: (): Promise<unknown> => ipcRenderer.invoke('nm:credits-history'),
  starterVideo: (): Promise<unknown> => ipcRenderer.invoke('nm:starter-video'),
  creditsCheckout: (credits: number): Promise<{ ok: boolean }> => ipcRenderer.invoke('nm:credits-checkout', { credits }),
  billingPortal: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('nm:billing-portal'),
  machineLimitInfo: (): Promise<{ message: string } | null> => ipcRenderer.invoke('nm:machine-limit-info'),
  machineTransfer: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('nm:machine-transfer'),
  machinesUsage: (): Promise<unknown> => ipcRenderer.invoke('nm:machines-usage'),
  machineWake: (): Promise<unknown> => ipcRenderer.invoke('nm:machine-wake'),
  syncAgents: (): Promise<{ ok: boolean; registered: number }> => ipcRenderer.invoke('nm:sync-agents'),
  projectCreate: (name: string, description?: string, slug?: string, newChannels?: string[], identity?: { website?: string; logoUrl?: string }): Promise<{ ok: boolean; projectId: string; slug: string }> =>
    ipcRenderer.invoke('nm:project-create', { name, description, slug, newChannels, ...identity }),
  // website/logoUrl: '' clears the stored value, undefined keeps it
  projectUpdate: (projectId: string, name?: string, description?: string, autoOpenPr?: boolean, runCiBeforeMerge?: boolean, shipGate?: boolean, identity?: { website?: string; logoUrl?: string }, modelPack?: string) =>
    ipcRenderer.invoke('nm:project-update', { projectId, name, description, autoOpenPr, runCiBeforeMerge, shipGate, website: identity?.website, logoUrl: identity?.logoUrl, modelPack }),
  subtaskAdd: (parentId: string, title: string, description?: string) =>
    ipcRenderer.invoke('nm:subtask-add', { parentId, title, description }),
  watchJourney: (cb: (rows: Array<{ task_id: string; has_design: number; has_plan: number }>) => void) => {
    const subId = crypto.randomUUID();
    const listener = (_e: unknown, msg: { subId: string; rows: Array<{ task_id: string; has_design: number; has_plan: number }> }) => {
      if (msg.subId === subId) cb(msg.rows);
    };
    ipcRenderer.on('nm:journey', listener);
    void ipcRenderer.invoke('nm:watch-journey', { subId });
    return () => {
      ipcRenderer.removeListener('nm:journey', listener);
      void ipcRenderer.invoke('nm:unwatch', { subId });
    };
  },
  shipItem: (taskId: string, itemId: string, state: 'pending' | 'done' | 'na', note?: string) =>
    ipcRenderer.invoke('nm:ship-item', { taskId, itemId, state, note }),
  shipItemAdd: (taskId: string, title: string, detail?: string) =>
    ipcRenderer.invoke('nm:ship-item-add', { taskId, title, detail }),
  projectArchive: (projectId: string, archived: boolean) =>
    ipcRenderer.invoke('nm:project-archive', { projectId, archived }),
  projectDelete: (projectId: string) =>
    ipcRenderer.invoke('nm:project-delete', { projectId }),
  channelCreate: (projectId: string, slug: string, topic?: string): Promise<{ ok: boolean; channelId: string; slug: string }> =>
    ipcRenderer.invoke('nm:channel-create', { projectId, slug, topic }),
  channelRename: (channelId: string, slug?: string, topic?: string): Promise<{ ok: boolean; channelId: string; slug: string }> =>
    ipcRenderer.invoke('nm:channel-rename', { channelId, slug, topic }),
  channelDelete: (channelId: string): Promise<{ ok: boolean; channelId: string }> =>
    ipcRenderer.invoke('nm:channel-delete', { channelId }),
  channelKind: (channelId: string, kind: 'build' | 'marketing'): Promise<{ ok: boolean; channelId: string }> =>
    ipcRenderer.invoke('nm:channel-kind', { channelId, kind }),
  marketingSetup: (channelId: string, website: string, focus: string[], goal?: string, releases?: { repoId?: string | null; slug?: string | null; now: boolean; watch: boolean; at?: string; tz?: string }): Promise<{ ok: boolean; channelId: string; threadId?: string; taskId?: string; releases?: { now: boolean; watch: 'armed' | 'plan_limit' | 'off' } }> =>
    ipcRenderer.invoke('nm:marketing-setup', { channelId, website, focus, goal, releases }),
  // one answered setup-flow step, persisted AS IT LANDS (setupflows.ts) — abandoning the
  // wizard is a pause, not a loss
  setupStep: (channelId: string, flow: string, step: string, value?: string | string[] | Record<string, unknown>): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('nm:setup-step', { channelId, flow, step, value }),
  marketingIntegration: (channelId: string, provider: 'posthog' | 'meta' | 'tiktok', enabled: boolean): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('nm:marketing-integration', { channelId, provider, enabled }),
  mcpKeys: (): Promise<{ presence: Record<'posthog' | 'meta' | 'instagram' | 'tiktok', boolean>; metaUrl: string; tiktokUrl: string }> =>
    ipcRenderer.invoke('nm:mcp-keys'),
  mcpKeySet: (provider: 'posthog' | 'meta' | 'metaUrl' | 'tiktok' | 'tiktokUrl', value: string): Promise<{ presence: Record<'posthog' | 'meta' | 'instagram' | 'tiktok', boolean> }> =>
    ipcRenderer.invoke('nm:mcp-key-set', { provider, value }),
  mcpVerify: (provider: 'posthog' | 'meta' | 'tiktok', token: string, url?: string): Promise<{ ok: boolean; detail: string }> =>
    ipcRenderer.invoke('nm:mcp-verify', { provider, token, url }),
  scheduleCreate: (p: { channelId: string; title: string; prompt: string; cadence: string; atTime?: string; tz?: string; weekday?: number; runAt?: string; routine?: boolean }): Promise<{ ok: boolean; scheduleId: string; nextRunAt: string }> =>
    ipcRenderer.invoke('nm:schedule-create', p),
  launcherIdeas: (channelId: string, mode: 'task' | 'routine'): Promise<string[] | null> =>
    ipcRenderer.invoke('nm:launcher-ideas', { channelId, mode }),
  scheduleStatus: (scheduleId: string, status: 'active' | 'paused'): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('nm:schedule-status', { scheduleId, status }),
  scheduleDelete: (scheduleId: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('nm:schedule-delete', { scheduleId }),
  scheduleUpdate: (p: { scheduleId: string; title: string; prompt: string; cadence: string; atTime?: string; tz?: string; weekday?: number; runAt?: string }): Promise<{ ok: boolean; nextRunAt: string }> =>
    ipcRenderer.invoke('nm:schedule-update', p),
  /** `null` = every room (the Automations destination at All scope) */
  schedules: (channelId: string | null): Promise<{ schedules: Array<{ id: string; title: string; cadence: string; at_time: string; tz: string; weekday: number | null; next_run_at: string | null; status: string; prompt: string; channel_id: string; channel_slug: string | null }> }> =>
    ipcRenderer.invoke('nm:schedules', { channelId }),
  /** an automation's run history (0119) — the conversations its slots opened, newest first */
  scheduleRuns: (scheduleId: string, limit?: number): Promise<{ runs: ScheduleRunRow[] }> =>
    ipcRenderer.invoke('nm:schedule-runs', { scheduleId, limit }),
  contentItems: (channelId: string): Promise<{ items: Array<{ id: string; platform: string; body: string; status: string; scheduled_at: string | null; published_at: string | null; external_url: string | null; created_at: string; schedule_id: string | null; task_id: string | null }> }> =>
    ipcRenderer.invoke('nm:content-items', { channelId }),
  contentByTask: (taskId: string): Promise<{ items: Array<{ id: string; platform: string; body: string; status: string; scheduled_at: string | null; published_at: string | null; external_url: string | null; created_at: string; schedule_id: string | null; task_id: string | null }> }> =>
    ipcRenderer.invoke('nm:content-by-task', { taskId }),
  /** a conversation's drafted posts (0115) — the same cards, with no task behind them */
  contentByThread: (threadId: string): Promise<{ items: Array<{ id: string; platform: string; body: string; status: string; scheduled_at: string | null; published_at: string | null; external_url: string | null; created_at: string; schedule_id: string | null; task_id: string | null }> }> =>
    ipcRenderer.invoke('nm:content-by-thread', { threadId }),
  /** every room's content, for the Automations › Calendar destination — each row carries the room
   *  it belongs to (slug + project) because narrowing happens in the ScopeBar, not in the query */
  contentAll: (): Promise<{ items: Array<{ id: string; platform: string; body: string; status: string; scheduled_at: string | null; published_at: string | null; external_url: string | null; created_at: string; schedule_id: string | null; task_id: string | null; channel_id: string; channel_slug: string | null; project_id: string | null }> }> =>
    ipcRenderer.invoke('nm:content-all'),
  /** the attention bar's three row sets (failure-alerts round) — folded renderer-side by the
   *  pure deriveAlerts, so this stays a dumb read */
  alerts: (): Promise<{
    connectors: Array<{ id: string; provider: string; handle: string; status: string; project_id: string | null; project_name: string | null; channel_id: string | null }>;
    schedules: Array<{ id: string; title: string; status: string; last_error: string | null; last_run_at: string | null; channel_id: string; channel_slug: string | null; project_id: string | null; project_name: string | null }>;
    posts: Array<{ id: string; platform: string; status: string; last_error: string | null; scheduled_at: string | null; channel_id: string; channel_slug: string | null; project_id: string | null; project_name: string | null }>;
  }> => ipcRenderer.invoke('nm:alerts'),
  contentApprove: (itemId: string, scheduledAt?: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('nm:content-approve', { itemId, scheduledAt }),
  contentUpdate: (itemId: string, body: string, mediaUrl?: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('nm:content-update', { itemId, body, mediaUrl }),
  contentDelete: (itemId: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('nm:content-delete', { itemId }),
  contentUnschedule: (itemId: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('nm:content-unschedule', { itemId }),
  draftImage: (itemId: string, opts?: { angle?: string; rewrite?: boolean }): Promise<{ ok: boolean; pending?: boolean; thumb?: string; body?: string; error?: string }> =>
    ipcRenderer.invoke('nm:draft-image', { itemId, ...opts }),
  contentMedia: (mediaId: string): Promise<string | null> => ipcRenderer.invoke('nm:content-media', { mediaId }),
  mediaPreview: (url: string): Promise<{ dataUrl: string | null }> =>
    ipcRenderer.invoke('nm:media-preview', { url }),
  connectorStart: (channelId: string, provider?: 'x' | 'linkedin' | 'instagram' | 'tiktok' | 'github'): Promise<{ ok: boolean }> => ipcRenderer.invoke('nm:connector-start', { channelId, provider }),
  /** the GitHub connector's resolve (docs/design/github-connector-2026-09): the row is written server-side when the App reads the repository */
  githubResolve: (channelId: string, repo?: string): Promise<{ ok: true; handle: string; attached?: boolean } | { ok: false; code: string; error: string; install?: string | null; repos?: string[]; hint?: string | null }> => ipcRenderer.invoke('nm:github-resolve', { channelId, repo }),
  connectors: (channelId?: string): Promise<{ connectors: Array<{ id: string; provider: string; handle: string; status: string }> }> =>
    ipcRenderer.invoke('nm:connectors', { channelId }),
  connectorDisconnect: (connectorId: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('nm:connector-disconnect', { connectorId }),
  channelArtifacts: (channelId: string): Promise<{ artifacts: Array<{ id: string; kind: string; name: string; mime: string | null; inline_content: string | null; size_bytes: number | null; promoted: number | null; message_id: string | null; task_id: string | null; tags?: string | null; created_at: string }> }> =>
    ipcRenderer.invoke('nm:channel-artifacts', { channelId }),
  /** a conversation's own produced files — reached through its messages (artifacts carry no thread_id) */
  threadArtifacts: (threadId: string): Promise<{ artifacts: Array<{ id: string; kind: string; name: string; mime: string | null; inline_content: string | null; size_bytes: number | null; promoted: number | null; message_id: string | null; task_id: string | null; created_at: string }> }> =>
    ipcRenderer.invoke('nm:thread-artifacts', { threadId }),
  /** one artifact by id — the ‹article:id› card reads its own row, self-contained like WbCard */
  artifact: (artifactId: string): Promise<{ artifact: { id: string; kind: string; name: string; mime: string | null; inline_content: string | null; size_bytes: number | null; promoted: number | null; channel_id: string | null; channel_slug: string | null; task_id: string | null; created_at: string } | null }> =>
    ipcRenderer.invoke('nm:artifact', { artifactId }),
  /** open an article in the OS browser: main writes the rendered HTML to a temp file (article round) */
  articleExternal: (name: string, html: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('nm:article-external', { name, html }),
  pinMessage: (messageId: string, pinned: boolean) =>
    ipcRenderer.invoke('nm:message-pin', { messageId, pinned }),
  repoAdd: (opts: { url?: string; localPath?: string; name?: string; channelSlug?: string; projectId?: string; defaultBranch?: string }): Promise<{ ok: boolean; repoId: string; inserted: boolean }> =>
    ipcRenderer.invoke('nm:repo-add', opts),
  /** Save an artifact's bytes wherever the human chooses (2026-08-18) */
  saveFileAs: (f: { name: string; content: string; base64?: boolean }): Promise<{ saved: boolean; path?: string }> =>
    ipcRenderer.invoke('nm:save-file-as', f),
  pickFolder: (): Promise<{ path: string; name: string; isGit: boolean; branch: string; remoteLabel: string | null } | null> =>
    ipcRenderer.invoke('nm:pick-folder'),
  // Workspace Files: add files to a ROOM (the room is the ACL, so it is the argument)
  fileUpload: (channelId: string): Promise<{ ok: boolean; added: number; skipped: string[] }> =>
    ipcRenderer.invoke('nm:file-upload', { channelId }),
  projectDetect: (path: string): Promise<{ name: string; slug: string; description: string; remoteUrl: string | null; remoteLabel: string | null; rooms: string[] } | null> =>
    ipcRenderer.invoke('nm:project-detect', { path }),
  logoDetect: (input: { url?: string; path?: string }): Promise<{ logoUrl: string; source: string; website?: string } | null> =>
    ipcRenderer.invoke('nm:logo-detect', input),
  fsList: (root: string, path?: string): Promise<{ entries: { name: string; dir: boolean }[]; error?: string }> =>
    ipcRenderer.invoke('nm:fs-list', { root, path }),
  fsRead: (root: string, path: string): Promise<{ content: string; truncated?: boolean; binary?: boolean; error?: string }> =>
    ipcRenderer.invoke('nm:fs-read', { root, path }),
  fsWrite: (root: string, path: string, content: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('nm:fs-write', { root, path, content }),
  gitBranches: (root: string): Promise<{ current: string | null; branches: string[] }> =>
    ipcRenderer.invoke('nm:git-branches', { root }),
  gitCheckout: (root: string, branch: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('nm:git-checkout', { root, branch }),
  invite: (email: string) => ipcRenderer.invoke('nm:invite', { email }),
  invites: () => ipcRenderer.invoke('nm:invites'),
  revokeInvite: (invite: string) => ipcRenderer.invoke('nm:revoke-invite', { invite }),
  // multi-workspace (0113): the switcher, the invitations waiting on you, and the exits
  workspaces: () => ipcRenderer.invoke('nm:workspaces'),
  switchWorkspace: (workspace: string) => ipcRenderer.invoke('nm:switch-workspace', { workspace }),
  myInvites: () => ipcRenderer.invoke('nm:my-invites'),
  acceptInvite: (invite: string) => ipcRenderer.invoke('nm:accept-invite', { invite }),
  declineInvite: (invite: string) => ipcRenderer.invoke('nm:decline-invite', { invite }),
  leaveWorkspace: (workspace: string) => ipcRenderer.invoke('nm:leave-workspace', { workspace }),
  removeMember: (member: string) => ipcRenderer.invoke('nm:remove-member', { member }),
  liveRuns: () => ipcRenderer.invoke('nm:live-runs'),
  watchLibrary: (channelId: string, cb: (rows: unknown[]) => void): (() => void) => {
    const subId = crypto.randomUUID();
    const listener = (_e: unknown, p: { subId: string; rows: unknown[] }) => {
      if (p.subId === subId) cb(p.rows);
    };
    ipcRenderer.on('nm:library', listener);
    void ipcRenderer.invoke('nm:watch-library', { subId, channelId });
    return () => {
      ipcRenderer.removeListener('nm:library', listener);
      void ipcRenderer.invoke('nm:unwatch', { subId });
    };
  },
  promoteArtifact: (artifactId: string) => ipcRenderer.invoke('nm:promote-artifact', { artifactId }),
  artifactDelete: (artifactId: string) => ipcRenderer.invoke('nm:delete-artifact', { artifactId }),
  // ── whiteboards (docs/38) ──────────────────────────────────────────────────────────────────
  wbCreate: (channelId: string, opts?: { title?: string; threadId?: string }): Promise<{ id: string }> =>
    ipcRenderer.invoke('nm:wb-create', { channelId, title: opts?.title, threadId: opts?.threadId }),
  wbSave: (id: string, rev: number, patch: { scene?: string; snapshotSvg?: string; title?: string }): Promise<void> =>
    ipcRenderer.invoke('nm:wb-save', { id, rev, ...patch }),
  wbArchive: (id: string, rev: number, restore?: boolean): Promise<void> =>
    ipcRenderer.invoke('nm:wb-archive', { id, rev, restore }),
  wbUpdateCmd: (payload: { whiteboardId: string; baseRev: number; title?: string; scene?: string; snapshotSvg?: string; clearSource?: boolean }): Promise<{ ok: boolean; status: number; rev?: number; code?: string; error?: string }> =>
    ipcRenderer.invoke('nm:wb-update-cmd', payload),
  watchWhiteboards: (scope: { channelId?: string | null; projectId?: string | null }, cb: (rows: unknown[]) => void): (() => void) => {
    const subId = crypto.randomUUID();
    const listener = (_e: unknown, p: { subId: string; rows: unknown[] }) => {
      if (p.subId === subId) cb(p.rows);
    };
    ipcRenderer.on('nm:whiteboards', listener);
    void ipcRenderer.invoke('nm:watch-whiteboards', { subId, channelId: scope.channelId ?? null, projectId: scope.projectId ?? null });
    return () => {
      ipcRenderer.removeListener('nm:whiteboards', listener);
      void ipcRenderer.invoke('nm:unwatch', { subId });
    };
  },
  watchWhiteboard: (id: string, cb: (row: unknown | null) => void): (() => void) => {
    const subId = crypto.randomUUID();
    const listener = (_e: unknown, p: { subId: string; row: unknown | null }) => {
      if (p.subId === subId) cb(p.row);
    };
    ipcRenderer.on('nm:whiteboard', listener);
    void ipcRenderer.invoke('nm:watch-whiteboard', { subId, id });
    return () => {
      ipcRenderer.removeListener('nm:whiteboard', listener);
      void ipcRenderer.invoke('nm:unwatch', { subId });
    };
  },
  taskAction: (type: string, taskId: string, feedback?: string, input?: { provider?: 'iris' | 'claude-design'; designer?: string; kind?: string }) =>
    ipcRenderer.invoke('nm:task-action', { type, taskId, feedback, input }),
  taskSetDod: (taskId: string, dod: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('nm:task-set-dod', { taskId, dod }),
  shareCompute: (member: string, on: boolean): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('nm:share-compute', { member, on }),
  computeSharedThreads: (member: string): Promise<{ count: number }> =>
    ipcRenderer.invoke('nm:compute-shared-threads', { member }),
  setCompute: (prefs: { machine?: string | null; agents?: Record<string, string>; shares?: string[]; desktopSessions?: 'here' | 'auto' }): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('nm:set-compute', prefs),
  taskUpdateDetails: (taskId: string, fields: { title?: string; description?: string }): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('nm:task-update-details', { taskId, ...fields }),
  retro: (range: string) => ipcRenderer.invoke('nm:retro', { range }),
  roster: () => ipcRenderer.invoke('nm:roster'),
  latest: () => ipcRenderer.invoke('nm:latest'),
  latestThreads: () => ipcRenderer.invoke('nm:latest-threads'),
  registerAgent: (input: { name: string; role: string; model: string; runtime?: string; channels: string[]; apiKey?: string; description?: string; brief?: string }) =>
    ipcRenderer.invoke('nm:agent-register', input),
  // `description` routes (what it does + when to route here, read by the orchestrator);
  // `brief` instructs (how it works, injected into its turns). '' clears either — 0110.
  agentUpdate: (input: { agentId: string; model?: string; runtime?: string; name?: string; description?: string; brief?: string; modelSource?: 'pack' | 'manual' }) =>
    ipcRenderer.invoke('nm:agent-update', input),
  // this machine's instructions for an agent — local-first, never synced
  agentInstructions: (name: string, role: string): Promise<{ local: string | null; shipped: string | null; path: string; prompt: Record<string, string> | null }> =>
    ipcRenderer.invoke('nm:agent-instructions', { name, role }),
  agentInstructionsWrite: (name: string, instructions: string | null): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('nm:agent-instructions-write', { name, instructions }),
  agentRetire: (agentId: string): Promise<{ ok: boolean; agentId: string; alreadyRetired: boolean }> =>
    ipcRenderer.invoke('nm:agent-retire', { agentId }),
  updateProfile: (displayName: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('nm:update-profile', { displayName }),
  claudeDesignStatus: (): Promise<{ configured: boolean; claudeAuthed: boolean; detail: string }> =>
    ipcRenderer.invoke('nm:claude-design-status'),
  claudeDesignConnect: (taskId?: string): Promise<{ configured: boolean; cwd: string; command: string; taskNumber: number | null }> =>
    ipcRenderer.invoke('nm:claude-design-connect', { taskId }),
  addAgentToChannel: (channelId: string, agent: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('nm:channel-add-agent', { channelId, agent }),
  removeAgentFromChannel: (channelId: string, agent: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('nm:channel-remove-agent', { channelId, agent }),
  addPersonToChannel: (channelId: string, person: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('nm:channel-add-person', { channelId, person }),
  removePersonFromChannel: (channelId: string, person: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('nm:channel-remove-person', { channelId, person }),
  channelPeople: (channelId: string): Promise<Array<{ user_id: string; display_name: string | null; role: string; created_at: string | null; created_by: string | null }>> =>
    ipcRenderer.invoke('nm:channel-people', { channelId }),
  channelHistory: (channelId: string): Promise<Array<{ agent_id: string; name: string; role: string; created_at: string | null; created_by_kind: string | null; created_by: string | null }>> =>
    ipcRenderer.invoke('nm:channel-history', { channelId }),
  // desktop notifications: persist the on/off pref to the main process; subscribe to deep-link
  // clicks (the OS notification was clicked → navigate to that thread).
  setNotificationsEnabled: (on: boolean): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('nm:notify-set-enabled', on),
  onOpenThread: (cb: (nav: { channelId: string; taskId: string | null; messageId: string }) => void): (() => void) => {
    const l = (_e: unknown, nav: { channelId: string; taskId: string | null; messageId: string }) => cb(nav);
    ipcRenderer.on('nm:open-thread', l);
    return () => { ipcRenderer.removeListener('nm:open-thread', l); };
  },
  // a Free-plan gate (PLAN_LIMIT) fired by the control-api → open the upgrade flow with the reason
  onPlanLimit: (cb: (p: { message: string }) => void): (() => void) => {
    const l = (_e: unknown, p: { message: string }) => cb(p);
    ipcRenderer.on('nm:plan-limit', l);
    return () => { ipcRenderer.removeListener('nm:plan-limit', l); };
  },
  // the foreground connection swapped in place (main/sync.ts setForeground) — the shell remounts
  onForeground: (cb: (c: { id: string; kind: string; authMode: string; workspaceId: string }) => void): (() => void) => {
    const l = (_e: unknown, c: { id: string; kind: string; authMode: string; workspaceId: string }) => cb(c);
    ipcRenderer.on('nm:foreground', l); return () => { ipcRenderer.removeListener('nm:foreground', l); };
  },
  // the connections this launch holds (U3b): the list, its pushes, the swap, and the rail's union
  connections: () => ipcRenderer.invoke('nm:connections'),
  onConnections: (cb: (list: unknown[]) => void): (() => void) => { const l = (_e: unknown, list: unknown[]) => cb(list); ipcRenderer.on('nm:connections', l); return () => { ipcRenderer.removeListener('nm:connections', l); }; },
  setForeground: (connectionId: string, workspaceId?: string | null) => ipcRenderer.invoke('nm:set-foreground', { connectionId, workspaceId: workspaceId ?? null }),
  watchRailRows: (cb: (p: Record<string, unknown[]>) => void): (() => void) => { const subId = crypto.randomUUID(); const l = (_e: unknown, p: { subId: string } & Record<string, unknown[]>) => { if (p.subId === subId) cb(p); }; ipcRenderer.on('nm:rail-rows', l); invokeRetry('nm:watch-rail-rows', { subId }); return () => { ipcRenderer.removeListener('nm:rail-rows', l); void ipcRenderer.invoke('nm:unwatch', { subId }); }; },
  // the first-run doors (main/firstrunipc.ts): the door's state, the three doors, the wait's two buttons
  firstRunState: () => ipcRenderer.invoke('nm:first-run-state'),
  onFirstRun: (cb: (s: unknown) => void): (() => void) => { const l = (_e: unknown, s: unknown) => cb(s); ipcRenderer.on('nm:first-run', l); return () => { ipcRenderer.removeListener('nm:first-run', l); }; },
  firstRunChoose: (door: string) => ipcRenderer.invoke('nm:first-run-choose', { door }),
  firstRunReopen: () => ipcRenderer.invoke('nm:first-run-reopen'),
  firstRunCancel: () => ipcRenderer.invoke('nm:first-run-cancel'),
  // Local mode's stack (main/localStack/ipc.ts): the card's state, its actions, the one setting
  localStackState: () => ipcRenderer.invoke('nm:local-stack-state'),
  onLocalStack: (cb: (p: unknown) => void): (() => void) => {
    const l = (_e: unknown, p: unknown) => cb(p); ipcRenderer.on('nm:local-stack', l); return () => { ipcRenderer.removeListener('nm:local-stack', l); };
  },
  localStackPick: (runtime: string) => ipcRenderer.invoke('nm:local-stack-pick', { runtime }),
  localStackInstall: () => ipcRenderer.invoke('nm:local-stack-install'),
  localStackRescan: () => ipcRenderer.invoke('nm:local-stack-rescan'),
  localStackQuit: () => ipcRenderer.invoke('nm:local-stack-quit'),
  localKeepRunningGet: () => ipcRenderer.invoke('nm:local-keep-running-get'),
  localKeepRunningSet: (keep: boolean) => ipcRenderer.invoke('nm:local-keep-running-set', { keep }),
  // the upgrade handoff (main/upgradeipc.ts): Get Pro opens neuramesh.app/pro and the sheet waits on the push
  upgradeState: () => ipcRenderer.invoke('nm:upgrade-state'),
  upgradeStart: () => ipcRenderer.invoke('nm:upgrade-start'),
  upgradeReopen: () => ipcRenderer.invoke('nm:upgrade-reopen'),
  upgradeCancel: () => ipcRenderer.invoke('nm:upgrade-cancel'),
  onUpgrade: (cb: (p: unknown) => void): (() => void) => { const l = (_e: unknown, p: unknown) => cb(p); ipcRenderer.on('nm:upgrade', l); return () => { ipcRenderer.removeListener('nm:upgrade', l); }; },
  // Settings › Connections (main/connectionsipc.ts + localStack/ipc.ts) and the hosted shell's export
  connectionsList: () => ipcRenderer.invoke('nm:connections-list'),
  connectionAddCustom: (input: { apiUrl: string; powersyncUrl?: string; bearer: string }) => ipcRenderer.invoke('nm:connection-add-custom', input),
  connectionRemove: (id: string) => ipcRenderer.invoke('nm:connection-remove', { id }),
  connectionBillingPortal: (id: string) => ipcRenderer.invoke('nm:connection-billing-portal', { id }),
  showInFolder: (path: string) => ipcRenderer.invoke('nm:show-in-folder', { path }),
  localStackInfo: () => ipcRenderer.invoke('nm:local-stack-info'),
  localStackRestart: () => ipcRenderer.invoke('nm:local-stack-restart'),
  workspaceExport: () => ipcRenderer.invoke('nm:workspace-export'),
  // Move to Cloud (main/moveipc.ts): the plan's numbers, the start, the cancel, the phase, and Open in <target>
  movePlan: (targetWorkspaceId?: string) => ipcRenderer.invoke('nm:move-plan', { targetWorkspaceId }),
  moveStart: (targetWorkspaceId: string) => ipcRenderer.invoke('nm:move-start', { targetWorkspaceId }),
  moveCancel: () => ipcRenderer.invoke('nm:move-cancel'),
  moveState: () => ipcRenderer.invoke('nm:move-state'),
  moveOpen: () => ipcRenderer.invoke('nm:move-open'),
  onMove: (cb: (p: unknown) => void): (() => void) => { const l = (_e: unknown, p: unknown) => cb(p); ipcRenderer.on('nm:move', l); return () => { ipcRenderer.removeListener('nm:move', l); }; },
  // auto-update: subscribe to lifecycle broadcasts + poll current state on mount
  // (the card can mount after the first event fired). Commands are user-driven.
  onUpdate: (cb: (s: UpdateState) => void): (() => void) => {
    const l = (_e: unknown, s: UpdateState) => cb(s);
    ipcRenderer.on('nm:update', l);
    return () => { ipcRenderer.removeListener('nm:update', l); };
  },
  updateState: (): Promise<UpdateState> => ipcRenderer.invoke('nm:update-state'),
  updateCheck: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('nm:update-check'),
  updateDownload: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('nm:update-download'),
  updateInstall: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('nm:update-install'),
  ensureRuntimeCli: (runtime: string) => ipcRenderer.invoke('nm:ensure-runtime-cli', { runtime }),
  agentConnectRemote: (cardUrl: string, channels: string[]) => ipcRenderer.invoke('nm:agent-connect-remote', { cardUrl, channels }),
  credentials: () => ipcRenderer.invoke('nm:credentials'),
  detectProviders: () => ipcRenderer.invoke('nm:detect-providers'),
  providerReauth: (provider: string) => ipcRenderer.invoke('nm:provider-reauth', { provider }),
  setCredential: (input: { scope: 'workspace' | 'agent'; agentId?: string; token?: string; provider?: string; authMode?: 'apikey' | 'subscription' }) =>
    ipcRenderer.invoke('nm:credential-set', input),
  memory: (channelSlug: string) => ipcRenderer.invoke('nm:memory', { channelSlug }),
  memoryRetireFact: (factId: string, supersededBy?: string) => ipcRenderer.invoke('nm:memory-retire-fact', { factId, supersededBy }),
  memoryRecordLesson: (channelSlug: string, content: string) => ipcRenderer.invoke('nm:memory-record-lesson', { channelSlug, content }),
  members: () => ipcRenderer.invoke('nm:members'),
  welcomed: () => ipcRenderer.invoke('nm:welcomed'),
  taskDetail: (taskId: string) => ipcRenderer.invoke('nm:task-detail', { taskId }),
  terminalInfo: (taskNumber: number, hasRepo: boolean) => ipcRenderer.invoke('nm:terminal-info', { taskNumber, hasRepo }),
  // the desktop Code bridge (2026-09-04): main's relay facts, composed into the browser's relay
  // bridge by the renderer (src/bridge/desktop-relay.ts) — the terminals above stay local
  relayEnv: () => ipcRenderer.invoke('nm:relay-env'),
  relayHeaders: () => ipcRenderer.invoke('nm:relay-headers'),
  relayBearer: () => ipcRenderer.invoke('nm:relay-bearer'),
  // the desktop Code bridge's LOCAL lane (slice B1): the app's own engineering host, in process — a
  // subId, a stream of events, an exit, exactly the terminals' shape
  engineeringLocalInfo: () => ipcRenderer.invoke('nm:engineering-local-info'),
  openEngineeringLocal: (meta: unknown, onEvent: (event: unknown) => void, onExit: () => void): { subId: string; send: (command: unknown) => Promise<void>; close: () => void } => {
    const subId = crypto.randomUUID();
    const evL = (_e: unknown, p: { subId: string; event: unknown }) => { if (p.subId === subId) onEvent(p.event); };
    const off = () => { ipcRenderer.removeListener('nm:engineering-event', evL); ipcRenderer.removeListener('nm:engineering-exit', exL); };
    const exL = (_e: unknown, p: { subId: string }) => { if (p.subId === subId) { off(); onExit(); } };
    ipcRenderer.on('nm:engineering-event', evL); ipcRenderer.on('nm:engineering-exit', exL);
    void ipcRenderer.invoke('nm:engineering-local-open', { subId, meta });
    return { subId, send: (command) => ipcRenderer.invoke('nm:engineering-local-command', { subId, command }), close: () => { off(); void ipcRenderer.invoke('nm:engineering-local-close', { subId }); } };
  },
  openTerminalCwd: (cwd: string, cols: number, rows: number, onData: (d: string) => void, onExit: () => void, startupCommand?: string): { subId: string; input: (d: string) => void; resize: (c: number, r: number) => void; close: () => void } => {
    const subId = crypto.randomUUID();
    const dataL = (_e: unknown, p: { subId: string; data: string }) => { if (p.subId === subId) onData(p.data); };
    const exitL = (_e: unknown, p: { subId: string }) => { if (p.subId === subId) onExit(); };
    ipcRenderer.on('nm:terminal-data', dataL);
    ipcRenderer.on('nm:terminal-exit', exitL);
    void ipcRenderer.invoke('nm:pty-open', { subId, cwd, cols, rows, startupCommand });
    return {
      subId,
      input: (d) => ipcRenderer.invoke('nm:terminal-input', { subId, data: d }),
      resize: (c, r) => ipcRenderer.invoke('nm:terminal-resize', { subId, cols: c, rows: r }),
      close: () => {
        ipcRenderer.removeListener('nm:terminal-data', dataL);
        ipcRenderer.removeListener('nm:terminal-exit', exitL);
        void ipcRenderer.invoke('nm:terminal-close', { subId });
      },
    };
  },
  openTerminal: (taskNumber: number, hasRepo: boolean, cols: number, rows: number, onData: (d: string) => void, onExit: () => void): { subId: string; input: (d: string) => void; resize: (c: number, r: number) => void; close: () => void } => {
    const subId = crypto.randomUUID();
    const dataL = (_e: unknown, p: { subId: string; data: string }) => { if (p.subId === subId) onData(p.data); };
    const exitL = (_e: unknown, p: { subId: string }) => { if (p.subId === subId) onExit(); };
    ipcRenderer.on('nm:terminal-data', dataL);
    ipcRenderer.on('nm:terminal-exit', exitL);
    void ipcRenderer.invoke('nm:terminal-open', { subId, taskNumber, hasRepo, cols, rows });
    return {
      subId,
      input: (d) => ipcRenderer.invoke('nm:terminal-input', { subId, data: d }),
      resize: (c, r) => ipcRenderer.invoke('nm:terminal-resize', { subId, cols: c, rows: r }),
      close: () => {
        ipcRenderer.removeListener('nm:terminal-data', dataL);
        ipcRenderer.removeListener('nm:terminal-exit', exitL);
        void ipcRenderer.invoke('nm:terminal-close', { subId });
      },
    };
  },
  processList: (): Promise<{ agents: Array<{ taskId: string; taskNumber: number | null; agentName: string; title: string }>; terminals: Array<{ subId: string; taskNumber: number; title: string }> }> => ipcRenderer.invoke('nm:process-list'),
  processKill: (kind: 'agent' | 'terminal', id: string): Promise<{ ok: boolean }> => ipcRenderer.invoke('nm:process-kill', { kind, id }),
  watchProcesses: (cb: () => void): (() => void) => {
    const subId = crypto.randomUUID();
    const listener = (_e: unknown, p: { subId: string }) => { if (p.subId === subId) cb(); };
    ipcRenderer.on('nm:process-changed', listener);
    void ipcRenderer.invoke('nm:process-watch', { subId });
    return () => { ipcRenderer.removeListener('nm:process-changed', listener); void ipcRenderer.invoke('nm:process-unwatch', { subId }); };
  },
  watchSkills: (channelId: string | null, cb: (rows: unknown[]) => void): (() => void) => {
    const subId = crypto.randomUUID();
    const listener = (_e: unknown, p: { subId: string; rows: unknown[] }) => { if (p.subId === subId) cb(p.rows); };
    ipcRenderer.on('nm:skills', listener);
    void ipcRenderer.invoke('nm:watch-skills', { subId, channelId });
    return () => { ipcRenderer.removeListener('nm:skills', listener); void ipcRenderer.invoke('nm:unwatch', { subId }); };
  },
  skillCreate: (input: { channelSlug?: string; name: string; description: string; scope: 'channel' | 'global'; body: string }) =>
    ipcRenderer.invoke('nm:skill-create', input),
  skillUpdate: (input: { skillId: string; description?: string; body?: string; scope?: 'channel' | 'global' }) =>
    ipcRenderer.invoke('nm:skill-update', input),
  skillDeprecate: (skillId: string) => ipcRenderer.invoke('nm:skill-deprecate', { skillId }),
  skillPromote: (skillId: string) => ipcRenderer.invoke('nm:skill-promote', { skillId }),
  skillSetEnabled: (skillId: string, enabled: boolean) => ipcRenderer.invoke('nm:skill-set-enabled', { skillId, enabled }),
  watchSkillPacks: (channelId: string, cb: (rows: unknown[]) => void): (() => void) => {
    const subId = crypto.randomUUID();
    const listener = (_e: unknown, p: { subId: string; rows: unknown[] }) => { if (p.subId === subId) cb(p.rows); };
    ipcRenderer.on('nm:skill-packs', listener);
    void ipcRenderer.invoke('nm:watch-skill-packs', { subId, channelId });
    return () => { ipcRenderer.removeListener('nm:skill-packs', listener); void ipcRenderer.invoke('nm:unwatch', { subId }); };
  },
  skillpackSetEnabled: (packId: string, enabled: boolean) => ipcRenderer.invoke('nm:skillpack-set-enabled', { packId, enabled }),
  skillpackRemove: (packId: string) => ipcRenderer.invoke('nm:skillpack-remove', { packId }),
  skillpackAdd: (input: { channelSlug: string; url: string; ref?: string; name?: string }) => ipcRenderer.invoke('nm:skillpack-add', input),
  skillpackRetry: (packId: string) => ipcRenderer.invoke('nm:skillpack-retry', { packId }),
  agentLogs: (f: { agentId?: string; runId?: string; taskNumber?: number; level?: string; search?: string; limit?: number }) =>
    ipcRenderer.invoke('nm:agent-logs', f),
  agentRuns: (agentId: string, limit?: number) => ipcRenderer.invoke('nm:agent-runs', { agentId, limit }),
  exportLogs: (f: { agentId?: string; taskNumber?: number; level?: string; search?: string }) =>
    ipcRenderer.invoke('nm:export-logs', f),
  debugSeedLogs: () => ipcRenderer.invoke('nm:debug-seed-logs'), // shot-harness only (handler gated)
  debugSeedPlan: () => ipcRenderer.invoke('nm:debug-seed-plan'), // shot-harness only (handler gated)
  debugSeedReview: () => ipcRenderer.invoke('nm:debug-seed-review'), // shot-harness only (handler gated)
  debugSeedDod: () => ipcRenderer.invoke('nm:debug-seed-dod'), // shot-harness only (handler gated)
  debugSeedPr: () => ipcRenderer.invoke('nm:debug-seed-pr'), // shot-harness only (handler gated)
  debugSeedImport: () => ipcRenderer.invoke('nm:debug-seed-import'), // shot-harness only (handler gated)
  debugSeedLessons: () => ipcRenderer.invoke('nm:debug-seed-lessons'), // shot-harness only (handler gated)
  watchAgentLogs: (cb: (row: unknown) => void): (() => void) => {
    const subId = crypto.randomUUID();
    const listener = (_e: unknown, p: { subId: string; row: unknown }) => {
      if (p.subId === subId) cb(p.row);
    };
    ipcRenderer.on('nm:agent-log-row', listener);
    void ipcRenderer.invoke('nm:watch-agent-logs', { subId });
    return () => {
      ipcRenderer.removeListener('nm:agent-log-row', listener);
      void ipcRenderer.invoke('nm:unwatch', { subId });
    };
  },
  // live token stream from local agents (host broadcasts to all windows; no subId)
  watchAgentStream: (cb: (p: { key: string; agent: string; text: string; done: boolean }) => void): (() => void) => {
    const listener = (_e: unknown, p: { key: string; agent: string; text: string; done: boolean }) => cb(p);
    ipcRenderer.on('nm:agent-stream', listener);
    return () => ipcRenderer.removeListener('nm:agent-stream', listener);
  },
  watchRoster: (cb: (p: { machines: unknown[]; agents: unknown[]; members: unknown[] }) => void): (() => void) => {
    const subId = crypto.randomUUID();
    const listener = (_e: unknown, p: { subId: string; machines: unknown[]; agents: unknown[]; members: unknown[] }) => {
      if (p.subId === subId) cb(p);
    };
    ipcRenderer.on('nm:roster-live', listener);
    invokeRetry('nm:watch-roster', { subId });
    return () => {
      ipcRenderer.removeListener('nm:roster-live', listener);
      void ipcRenderer.invoke('nm:unwatch', { subId });
    };
  },
  watchTasksAll: (cb: (rows: unknown[]) => void): (() => void) => {
    const subId = crypto.randomUUID();
    const listener = (_e: unknown, p: { subId: string; rows: unknown[] }) => {
      if (p.subId === subId) cb(p.rows);
    };
    ipcRenderer.on('nm:tasks-all', listener);
    invokeRetry('nm:watch-tasks-all', { subId });
    return () => {
      ipcRenderer.removeListener('nm:tasks-all', listener);
      void ipcRenderer.invoke('nm:unwatch', { subId });
    };
  },
  // the workspace's single OPEN capacity-failover (docs/22) — feeds the sticky fly-up
  watchFailover: (cb: (row: unknown | null) => void): (() => void) => {
    const subId = crypto.randomUUID();
    const listener = (_e: unknown, p: { subId: string; row: unknown | null }) => { if (p.subId === subId) cb(p.row); };
    ipcRenderer.on('nm:failover', listener);
    invokeRetry('nm:watch-failover', { subId });
    return () => { ipcRenderer.removeListener('nm:failover', listener); void ipcRenderer.invoke('nm:unwatch', { subId }); };
  },
  watchDecisionsAll: (cb: (rows: unknown[]) => void): (() => void) => {
    const subId = crypto.randomUUID();
    const listener = (_e: unknown, p: { subId: string; rows: unknown[] }) => {
      if (p.subId === subId) cb(p.rows);
    };
    ipcRenderer.on('nm:decisions-all', listener);
    invokeRetry('nm:watch-decisions-all', { subId });
    return () => {
      ipcRenderer.removeListener('nm:decisions-all', listener);
      void ipcRenderer.invoke('nm:unwatch', { subId });
    };
  },
  decisionAction: (type: 'decision.answer' | 'decision.dismiss', decisionId: string, answer?: string) =>
    ipcRenderer.invoke('nm:decision-action', { type, decisionId, answer }),
  watchLibraryAll: (cb: (rows: unknown[]) => void): (() => void) => {
    const subId = crypto.randomUUID();
    const listener = (_e: unknown, p: { subId: string; rows: unknown[] }) => {
      if (p.subId === subId) cb(p.rows);
    };
    ipcRenderer.on('nm:library-all', listener);
    invokeRetry('nm:watch-library-all', { subId });
    return () => {
      ipcRenderer.removeListener('nm:library-all', listener);
      void ipcRenderer.invoke('nm:unwatch', { subId });
    };
  },
  watchAttachmentsAll: (cb: (rows: unknown[]) => void): (() => void) => {
    const subId = crypto.randomUUID();
    const listener = (_e: unknown, p: { subId: string; rows: unknown[] }) => {
      if (p.subId === subId) cb(p.rows);
    };
    ipcRenderer.on('nm:attachments-all', listener);
    invokeRetry('nm:watch-attachments-all', { subId });
    return () => {
      ipcRenderer.removeListener('nm:attachments-all', listener);
      void ipcRenderer.invoke('nm:unwatch', { subId });
    };
  },
  bootstrap: () => ipcRenderer.invoke('nm:bootstrap'),
  onboard: (input: { workspaceId?: string; name: string; slug: string; providers: Array<{ provider: string; mode: 'apikey' | 'subscription'; key: string }>; activeModelPack?: string; agents: Array<{ name: string; role: string; model: string; runtime?: string; emoji?: string; channels: string[] }> }) => ipcRenderer.invoke('nm:onboard', input),
  openExternal: (url: string) => ipcRenderer.invoke('nm:open-external', { url }),
  // the default browser's name + icon, for the link choice's second row (main/links.ts)
  defaultBrowser: () => ipcRenderer.invoke('nm:default-browser'),
  openHtml: (name: string, content: string) => ipcRenderer.invoke('nm:open-html', { name, content }),
  authStatus: () => ipcRenderer.invoke('nm:auth-status'),
  login: (email: string, password: string) => ipcRenderer.invoke('nm:auth-login', { email, password }),
  loginGitHub: () => ipcRenderer.invoke('nm:auth-github'),
  authClerk: () => ipcRenderer.invoke('nm:auth-clerk'),
  authClerkOAuth: (provider: 'google' | 'github') => ipcRenderer.invoke('nm:auth-clerk-oauth', { provider }),
  authClerkPassword: (email: string, password: string) => ipcRenderer.invoke('nm:auth-clerk-password', { email, password }),
  authClerkSignup: (email: string, password: string) => ipcRenderer.invoke('nm:auth-clerk-signup', { email, password }),
  accountBlockers: () => ipcRenderer.invoke('nm:account-blockers'),
  workspaceDelete: (workspaceId: string) => ipcRenderer.invoke('nm:workspace-delete', { workspaceId }),
  accountDelete: () => ipcRenderer.invoke('nm:account-delete'),
  logout: () => ipcRenderer.invoke('nm:auth-logout'),
});
