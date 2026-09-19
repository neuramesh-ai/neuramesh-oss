// The in-memory Store — extracted from store.ts (track C-store).
//
// What apps/desktop and most of the suite run against, so it is not a mock: it must
// behave exactly as PostgresStore does. That equivalence has no test today (the pairs are
// written twice, not shared), which is why this moves as ONE file rather than being cut
// into repositories — the split waits for the contract suite that would prove it safe.
import { applyShare, type BrainOverride, parseBrainOverride, attachmentUpgradeReason, buildAgentCard, flowForChannelKind, planLabel, readAnswers, taskBranch, TaskSchema, threadModeOf, threadTitle, type ActorRef, type Beat, type BeatStatus, type NMEvent, type Run, type RunSettleState, type Task, type TaskKind, type TaskState, type ThreadMode } from '@neuramesh/shared';
import { DomainError } from '../errors';
import { deleteScheduleMem, markScheduleResultMem, setScheduleCursorMem, setScheduleStatusMem } from './release-routine';
import { MemAnnounceStore } from './announce';   import { MemFilmStore } from './films';
import { pickHumanWord, settleMemoryThread } from './thread-settle';
import type { LifecycleRow } from '../lifecycle';
import { normalizeTaskTitle } from './types';
import type { MutationResult, ArtifactRow, AttachmentInput, ScheduleInput, NMMessage, DecisionSeed, DecisionRow, PolicyRow, PolicyInput, DesktopAuthResult, RunInput, WhiteboardRow, WhiteboardMeta, WhiteboardCreate, WhiteboardLwwPatch, WhiteboardUpdate } from './types';
import type { Store } from './contract';   import type { VideoMeta } from './films';

export class MemoryStore implements Store {
  readonly announcements = new MemAnnounceStore();   readonly films = new MemFilmStore();
  // readable in tests like `threads` — the memory store IS the test double
  tasks = new Map<string, Task>();
  private events: NMEvent[] = [];
  private artifacts: ArtifactRow[] = [];
  private queues = new Map<string, Promise<unknown>>();
  private counters = new Map<string, number>();
  repos: Array<{ id: string; workspace: string; provider: string; orgName: string; name: string; defaultBranch: string; cloneUrl: string | null; localPath: string | null }> = [];

  async nextTaskNumber(workspace: string): Promise<number> {
    const next = (this.counters.get(workspace) ?? 1000) + 1;
    this.counters.set(workspace, next);
    return next;
  }

  async createTask(task: Task, event: NMEvent): Promise<Task> {
    this.tasks.set(task.id, task);
    this.events.push(event);
    return task;
  }

  async recentDuplicateTask(workspace: string, channel: string, normTitle: string, sinceIso: string | null): Promise<{ number: number; title: string } | null> {
    let hit: Task | null = null;
    for (const t of this.tasks.values()) {
      if (t.workspace !== workspace || t.channel !== channel) continue;
      if (t.state === 'backlog' || t.state === 'accepted' || t.state === 'closed') continue;
      if ((sinceIso && t.createdAt < sinceIso) || normalizeTaskTitle(t.title) !== normTitle) continue;
      if (!hit || t.createdAt > hit.createdAt) hit = t;
    }
    return hit ? { number: hit.number, title: hit.title } : null;
  }

  async pendingSubtasks(taskId: string): Promise<number> {
    return [...this.tasks.values()].filter((t) => t.parentTaskId === taskId && t.state !== 'done' && t.state !== 'closed').length;
  }

  async subtaskCount(taskId: string): Promise<number> {
    return [...this.tasks.values()].filter((t) => t.parentTaskId === taskId && t.state !== 'closed').length;
  }

  async getTaskByNumber(workspace: string, channel: string, number: number): Promise<{ id: string; number: number; state: TaskState } | null> {
    const t = [...this.tasks.values()].find((x) => x.workspace === workspace && x.channel === channel && x.number === number);
    return t ? { id: t.id, number: t.number, state: t.state } : null;
  }

  async shipGate(taskId: string): Promise<boolean> {
    const t = this.tasks.get(taskId);
    if (!t) throw new DomainError('NOT_FOUND', `task ${taskId} not found`);
    // MemoryStore tasks carry the project SLUG; default ON when the project row
    // is untracked or predates the flag — only an explicit false disarms.
    const p = this.projects.find((x) => x.workspace === t.workspace && x.slug === t.project);
    return ((p as { ship_gate?: boolean } | undefined)?.ship_gate) ?? true;
  }

  async getTask(id: string): Promise<Task | null> {
    return this.tasks.get(id) ?? null;
  }

  async mutate(id: string, fn: (task: Task) => Promise<MutationResult>): Promise<MutationResult> {
    const prev = this.queues.get(id) ?? Promise.resolve();
    const run = prev.then(async () => {
      const current = this.tasks.get(id);
      if (!current) throw new DomainError('NOT_FOUND', `task ${id} not found`);
      const out = await fn(structuredClone(current));
      this.tasks.set(id, out.task);
      this.events.push(...out.events);
      for (const a of out.artifacts ?? []) {
        this.artifacts.push({
          id: crypto.randomUUID(),
          // a finishing subtask's deliverables attach to the PARENT (docs/24)
          taskId: out.artifactTaskId ?? id,
          kind: a.kind,
          name: a.name,
          content: a.content ?? null,
          createdAt: new Date().toISOString(),
        });
      }
      if (out.promoteLatestDesignRound) {
        const rounds = this.artifacts
          .filter((a) => a.taskId === id && a.kind === 'design')
          .map((a) => ({ a, r: Number(/^design-mockup-v(\d+)-/.exec(a.name)?.[1] ?? 0) }));
        const latest = Math.max(0, ...rounds.map((x) => x.r));
        for (const { a, r } of rounds) if (r === latest) a.promoted = true;
      }
      if (out.promoteLatestShipRound) {
        const rounds = this.artifacts
          .filter((a) => a.taskId === id && a.kind === 'ship')
          .map((a) => ({ a, r: Number(/^ship-plan-v(\d+)\.md$/.exec(a.name)?.[1] ?? 0) }));
        const latest = Math.max(0, ...rounds.map((x) => x.r));
        for (const { a, r } of rounds) if (r === latest) a.promoted = true;
      }
      if (out.dismissOpenDecisions) {
        const at = new Date().toISOString();
        for (const d of this.decisionRows) {
          if (d.taskId === id && d.status === 'open') {
            d.status = 'dismissed';
            d.answeredAt = at;
          }
        }
      }
      return out;
    });
    this.queues.set(
      id,
      run.catch(() => undefined),
    );
    return run;
  }

  async listEvents(target: string): Promise<NMEvent[]> {
    return this.events.filter((e) => e.target === target);
  }

  async listArtifacts(taskId: string): Promise<ArtifactRow[]> {
    return this.artifacts.filter((a) => a.taskId === taskId);
  }

  private beats: Beat[] = [];
  async declareBeats(task: Task, role: string, items: string[]): Promise<{ runId: string }> {
    const runId = crypto.randomUUID();
    const now = new Date().toISOString();
    items.forEach((title, seq) => {
      this.beats.push({ id: crypto.randomUUID(), workspace: task.workspace, taskId: task.id, runId, phase: task.state, role, seq, title, status: 'pending', startedAt: null, doneAt: null, createdAt: now, updatedAt: now });
    });
    return { runId };
  }
  async advanceBeat(taskId: string, seq: number, status: BeatStatus): Promise<void> {
    const forTask = this.beats.filter((b) => b.taskId === taskId);
    const latestRun = forTask[forTask.length - 1]?.runId; // insertion order — the most recent declare
    const beat = latestRun ? this.beats.find((b) => b.runId === latestRun && b.seq === seq) : undefined;
    if (!beat) return;
    const now = new Date().toISOString();
    beat.status = status;
    beat.updatedAt = now;
    if (status === 'active' && !beat.startedAt) beat.startedAt = now;
    if (status === 'done') beat.doneAt = now;
  }
  async listBeats(taskId: string): Promise<Beat[]> {
    return this.beats.filter((b) => b.taskId === taskId);
  }
  async settleBeats(taskId: string): Promise<void> {
    const now = new Date().toISOString();
    for (const b of this.beats) {
      if (b.taskId === taskId && b.status === 'active') { b.status = 'done'; b.doneAt = b.doneAt ?? now; b.updatedAt = now; }
    }
  }

  private runRows: Array<Run & { triggerMessageId?: string | null }> = [];
  async openRun(input: RunInput & { triggerMessageId?: string | null; machineId?: string | null }): Promise<{ id: string; won: boolean }> {
    const id = input.id ?? crypto.randomUUID();
    // the wake lease (0114), in miniature: one run per (agent, trigger). The pg path enforces it
    // with a partial unique index; here it is a scan, which is all the FSM unit tests need.
    if (input.triggerMessageId) {
      const held = this.runRows.find((r) => r.agentId === input.agentId && r.triggerMessageId === input.triggerMessageId);
      if (held) return { id: held.id, won: held.id === id };
    }
    const existing = this.runRows.find((r) => r.id === id);
    if (existing) return { id, won: true }; // idempotent: a retried open must not fork the row
    const now = new Date().toISOString();
    this.runRows.push({
      id, workspace: input.workspace, channelId: input.channelId, threadId: input.threadId ?? null,
      taskId: input.taskId ?? null, agentId: input.agentId, parentRunId: input.parentRunId ?? null,
      kind: input.kind, title: input.title, state: 'running', step: input.step ?? null, seat: input.seat ?? null,
      done: 0, total: input.total ?? 0, summary: null, startedAt: now, endedAt: null, updatedAt: now,
      triggerMessageId: input.triggerMessageId ?? null,
    });
    return { id, won: true };
  }
  async getRun(id: string): Promise<Run | null> {
    return this.runRows.find((r) => r.id === id) ?? null;
  }
  async stepRun(id: string, patch: { step?: string; done?: number; total?: number }): Promise<void> {
    const run = this.runRows.find((r) => r.id === id);
    if (!run) return;
    if (patch.step !== undefined) run.step = patch.step;
    if (patch.done !== undefined) run.done = patch.done;
    if (patch.total !== undefined) run.total = patch.total;
    run.updatedAt = new Date().toISOString();
  }
  async settleRun(id: string, state: RunSettleState, summary: string | null): Promise<void> {
    const run = this.runRows.find((r) => r.id === id);
    if (!run || run.state !== 'running') return; // first settle wins — never re-close history
    const now = new Date().toISOString();
    run.state = state;
    run.summary = summary;
    run.endedAt = now;
    run.updatedAt = now;
    // a parent that finishes strands its legs: settle them with it, or the card keeps
    // pulsing rows under a closed head (the eternal-spinner bug, one level down)
    for (const leg of this.runRows) {
      if (leg.parentRunId === id && leg.state === 'running') {
        leg.state = state === 'done' ? 'done' : 'stopped';
        leg.endedAt = now;
        leg.updatedAt = now;
      }
    }
  }
  async listOpenRuns(workspaceId: string): Promise<Run[]> {
    return this.runRows.filter((r) => r.workspace === workspaceId && r.state === 'running');
  }

  async createAttachment(input: AttachmentInput, limits: { maxPerMessage: number; maxBytes: number }): Promise<{ id: string }> {
    if (this.artifacts.some((a) => a.id === input.id)) return { id: input.id }; // idempotent retry
    if ((input.sizeBytes ?? 0) > limits.maxBytes) throw new DomainError('PLAN_LIMIT', attachmentUpgradeReason('size'));
    if (this.artifacts.filter((a) => a.messageId === input.messageId).length >= limits.maxPerMessage) {
      throw new DomainError('PLAN_LIMIT', attachmentUpgradeReason('count'));
    }
    this.artifacts.push({
      id: input.id,
      taskId: input.taskId ?? '',
      kind: input.kind, channel: input.channel, mime: input.mime ?? null,
      name: input.name,
      content: input.inlineContent,
      createdAt: new Date().toISOString(),
      messageId: input.messageId,
    });
    return { id: input.id };
  }
  async libraryImage(channelId: string, name: string): Promise<{ name: string; mime: string | null; content: string } | null> { const a = [...this.artifacts].reverse().find((x) => x.channel === channelId && x.name.toLowerCase() === name.toLowerCase() && (x.content ?? '').startsWith('data:image/')); return a ? { name: a.name, mime: a.mime ?? null, content: a.content! } : null; }

  async promoteArtifact(artifactId: string, _promotedByAgent: string | null, makeEvent: (workspace: string) => NMEvent): Promise<{ workspace: string }> {
    const art = this.artifacts.find((a) => a.id === artifactId);
    if (!art) throw new DomainError('NOT_FOUND', `artifact ${artifactId} not found`);
    const workspace = this.tasks.get(art.taskId)?.workspace ?? 'unknown';
    this.events.push(makeEvent(workspace));
    return { workspace };
  }

  async artifactById(artifactId: string): Promise<{ id: string; kind: string; name: string; taskId: string | null } | null> {
    const a = this.artifacts.find((x) => x.id === artifactId);
    return a ? { id: a.id, kind: a.kind, name: a.name, taskId: a.taskId ?? null } : null;
  }

  async deleteArtifact(artifactId: string, makeEvent: (workspace: string) => NMEvent): Promise<{ workspace: string }> {
    const i = this.artifacts.findIndex((a) => a.id === artifactId);
    if (i < 0) throw new DomainError('NOT_FOUND', `artifact ${artifactId} not found`);
    const workspace = this.tasks.get(this.artifacts[i]!.taskId)?.workspace ?? 'unknown';
    this.artifacts.splice(i, 1);
    this.events.push(makeEvent(workspace));
    return { workspace };
  }

  async channelMemory(_workspace: string, channel: string) {
    const facts = this.facts
      .filter((f) => f.channel === channel)
      .map((f) => ({
        id: f.id,
        content: f.content,
        kind: f.kind,
        taskNumber: f.taskId ? this.tasks.get(f.taskId)?.number ?? null : null,
        validFrom: new Date(0).toISOString(),
        validUntil: f.validUntil,
        supersededBy: f.supersededBy,
      }));
    return { block: null, facts };
  }

  async recall(
    workspace: string,
    channel: string | null,
    query: string,
    k: number,
  ): Promise<Array<{ id: string; kind: 'fact' | 'message'; body: string; channel: string; createdAt: string; score: number }>> {
    // naive lexical rank — the memory store backs FSM unit tests only
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    return this.messages
      .filter((m) => m.workspace === workspace && (!channel || m.channel === channel))
      .map((m) => ({ m, hits: terms.filter((t) => m.body.toLowerCase().includes(t)).length }))
      .filter((x) => x.hits > 0)
      .sort((a, b) => b.hits - a.hits)
      .slice(0, k)
      .map(({ m, hits }) => ({ id: m.id, kind: 'message' as const, body: m.body, channel: m.channel, createdAt: m.createdAt, score: hits }));
  }

  private facts: Array<{ id: string; workspace: string; channel: string; content: string; kind: string; taskId: string | null; validUntil: string | null; supersededBy: string | null }> = [];

  async upsertFact(
    input: { workspace: string; channel: string; content: string; basisCount: number; kind?: 'fact' | 'lesson'; taskId?: string | null },
    makeEvent: (decision: string) => NMEvent,
  ): Promise<{ decision: 'add' | 'update' | 'noop'; factId: string }> {
    const kind = input.kind ?? 'fact';
    const valid = this.facts.filter((f) => f.channel === input.channel && f.kind === kind && !f.validUntil);
    const exact = valid.find((f) => f.content === input.content);
    if (exact) return { decision: 'noop', factId: exact.id };
    const words = new Set(input.content.toLowerCase().split(/\s+/));
    const near = valid.find((f) => {
      const fw = f.content.toLowerCase().split(/\s+/);
      return fw.filter((w) => words.has(w)).length / Math.max(fw.length, 1) > 0.6;
    });
    const id = crypto.randomUUID();
    this.facts.push({ id, workspace: input.workspace, channel: input.channel, content: input.content, kind, taskId: input.taskId ?? null, validUntil: null, supersededBy: null });
    if (near) {
      near.validUntil = new Date().toISOString();
      near.supersededBy = id;
    }
    this.events.push(makeEvent(near ? 'update' : 'add'));
    return { decision: near ? 'update' : 'add', factId: id };
  }

  async retireFact(factId: string, supersededBy: string | null, makeEvent: (workspace: string) => NMEvent): Promise<{ id: string; retired: boolean }> {
    const fact = this.facts.find((f) => f.id === factId);
    if (!fact) throw new DomainError('NOT_FOUND', `fact ${factId} not found`);
    if (supersededBy && !this.facts.some((f) => f.id === supersededBy)) throw new DomainError('NOT_FOUND', `fact ${supersededBy} not found`);
    if (fact.validUntil) return { id: factId, retired: false };
    fact.validUntil = new Date().toISOString();
    if (supersededBy) fact.supersededBy = supersededBy;
    this.events.push(makeEvent(fact.workspace));
    return { id: factId, retired: true };
  }

  private blocks = new Map<string, { id: string; content: string; basisCount: number }>();

  async refreshMemoryBlock(
    input: { workspace: string; channel: string; kind: string; content: string; basisCount: number },
    event: NMEvent,
  ): Promise<{ id: string }> {
    const key = `${input.channel}:${input.kind}`;
    const existing = this.blocks.get(key);
    const id = existing?.id ?? crypto.randomUUID();
    this.blocks.set(key, { id, content: input.content, basisCount: input.basisCount });
    this.events.push(event);
    return { id };
  }

  private workspaces: Array<{ id: string; name: string; slug: string; createdBy: string; autoFailover: boolean; activeModelPack: string; commRules?: unknown; videoTier?: string | null }> = [];
  private plans = new Map<string, string>(); // workspace id → plan ('free' default); set by setWorkspacePlan (Stripe webhook / tests)

  async createWorkspace(input: { name: string; slug: string; createdBy: string }, event: NMEvent): Promise<{ workspaceId: string; channelId: string }> {
    if (this.workspaces.some((w) => w.slug === input.slug)) throw new DomainError('CONFLICT', `workspace slug ${input.slug} is taken`);
    const workspaceId = crypto.randomUUID();
    this.workspaces.push({ id: workspaceId, ...input, autoFailover: false, activeModelPack: 'custom' });
    this.addMember(workspaceId, input.createdBy);
    this.events.push(event);
    return { workspaceId, channelId: crypto.randomUUID() };
  }

  async listWorkspaces(userId: string): Promise<Array<{ id: string; name: string; slug: string; role: string; memberCount: number; autoFailover: boolean; activeModelPack: string; commRules: unknown; plan: string; seats: number; subscriptionStatus: string | null; currentPeriodEnd: string | null; primaryMachineId: string | null }>> {
    return this.workspaces
      .filter((w) => w.createdBy === userId)
      .map((w) => ({ id: w.id, name: w.name, slug: w.slug, role: 'owner', memberCount: 1, autoFailover: w.autoFailover, activeModelPack: w.activeModelPack, commRules: w.commRules ?? null, plan: this.plans.get(w.id) ?? 'free', seats: 1, subscriptionStatus: null, currentPeriodEnd: null, primaryMachineId: null }));
  }

  async updateWorkspace(workspaceId: string, patch: { autoFailover?: boolean; activeModelPack?: string; commRules?: { ste100?: boolean; noEmdash?: boolean; custom?: string[] }; videoTier?: string | null }, makeEvent: (workspace: string) => NMEvent): Promise<{ id: string }> {
    const w = this.workspaces.find((x) => x.id === workspaceId);
    if (!w) throw new DomainError('NOT_FOUND', 'workspace not found');
    if (patch.autoFailover !== undefined) w.autoFailover = patch.autoFailover;
    if (patch.activeModelPack !== undefined) w.activeModelPack = patch.activeModelPack;
    if (patch.commRules !== undefined) w.commRules = patch.commRules;   if (patch.videoTier !== undefined) w.videoTier = patch.videoTier;
    this.events.push(makeEvent(workspaceId));
    return { id: workspaceId };
  }

  async getCommRules(workspace: string): Promise<unknown> { return this.workspaces.find((x) => x.id === workspace)?.commRules ?? null; }
  async getVideoTier(workspace: string): Promise<string | null> { return this.workspaces.find((x) => x.id === workspace)?.videoTier ?? null; }

  private modelPacks: Array<{ id: string; workspaceId: string; name: string; roles: Record<string, string>; updatedAt: string }> = [];

  async listModelPacks(workspace: string): Promise<Array<{ id: string; name: string; roles: Record<string, string>; updatedAt: string }>> {
    return this.modelPacks.filter((p) => p.workspaceId === workspace).map(({ id, name, roles, updatedAt }) => ({ id, name, roles, updatedAt }));
  }

  async saveModelPack(input: { workspace: string; packId?: string; name: string; roles: Record<string, string>; createdBy: string }, makeEvent: (workspace: string) => NMEvent): Promise<{ id: string }> {
    const dup = this.modelPacks.find((p) => p.workspaceId === input.workspace && p.name.toLowerCase() === input.name.toLowerCase() && p.id !== input.packId);
    if (dup) throw new DomainError('CONFLICT', `a brain named "${input.name}" already exists`);
    if (input.packId) {
      const p = this.modelPacks.find((x) => x.workspaceId === input.workspace && x.id === input.packId);
      if (!p) throw new DomainError('NOT_FOUND', 'custom brain not found');
      p.name = input.name; p.roles = input.roles; p.updatedAt = new Date().toISOString();
      this.events.push(makeEvent(input.workspace));
      return { id: p.id };
    }
    const id = `custom:${crypto.randomUUID()}`;
    this.modelPacks.push({ id, workspaceId: input.workspace, name: input.name, roles: input.roles, updatedAt: new Date().toISOString() });
    this.events.push(makeEvent(input.workspace));
    return { id };
  }

  async deleteModelPack(workspace: string, packId: string, makeEvent: (workspace: string) => NMEvent): Promise<{ id: string }> {
    const idx = this.modelPacks.findIndex((p) => p.workspaceId === workspace && p.id === packId);
    if (idx < 0) throw new DomainError('NOT_FOUND', 'custom brain not found');
    this.modelPacks.splice(idx, 1);
    const w = this.workspaces.find((x) => x.id === workspace);
    if (w && w.activeModelPack === packId) w.activeModelPack = 'custom'; // never leave a dangling active id
    this.events.push(makeEvent(workspace));
    return { id: packId };
  }

  async workspacePlan(workspace: string): Promise<string> {
    return this.plans.get(workspace) ?? 'free';
  }

  async activeProjectCount(workspace: string): Promise<number> {
    return this.projects.filter((p) => p.workspace === workspace && p.status === 'active').length;
  }

  async setWorkspacePlan(workspace: string, patch: { plan?: string; seats?: number; subscriptionStatus?: string | null; stripeCustomerId?: string | null; stripeSubscriptionId?: string | null; currentPeriodEnd?: string | null }): Promise<void> {
    if (patch.plan !== undefined) this.plans.set(workspace, patch.plan); // memory store backs unit tests; only plan matters for gating
  }

  async workspaceForBilling(_workspace: string): Promise<{ stripeCustomerId: string | null; memberCount: number } | null> {
    return { stripeCustomerId: null, memberCount: 1 }; // billing endpoints need Stripe; not exercised by the memory-backed unit tests
  }

  async syncWorkspaceAgents(workspace: string, makeEvent: (workspace: string) => NMEvent): Promise<{ registered: number }> {
    this.events.push(makeEvent(workspace));
    return { registered: 0 }; // memory store doesn't model agent_channels remit; pg path is the real one
  }

  async deleteWorkspace(workspaceId: string, requestedBy: string): Promise<void> {
    const w = this.workspaces.find((x) => x.id === workspaceId);
    if (!w) throw new DomainError('NOT_FOUND', 'workspace not found');
    if (w.createdBy !== requestedBy) throw new DomainError('NOT_PERMITTED', 'only the owner deletes a workspace');
    this.workspaces = this.workspaces.filter((x) => x.id !== workspaceId);
  }

  async deleteAccount(userId: string): Promise<void> {
    if (this.workspaces.some((w) => w.createdBy === userId)) {
      throw new DomainError('CONFLICT', 'leave or delete your workspaces first');
    }
    this.clerkUsers.delete([...this.clerkUsers].find(([, id]) => id === userId)?.[0] ?? '');
  }

  private clerkUsers = new Map<string, string>(); // clerkId -> internal uuid

  async resolveClerkUser(clerkId: string, email: string | null): Promise<{ id: string; created: boolean }> {
    const existing = this.clerkUsers.get(clerkId);
    const id = existing ?? crypto.randomUUID();
    if (!existing) this.clerkUsers.set(clerkId, id);
    if (email) this.userEmails.set(id, email);
    return { id, created: !existing };
  }

  async userIdForClerkId(clerkId: string): Promise<string | null> { return this.clerkUsers.get(clerkId) ?? null; }

  async userIdentity(userId: string): Promise<{ clerkUserId: string | null; email: string | null } | null> {
    return { clerkUserId: [...this.clerkUsers].find(([, id]) => id === userId)?.[0] ?? null, email: this.userEmails.get(userId) ?? null };
  }

  // the local stack's one human (0138): its bearer hash, keyed by user so a re-seed ROTATES it
  private localTokenHashes = new Map<string, string>();

  async seedLocalUser(input: { clerkUserId: string; email: string; tokenHash: string }): Promise<{ id: string }> {
    const { id } = await this.resolveClerkUser(input.clerkUserId, input.email);
    this.localTokenHashes.set(id, input.tokenHash);
    return { id };
  }

  async userIdForLocalTokenHash(hash: string): Promise<string | null> { return [...this.localTokenHashes].find(([, h]) => h === hash)?.[0] ?? null; }

  /** memory-store only: what resolveClerkUser was handed, so accept_invite has an address to
   *  match in the no-Clerk (test/dev) path. */
  private userEmails = new Map<string, string>();

  async offerTask(
    taskId: string,
    agentName: string,
    repo: { id: string; baseRef: string } | null,
    checklist: string[] | null,
    dod: string | null,
    kind: TaskKind | null,
    event: (agentId: string) => NMEvent,
  ): Promise<{ offeredAgentId: string }> {
    const task = this.tasks.get(taskId);
    if (!task) throw new DomainError('NOT_FOUND', `task ${taskId} not found`);
    if (task.state !== 'todo' && task.state !== 'plan_review') throw new DomainError('ILLEGAL_TRANSITION', 'only todo or plan_review tasks can be offered');
    const agentId = await this.resolveOffer(task.workspace, task.channel, agentName);
    const boundRepo = repo ? { id: repo.id, baseRef: repo.baseRef, branch: taskBranch(task.number, task.title) } : task.repo;
    this.tasks.set(taskId, {
      ...task,
      offeredAgentId: agentId,
      repo: boundRepo,
      ...(checklist?.length ? { requirements: checklist, requirementsConfirmed: true } : {}),
      ...(dod ? { definitionOfDone: dod } : {}),
      ...(kind ? { kind } : {}),
    });
    this.events.push(event(agentId));
    return { offeredAgentId: agentId };
  }

  private members = new Map<string, string>(); // email -> userId
  private memberProfiles = new Map<string, string>(); // `${workspace}/${userId}` -> displayName

  // Invites + the email outbox, in-memory. The role gate and the seat cap live in the PG path
  // and the handler; this backs the FSM unit tests, which never exercise either.
  private invites: Array<{
    id: string; workspace: string; email: string; role: string; tokenHash: string;
    status: 'pending' | 'accepted' | 'revoked' | 'declined'; expiresAt: string; createdAt: string;
  }> = [];

  async createInvite(
    input: { workspace: string; email: string; memberRole: string; invitedBy: string },
    event: NMEvent,
  ): Promise<{ inviteId: string; token: string; workspaceName: string; inviterName: string; inviterEmail: string }> {
    const email = input.email.trim().toLowerCase();
    const token = crypto.randomUUID().replace(/-/g, '');
    const id = crypto.randomUUID();
    const existing = this.invites.find((i) => i.workspace === input.workspace && i.email === email && i.status === 'pending');
    if (existing) { existing.tokenHash = token; } else {
      this.invites.push({
        id, workspace: input.workspace, email, role: input.memberRole, tokenHash: token,
        status: 'pending', expiresAt: new Date(Date.now() + 14 * 864e5).toISOString(), createdAt: new Date().toISOString(),
      });
    }
    this.events.push(event);
    return { inviteId: existing?.id ?? id, token, workspaceName: 'workspace', inviterName: 'someone', inviterEmail: '' };
  }

  async workspaceSeatsUsed(workspace: string): Promise<number> {
    const members = this.wsMembers.get(workspace)?.size ?? 0;
    const pending = this.invites.filter((i) => i.workspace === workspace && i.status === 'pending').length;
    return members + pending;
  }

  async pendingInvitesForEmail(email: string): Promise<Array<{
    inviteId: string; workspaceId: string; workspaceName: string; role: string;
    inviterEmail: string | null; inviterName: string | null; createdAt: string; expiresAt: string;
  }>> {
    const lower = email.trim().toLowerCase();
    return this.invites.filter((i) => i.status === 'pending' && i.email === lower).map((i) => ({
      inviteId: i.id, workspaceId: i.workspace, workspaceName: 'workspace', role: i.role,
      inviterEmail: null, inviterName: null, createdAt: i.createdAt, expiresAt: i.expiresAt,
    }));
  }

  async acceptInvite(inviteId: string, userId: string, email: string): Promise<{
    workspaceId: string; workspaceName: string; role: string; inviterEmail: string | null; seatsUsed: number; plan: string;
  }> {
    const lower = email.trim().toLowerCase();
    const inv = this.invites.find((i) => i.id === inviteId && i.email === lower && i.status === 'pending');
    if (!inv) throw new DomainError('NOT_FOUND', 'that invitation is no longer open');
    inv.status = 'accepted';
    this.addMember(inv.workspace, userId);
    return {
      workspaceId: inv.workspace, workspaceName: 'workspace', role: inv.role, inviterEmail: null,
      seatsUsed: await this.workspaceSeatsUsed(inv.workspace), plan: 'free',
    };
  }

  async declineInvite(inviteId: string, email: string): Promise<boolean> {
    const lower = email.trim().toLowerCase();
    const inv = this.invites.find((i) => i.id === inviteId && i.email === lower && i.status === 'pending');
    if (!inv) return false;
    inv.status = 'declined';
    return true;
  }

  async leaveWorkspace(workspaceId: string, userId: string): Promise<void> {
    const set = this.wsMembers.get(workspaceId);
    if (!set?.has(userId)) throw new DomainError('NOT_FOUND', 'you are not a member of that workspace');
    const ws = this.workspaces.find((w) => w.id === workspaceId);
    if (ws?.createdBy === userId) {
      throw new DomainError('NOT_PERMITTED', 'you own this workspace — make someone else the owner first, or delete it if you are the last one here');
    }
    set.delete(userId);
  }

  async removeMember(workspaceId: string, targetUserId: string, requestedBy: string): Promise<void> {
    if (targetUserId === requestedBy) throw new DomainError('NOT_PERMITTED', 'use leave to remove yourself');
    const set = this.wsMembers.get(workspaceId);
    if (!set?.has(requestedBy)) throw new DomainError('NOT_FOUND', 'workspace not found');
    if (!set.has(targetUserId)) throw new DomainError('NOT_FOUND', 'they are not a member of this workspace');
    const ws = this.workspaces.find((w) => w.id === workspaceId);
    if (ws?.createdBy === targetUserId) throw new DomainError('NOT_PERMITTED', 'the owner cannot be removed');
    set.delete(targetUserId);
  }

  async pendingInvites(workspace: string): Promise<Array<{ id: string; email: string; role: string; expiresAt: string; createdAt: string }>> {
    return this.invites.filter((i) => i.workspace === workspace && i.status === 'pending')
      .map((i) => ({ id: i.id, email: i.email, role: i.role, expiresAt: i.expiresAt, createdAt: i.createdAt }));
  }

  async revokeInvite(inviteId: string, workspace: string): Promise<boolean> {
    const inv = this.invites.find((i) => i.id === inviteId && i.workspace === workspace && i.status === 'pending');
    if (!inv) return false;
    inv.status = 'revoked';
    return true;
  }

  async inviteByToken(tokenHash: string): Promise<{ id: string; workspaceId: string; workspaceName: string; email: string; role: string } | null> {
    const inv = this.invites.find((i) => i.tokenHash === tokenHash && i.status === 'pending');
    return inv ? { id: inv.id, workspaceId: inv.workspace, workspaceName: 'workspace', email: inv.email, role: inv.role } : null;
  }

  private emails = new Map<string, { id: string; toEmail: string; template: string; kind: string; userId: string | null; workspaceId: string | null; payload: unknown; status: string; scheduledAt: string }>();
  private unsubscribed = new Set<string>();

  async enqueueEmail(input: {
    workspace?: string | null; userId?: string | null; toEmail: string; template: string;
    kind: 'transactional' | 'lifecycle' | 'broadcast'; subject: string; dedupeKey: string;
    payload?: unknown; scheduledAt?: string | null;
  }): Promise<{ id: string } | null> {
    if (this.emails.has(input.dedupeKey)) return null; // the unique index, in miniature
    const id = crypto.randomUUID();
    this.emails.set(input.dedupeKey, {
      id, toEmail: input.toEmail, template: input.template, kind: input.kind,
      userId: input.userId ?? null, workspaceId: input.workspace ?? null, payload: input.payload ?? null,
      status: 'queued', scheduledAt: input.scheduledAt ?? new Date().toISOString(),
    });
    return { id };
  }

  async markEmail(id: string, patch: { status: 'sent' | 'failed' | 'skipped' }): Promise<void> {
    for (const row of this.emails.values()) if (row.id === id) row.status = patch.status;
  }

  async lifecycleCandidates(): Promise<LifecycleRow[]> { return []; } // memory store: no clock
  async emailSuppressed(userId: string): Promise<boolean> { return this.unsubscribed.has(userId); }
  async setUnsubscribed(userId: string): Promise<void> { this.unsubscribed.add(userId); }
  async markEmailBounced(): Promise<void> { /* memory store: nothing durable to suppress */ }

  messages: NMMessage[] = [];
  private decisionRows: DecisionRow[] = [];
  private policyRows: PolicyRow[] = [];

  threads: Array<{ id: string; workspace: string; channel: string; title: string; description: string; createdBy: string; taskId: string | null; rootMessageId?: string | null; mode: ThreadMode; brainOverride?: BrainOverride | null; archivedAt?: string | null; settledAt?: string | null; filedAt?: string | null; filedReason?: string | null; scheduleId?: string | null }> = [];
  async createThread(workspace: string, channelId: string, threadId: string, title: string, description: string, createdBy: string): Promise<void> {
    if (!this.threads.some((t) => t.id === threadId)) {
      this.threads.push({ id: threadId, workspace, channel: channelId, title, description, createdBy, taskId: null, rootMessageId: null, mode: 'tasks' });
    }
  }

  async getThreadMode(workspace: string, threadId: string): Promise<ThreadMode | null> {
    const t = this.threads.find((x) => x.id === threadId && x.workspace === workspace);
    return t ? threadModeOf(t.mode) : null;
  }

  // routines (0119): the automation that opened this thread — the server floor that makes a
  // routine-born task hands-off reads it (createtask.ts, 2026-08-19)
  async getThreadScheduleId(workspace: string, threadId: string): Promise<string | null> {
    const t = this.threads.find((x) => x.id === threadId && x.workspace === workspace);
    return t?.scheduleId ?? null;
  }

  async getSetupTaskId(channelId: string): Promise<string | null> {
    const t = [...this.tasks.values()].filter((x) => x.channel === channelId && (x as { kind?: string | null }).kind === 'setup')
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
    return t?.id ?? null;
  }

  async threadTaskId(workspace: string, threadId: string): Promise<string | null | undefined> {
    const t = this.threads.find((x) => x.id === threadId && x.workspace === workspace);
    if (!t) return undefined;                       // distinct from a chat thread's null
    return t.taskId ?? null;
  }

  async setThreadArchived(workspace: string, threadId: string, archived: boolean): Promise<void> {
    const t = this.threads.find((x) => x.id === threadId && x.workspace === workspace);
    if (!t) throw new DomainError('NOT_FOUND', `thread ${threadId} not found`);
    t.archivedAt = archived ? new Date().toISOString() : null;
  }

  /** 0137 — store/thread-settle.ts holds both rules; these only bind the arrays */
  async setThreadSettled(workspace: string, threadId: string, settled: boolean): Promise<void> { settleMemoryThread(this.threads, workspace, threadId, settled); }
  async latestHumanWord(taskId: string): Promise<{ id: string; createdAt: string } | null> { const t = await this.getTask(taskId); return t ? pickHumanWord(this.messages, this.threads, taskId, t.updatedAt) : null; }

  async threadFiling(workspace: string, threadId: string) {
    const t = this.threads.find((x) => x.id === threadId && x.workspace === workspace);
    if (!t) return null;
    return {
      taskId: t.taskId ?? null,
      filedAt: t.filedAt ?? null,
      channelId: t.channel,
      projectId: this.channels.find((c) => c.id === t.channel)?.projectId ?? null,
    };
  }

  async channelProject(workspace: string, channelId: string) {
    const c = this.channels.find((x) => x.id === channelId && x.workspace === workspace);
    return c ? { projectId: c.projectId ?? null, slug: c.slug } : null;
  }

  async moveThread(workspace: string, threadId: string, channelId: string, reason: string | null, stamp: boolean): Promise<void> {
    const t = this.threads.find((x) => x.id === threadId && x.workspace === workspace);
    if (!t) throw new DomainError('NOT_FOUND', `thread ${threadId} not found`);
    t.channel = channelId;
    t.filedReason = reason;
    if (stamp) t.filedAt = new Date().toISOString();
    // the thread's messages move with it — a message left in the old room would render there
    for (const m of this.messages) if (m.threadId === threadId) m.channel = channelId;
  }

  async setThreadMachine(workspace: string, threadId: string, machineId: string | null): Promise<void> {

    const t = this.threads.find((x) => x.id === threadId && x.workspace === workspace);

    if (!t) throw new DomainError('NOT_FOUND', `thread ${threadId} not found`);

    (t as unknown as { machineId?: string | null }).machineId = machineId;

  }

  async setThreadMode(workspace: string, threadId: string, mode: ThreadMode): Promise<void> {
    const t = this.threads.find((x) => x.id === threadId && x.workspace === workspace);
    if (!t) throw new DomainError('NOT_FOUND', `thread ${threadId} not found`);
    t.mode = mode;
  }

  async shareCompute(workspace: string, userId: string, member: string, on: boolean): Promise<void> {
    const ids = [...(this.wsMembers.get(workspace) ?? new Set<string>())];
    if (!ids.includes(userId)) throw new DomainError('NOT_FOUND', `not a member of ${workspace}`);
    if (!ids.includes(member)) throw new DomainError('NOT_FOUND', `member ${member} is not in this workspace`);
    const cur = this.memberCompute.get(`${workspace}/${userId}`);
    this.memberCompute.set(`${workspace}/${userId}`, {
      machine: cur?.machine ?? null, agents: cur?.agents ?? {},
      shares: applyShare(cur?.shares, ids, userId, member, on),
    });
  }

  async setMemberCompute(workspace: string, userId: string, prefs: { machine?: string | null; agents?: Record<string, string>; shares?: string[] }): Promise<void> {
    if (!this.wsMembers.get(workspace)?.has(userId)) throw new DomainError('NOT_FOUND', `not a member of ${workspace}`);
    for (const id of prefs.shares ?? []) {
      if (id !== '*' && !this.wsMembers.get(workspace)?.has(id)) throw new DomainError('NOT_FOUND', `member ${id} is not in this workspace`);
    }
    const machineIds = new Set([...this.machines.entries()].filter(([k]) => k.startsWith(`${workspace}/`)).map(([, m]) => m.id));
    for (const id of [prefs.machine, ...Object.values(prefs.agents ?? {})]) {
      if (id && !machineIds.has(id)) throw new DomainError('NOT_FOUND', `machine ${id} is not in this workspace`);
    }
    for (const id of Object.keys(prefs.agents ?? {})) {
      if (this.agentMeta.get(id)?.workspace !== workspace) throw new DomainError('NOT_FOUND', `agent ${id} is not in this workspace`);
    }
    const cur = this.memberCompute.get(`${workspace}/${userId}`);
    this.memberCompute.set(`${workspace}/${userId}`, {
      machine: prefs.machine !== undefined ? prefs.machine : cur?.machine ?? null,
      agents: prefs.agents !== undefined ? prefs.agents : cur?.agents ?? {},
      shares: prefs.shares !== undefined ? prefs.shares : cur?.shares ?? [],
    });
  }

  async setThreadBrain(workspace: string, threadId: string, override: BrainOverride | null): Promise<void> {
    const t = this.threads.find((x) => x.id === threadId && x.workspace === workspace);
    if (!t) throw new DomainError('NOT_FOUND', `thread ${threadId} not found`);
    t.brainOverride = override;
  }

  async updateThread(workspace: string, threadId: string, patch: { title?: string; description?: string }, opts?: { agentTitleOnce?: boolean }): Promise<void> {
    const t = this.threads.find((x) => x.id === threadId && x.workspace === workspace) as (typeof this.threads)[number] & { titledAt?: string | null };
    if (!t) throw new DomainError('NOT_FOUND', `thread ${threadId} not found`);
    if (patch.title !== undefined && opts?.agentTitleOnce && t.titledAt) {
      throw new DomainError('THREAD_ALREADY_TITLED', 'this conversation is already named — only the human renames it');
    }
    if (patch.title !== undefined) { t.title = patch.title; t.titledAt = new Date().toISOString(); }
    if (patch.description !== undefined) t.description = patch.description;
  }

  async linkThreadTask(workspace: string, threadId: string, taskId: string): Promise<void> {
    const t = this.threads.find((x) => x.id === threadId && x.workspace === workspace);
    if (t && t.taskId === null) t.taskId = taskId;
  }

  async postMessage(msg: NMMessage, event: NMEvent, decisions?: DecisionSeed[]): Promise<NMMessage> {
    // conversation threads: first unknown thread id births the thread (heuristic title)
    if (msg.threadId && !this.threads.some((t) => t.id === msg.threadId)) {
      // the opening message IS the root unless the client named an older one (docs/31) — see
      // the note in pgstore.postMessage: a rootless thread swallows its own opener in the feed
      // docs/34: the composer's Tasks toggle applies HERE and only here — at birth. A later
      // message carrying threadMode is ignored, because the mode is the thread's.
      // Mirrors pgstore's FK-safe coalesce: a named root is honoured only if that message really
      // exists here, otherwise the thread roots on its own opener. Postgres enforces this with a
      // foreign key and used to 500 forever when the root had been purged; this store has no FK,
      // so without the same check the two stores would disagree exactly where it mattered.
      const namedRoot = msg.rootMessageId && this.messages.some((m) => m.id === msg.rootMessageId) ? msg.rootMessageId : null;
      this.threads.push({ id: msg.threadId, workspace: msg.workspace, channel: msg.channel, title: threadTitle(msg.body), description: '', createdBy: `${msg.author.kind}:${msg.author.id}`, taskId: null, rootMessageId: namedRoot ?? msg.id, mode: threadModeOf(msg.threadMode), brainOverride: parseBrainOverride(msg.brainOverride), scheduleId: msg.scheduleId ?? null });
    }
    // one reply per (agent, trigger) — mirrors 0060's partial unique index
    if (msg.replyTo) {
      const dup = this.messages.some((m) => m.author.id === msg.author.id && m.replyTo === msg.replyTo);
      if (dup) throw new DomainError('CONFLICT', 'this agent already replied to that message');
    }
    // duplicate id = a retried delivery (mirrors the pgstore messages_pkey ack): the
    // identical logical message is acked with the row that already landed — no second
    // event, no second decisions; a different message under the same id stays CONFLICT.
    const prior = this.messages.find((m) => m.id === msg.id);
    if (prior) {
      const sameDelivery =
        prior.workspace === msg.workspace &&
        prior.author.kind === msg.author.kind &&
        prior.author.id === msg.author.id &&
        (prior.taskId ?? null) === (msg.taskId ?? null) &&
        prior.body === msg.body;
      if (!sameDelivery) throw new DomainError('CONFLICT', 'a different message with this id already exists');
      return prior;
    }
    this.messages.push(msg);
    this.events.push(event);
    for (const d of decisions ?? []) {
      // a re-asked question supersedes its older open card in the same channel/thread
      for (const prior of this.decisionRows) {
        if (prior.status === 'open' && prior.workspace === msg.workspace && prior.channel === msg.channel && prior.taskId === (msg.taskId ?? null) && prior.question === d.question) {
          prior.status = 'dismissed';
          prior.answeredAt = new Date().toISOString();
        }
      }
      this.decisionRows.push({
        id: d.id,
        workspace: msg.workspace,
        channel: msg.channel,
        taskId: msg.taskId ?? null,
        messageId: msg.id,
        asker: { kind: msg.author.kind, id: msg.author.id },
        question: d.question,
        options: d.options,
        allowOther: d.allowOther,
        status: 'open',
        answer: null,
        answeredBy: null,
        createdAt: new Date().toISOString(),
        answeredAt: null,
      });
    }
    // authoritative auto-resolve (mirrors pgstore): a human reply carrying `**question** → answer`
    // flips the matching OPEN card to answered, so the Home needs-you list (which trusts the synced
    // status) agrees with the thread's string-match floor even when the decision.answer flip never
    // landed. Idempotent — the card click flips first, so its reply finds the row already answered.
    if (msg.author.kind === 'human') {
      for (const [question, answer] of readAnswers([msg.body])) {
        for (const row of this.decisionRows) {
          if (row.status === 'open' && row.workspace === msg.workspace && row.channel === msg.channel && row.taskId === (msg.taskId ?? null) && row.question === question) {
            row.status = 'answered';
            row.answer = answer;
            row.answeredBy = { kind: msg.author.kind, id: msg.author.id };
            row.answeredAt = new Date().toISOString();
          }
        }
      }
    }
    return msg;
  }

  async answerDecision(
    id: string,
    input: { status: 'answered' | 'dismissed'; answer: string | null; by: ActorRef },
    makeEvent: (workspace: string) => NMEvent,
    resolveTaskMutation?: (decision: { taskId: string | null; question: string; options: DecisionRow['options'] }) => ((task: Task) => MutationResult) | null,
  ): Promise<{ id: string; taskId: string | null; question: string; options: DecisionRow['options'] }> {
    const row = this.decisionRows.find((d) => d.id === id);
    if (!row) throw new DomainError('NOT_FOUND', `decision ${id} not found`);
    if (row.status !== 'open') throw new DomainError('CONFLICT', `decision already ${row.status}`);
    const taskMutation = resolveTaskMutation?.({ taskId: row.taskId, question: row.question, options: row.options }) ?? null;
    let taskOut: MutationResult | null = null;
    if (taskMutation && row.taskId) {
      const task = this.tasks.get(row.taskId);
      if (!task) throw new DomainError('NOT_FOUND', `task ${row.taskId} not found`);
      // Compute every fallible part before flipping the decision. Applying both
      // records below is synchronous, so the in-memory store mirrors PG's atomic
      // decision + task-event transaction.
      taskOut = taskMutation(structuredClone(task));
    }
    row.status = input.status;
    row.answer = input.answer;
    row.answeredBy = input.by;
    row.answeredAt = new Date().toISOString();
    this.events.push(makeEvent(row.workspace));
    if (taskOut && row.taskId) {
      this.tasks.set(row.taskId, taskOut.task);
      this.events.push(...taskOut.events);
    }
    return { id, taskId: row.taskId, question: row.question, options: row.options };
  }

  async listDecisions(workspace: string): Promise<DecisionRow[]> {
    return this.decisionRows.filter((d) => d.workspace === workspace);
  }

  async setPolicy(input: PolicyInput, event: NMEvent): Promise<{ id: string }> {
    const id = input.id ?? crypto.randomUUID();
    const now = new Date().toISOString();
    const existing = this.policyRows.find((p) => p.id === id);
    if (input.id && !existing) throw new DomainError('NOT_FOUND', `policy ${input.id} not found`);
    const row: PolicyRow = {
      id, workspace: input.workspace, scope: input.scope, projectId: input.projectId ?? null,
      channelId: input.channelId ?? null, agentId: input.agentId ?? null, capability: input.capability,
      selector: input.selector, verdict: input.verdict, rationale: input.rationale ?? '', locked: input.locked ?? false,
      createdBy: input.author, createdAt: existing?.createdAt ?? now, updatedAt: now,
    };
    if (existing) Object.assign(existing, row);
    else this.policyRows.push(row);
    this.events.push(event);
    return { id };
  }
  async deletePolicy(policyId: string, event: NMEvent): Promise<{ id: string }> {
    const i = this.policyRows.findIndex((p) => p.id === policyId);
    if (i === -1) throw new DomainError('NOT_FOUND', `policy ${policyId} not found`);
    this.policyRows.splice(i, 1);
    this.events.push(event);
    return { id: policyId };
  }
  async listPolicies(workspace: string): Promise<PolicyRow[]> {
    return this.policyRows.filter((p) => p.workspace === workspace);
  }

  async pinMessage(messageId: string, pinned: boolean): Promise<{ id: string }> {
    const m = this.messages.find((x) => x.id === messageId);
    if (!m) throw new DomainError('NOT_FOUND', 'message not found');
    (m as { pinned?: boolean }).pinned = pinned;
    return { id: messageId };
  }

  async reviseCardMessage(messageId: string, body: string, actor: { kind: string; id: string }): Promise<{ id: string }> {
    const m = this.messages.find((x) => x.id === messageId);
    if (!m) throw new DomainError('NOT_FOUND', 'message not found');
    if (m.author.kind !== actor.kind || m.author.id !== actor.id) {
      throw new DomainError('NOT_PERMITTED', 'a card is revised by the agent that posted it');
    }
    m.body = body;
    return { id: messageId };
  }

  private machines = new Map<string, { id: string; lastSeenAt: string }>();

  async registerMachine(
    input: { workspace: string; name: string; platform: string; daemonVersion: string; ownerId: string; transfer?: boolean; runtimes?: string[] },
    event: NMEvent,
  ): Promise<{ id: string; inserted: boolean }> {
    const key = `${input.workspace}/${input.name}`;
    const existing = this.machines.get(key);
    // Free is single-machine: a NEW machine is refused when another already holds the workspace,
    // unless transferred. Same-machine re-register and Cloud always proceed (see PostgresStore).
    if (!existing && !input.transfer && (this.plans.get(input.workspace) ?? 'free') === 'free') {
      const other = [...this.machines.keys()].find((k) => k.startsWith(`${input.workspace}/`));
      if (other) throw new DomainError('MACHINE_LIMIT', `This workspace is already active on "${other.slice(input.workspace.length + 1)}". Transfer it to this machine (the other stops syncing) or upgrade to ${planLabel('cloud')} for unlimited machines.`);
    }
    if (existing) {
      existing.lastSeenAt = new Date().toISOString();
      return { id: existing.id, inserted: false };
    }
    const id = crypto.randomUUID();
    this.machines.set(key, { id, lastSeenAt: new Date().toISOString() });
    this.events.push(event);
    return { id, inserted: true };
  }

  async heartbeatMachine(machineId: string): Promise<void> {
    for (const m of this.machines.values()) {
      if (m.id === machineId) m.lastSeenAt = new Date().toISOString();
    }
  }

  private agents = new Map<string, string>();
  private agentMeta = new Map<string, { workspace: string; name: string; role: string }>(); // id -> meta
  private agentText = new Map<string, { description?: string; brief?: string }>(); // id -> the two strings (0110)
  private retiredAgents = new Set<string>(); // agent ids

  async registerAgent(
    input: { workspace: string; machineId: string; name: string; role: string; model: string; runtime: string; emoji?: string; description?: string; brief?: string; channels: string[] },
    event: NMEvent,
  ): Promise<{ id: string; inserted: boolean }> {
    const key = `${input.workspace}/${input.name}`;
    const existing = this.agents.get(key);
    const id = existing ?? crypto.randomUUID();
    // both strings coalesce on re-register, mirroring the pg upsert: a daemon channel re-sync
    // (or a rehire) that omits them must never blank an agent's remit
    const prev = this.agentText.get(id) ?? {};
    const description = input.description ?? prev.description;
    const brief = input.brief ?? prev.brief;
    this.agentText.set(id, { ...(description ? { description } : {}), ...(brief ? { brief } : {}) });
    this.agentCards.set(id, buildAgentCard({ agentId: id, name: input.name, role: input.role, runtime: input.runtime, model: input.model, machine: input.machineId, channels: input.channels, description }));
    this.agentMeta.set(id, { workspace: input.workspace, name: input.name, role: input.role });
    this.retiredAgents.delete(id); // re-registering the same name = rehire
    if (existing) return { id: existing, inserted: false };
    this.agents.set(key, id);
    this.events.push(event);
    return { id, inserted: true };
  }

  async updateAgent(agentId: string, patch: { model?: string; runtime?: string; name?: string; description?: string; brief?: string; modelSource?: 'pack' | 'manual' }, makeEvent: (workspace: string) => NMEvent): Promise<{ id: string }> {
    let workspace: string | undefined;
    for (const [key, id] of this.agents) { if (id === agentId) { workspace = key.split('/')[0]; break; } }
    if (!workspace) throw new DomainError('NOT_FOUND', 'agent not found');
    // the two strings are stored (and '' clears) so tests can assert the round trip
    if (patch.description !== undefined || patch.brief !== undefined) {
      const prev = this.agentText.get(agentId) ?? {};
      const description = patch.description === undefined ? prev.description : patch.description.trim() || undefined;
      const brief = patch.brief === undefined ? prev.brief : patch.brief.trim() || undefined;
      this.agentText.set(agentId, { ...(description ? { description } : {}), ...(brief ? { brief } : {}) });
      const meta = this.agentMeta.get(agentId);
      const card = this.agentCards.get(agentId) as { description?: string } | undefined;
      if (card && meta) card.description = description ?? `NeuraMesh ${meta.role} agent.`;
    }
    this.events.push(makeEvent(workspace));
    return { id: agentId };
  }

  /** the stored strings for an agent (test/read helper — pg reads them off the row) */
  agentStrings(agentId: string): { description?: string; brief?: string } {
    return this.agentText.get(agentId) ?? {};
  }

  async retireAgent(agentId: string, makeEvent: (workspace: string, name: string, role: string) => NMEvent): Promise<{ id: string; name: string; alreadyRetired: boolean }> {
    const meta = this.agentMeta.get(agentId);
    if (!meta) throw new DomainError('NOT_FOUND', 'agent not found');
    if (this.retiredAgents.has(agentId)) return { id: agentId, name: meta.name, alreadyRetired: true };
    const open = [...this.tasks.values()].filter(
      (t) => !['done', 'accepted', 'closed'].includes(t.state) && (t.assignee?.id === agentId || t.offeredAgentId === agentId),
    );
    if (open.length) {
      throw new DomainError('CONFLICT', `${meta.name} still has ${open.length} open task(s) (${open.slice(0, 5).map((t) => `#${t.number}`).join(', ')}) — reassign or cancel them first`);
    }
    this.retiredAgents.add(agentId);
    this.events.push(makeEvent(meta.workspace, meta.name, meta.role));
    return { id: agentId, name: meta.name, alreadyRetired: false };
  }

  async updateMemberProfile(workspace: string, userId: string, displayName: string): Promise<void> {
    this.memberProfiles.set(`${workspace}/${userId}`, displayName);
  }

  async resolveOffer(workspace: string, _channel: string, agentName: string): Promise<string> {
    const id = this.agents.get(`${workspace}/${agentName}`);
    if (!id) throw new DomainError('NOT_FOUND', `agent ${agentName} not found`);
    if (this.retiredAgents.has(id)) throw new DomainError('NOT_PERMITTED', `agent ${agentName} is retired — rehire it or offer to someone else`);
    return id; // memory store has no channel registry; PG enforces registration
  }

  private agentCards = new Map<string, unknown>();
  async getAgentCard(agentId: string): Promise<unknown | null> {
    // retired agents unpublish from A2A discovery (card kept for rehire)
    if (this.retiredAgents.has(agentId)) return null;
    return this.agentCards.get(agentId) ?? null;
  }

  async connectRemoteAgent(input: { workspace: string; channels: string[]; name: string; role: string; endpointUrl: string; card: unknown }, event: NMEvent): Promise<{ id: string }> {
    const key = `${input.workspace}/${input.name}`;
    const existing = this.agents.get(key);
    const id = existing ?? crypto.randomUUID();
    this.agentCards.set(id, input.card);
    this.agentMeta.set(id, { workspace: input.workspace, name: input.name, role: input.role });
    this.retiredAgents.delete(id); // reconnecting the same name = rehire
    if (!existing) { this.agents.set(key, id); this.events.push(event); }
    return { id };
  }

  async setAgentStatus(_agentId: string, _status: string): Promise<void> {}

  private skills = new Map<string, { id: string; name: string; status: string; channel: string | null; packId: string | null; enabled: boolean }>();
  private packs = new Map<string, { id: string; workspace: string; channel: string; name: string; enabled: boolean; status: string }>();
  async createSkill(input: { workspace: string; channel: string | null; name: string; description: string; scope: string; body: string; author: ActorRef; packId?: string | null; enabled?: boolean }, event: NMEvent): Promise<{ id: string }> {
    const packId = input.packId ?? null;
    // active-name uniqueness is scoped to the pack (two packs may share a name)
    const dup = [...this.skills.values()].find((s) => s.name === input.name && s.status === 'active' && s.packId === packId && s.channel === input.channel);
    if (dup) throw new DomainError('CONFLICT', `an active skill named ${input.name} already exists`);
    const id = crypto.randomUUID();
    this.skills.set(id, { id, name: input.name, status: 'active', channel: input.channel, packId, enabled: input.enabled ?? true });
    this.events.push(event);
    return { id };
  }
  async updateSkill(skillId: string, _patch: { description?: string; body?: string; scope?: string }, event: NMEvent): Promise<{ id: string }> {
    if (!this.skills.has(skillId)) throw new DomainError('NOT_FOUND', `skill ${skillId} not found`);
    this.events.push(event);
    return { id: skillId };
  }
  async deprecateSkill(skillId: string, event: NMEvent): Promise<{ id: string }> {
    const sk = this.skills.get(skillId);
    if (!sk) throw new DomainError('NOT_FOUND', `skill ${skillId} not found`);
    sk.status = 'deprecated';
    this.events.push(event);
    return { id: skillId };
  }
  async proposeSkill(input: { workspace: string; channel: string | null; name: string; description: string; scope: string; body: string; author: ActorRef }, event: NMEvent): Promise<{ id: string; updated: boolean }> {
    const draft = [...this.skills.values()].find((s) => s.name === input.name && s.status === 'draft');
    if (draft) { this.events.push(event); return { id: draft.id, updated: true }; }
    const id = crypto.randomUUID();
    this.skills.set(id, { id, name: input.name, status: 'draft', channel: input.channel, packId: null, enabled: true });
    this.events.push(event);
    return { id, updated: false };
  }
  async promoteSkill(skillId: string, makeEvent: (workspace: string) => NMEvent): Promise<{ id: string; superseded: string | null }> {
    const sk = this.skills.get(skillId);
    if (!sk) throw new DomainError('NOT_FOUND', `skill ${skillId} not found`);
    const prior = [...this.skills.values()].find((s) => s.name === sk.name && s.status === 'active' && s.packId === sk.packId && s.id !== skillId);
    if (prior) prior.status = 'deprecated';
    sk.status = 'active';
    this.events.push(makeEvent('unknown'));
    return { id: skillId, superseded: prior?.id ?? null };
  }
  async setSkillEnabled(skillId: string, enabled: boolean, event: NMEvent): Promise<{ id: string }> {
    const sk = this.skills.get(skillId);
    if (!sk) throw new DomainError('NOT_FOUND', `skill ${skillId} not found`);
    sk.enabled = enabled;
    this.events.push(event);
    return { id: skillId };
  }
  async createSkillPack(input: { workspace: string; channel: string; name: string; description: string; sourceUrl: string; sourceRef: string; origin: string; author: ActorRef }, event: NMEvent): Promise<{ id: string }> {
    const dup = [...this.packs.values()].find((p) => p.workspace === input.workspace && p.channel === input.channel && p.name === input.name);
    if (dup) throw new DomainError('CONFLICT', `a skill pack named ${input.name} already exists in this channel`);
    const id = crypto.randomUUID();
    this.packs.set(id, { id, workspace: input.workspace, channel: input.channel, name: input.name, enabled: true, status: 'importing' });
    this.events.push(event);
    return { id };
  }
  async commitSkillPack(packId: string, input: { version: string; skills: Array<{ name: string; description: string; body: string }> }, makeEvent: (workspace: string) => NMEvent): Promise<{ id: string; count: number }> {
    const pack = this.packs.get(packId);
    if (!pack) throw new DomainError('NOT_FOUND', `skill pack ${packId} not found`);
    for (const s of input.skills) {
      const dup = [...this.skills.values()].find((x) => x.name === s.name && x.status === 'active' && x.packId === packId && x.channel === pack.channel);
      if (!dup) this.skills.set(crypto.randomUUID(), { id: crypto.randomUUID(), name: s.name, status: 'active', channel: pack.channel, packId, enabled: true });
    }
    pack.status = 'ready';
    this.events.push(makeEvent(pack.workspace));
    return { id: packId, count: input.skills.length };
  }
  async updateSkillPack(packId: string, patch: { status?: string; step?: string; progress?: number; error?: string; description?: string }, event: NMEvent): Promise<{ id: string }> {
    const pack = this.packs.get(packId);
    if (!pack) throw new DomainError('NOT_FOUND', `skill pack ${packId} not found`);
    if (patch.status) pack.status = patch.status;
    this.events.push(event);
    return { id: packId };
  }
  async setSkillPackEnabled(packId: string, enabled: boolean, event: NMEvent): Promise<{ id: string }> {
    const pack = this.packs.get(packId);
    if (!pack) throw new DomainError('NOT_FOUND', `skill pack ${packId} not found`);
    pack.enabled = enabled;
    this.events.push(event);
    return { id: packId };
  }
  async removeSkillPack(packId: string, event: NMEvent): Promise<{ id: string }> {
    if (!this.packs.has(packId)) throw new DomainError('NOT_FOUND', `skill pack ${packId} not found`);
    this.packs.delete(packId);
    for (const [id, s] of this.skills) if (s.packId === packId) this.skills.delete(id);
    this.events.push(event);
    return { id: packId };
  }
  // the in-memory store isn't used for bundled-pack tests (PostgresStore is) —
  // avoid pulling the ~2MB seed module into the test path
  async seedDefaultPacks(_workspace: string, _channel: string, _event: NMEvent, _kind?: 'build' | 'marketing'): Promise<{ added: number; refreshed: number }> {
    return { added: 0, refreshed: 0 };
  }

  async linkRepo(
    input: { workspace: string; channel: string | null; project: string | null; provider: string; orgName: string; name: string; defaultBranch: string; cloneUrl: string | null; localPath: string | null },
    event: NMEvent,
  ): Promise<{ id: string; inserted: boolean }> {
    const existing = this.repos.find((r) => r.workspace === input.workspace && r.provider === input.provider && r.orgName === input.orgName && r.name === input.name);
    if (existing) {
      existing.defaultBranch = input.defaultBranch;
      existing.cloneUrl = input.cloneUrl;
      existing.localPath = input.localPath;
      return { id: existing.id, inserted: false };
    }
    const id = crypto.randomUUID();
    this.repos.push({ id, workspace: input.workspace, provider: input.provider, orgName: input.orgName, name: input.name, defaultBranch: input.defaultBranch, cloneUrl: input.cloneUrl, localPath: input.localPath });
    this.events.push(event);
    return { id, inserted: true };
  }

  // Projects: MemoryStore tracks just enough for auth/guard unit tests; the
  // seeded-default + 1:N channel-ownership behavior is gate-tested on PostgresStore.
  private projects: Array<{ id: string; workspace: string; name: string; slug: string; description: string; website?: string | null; logoUrl?: string | null; status: 'active' | 'archived'; isDefault: boolean }> = [];

  async createProject(input: { workspace: string; name: string; slug: string; description: string; website?: string; logoUrl?: string; channels: string[]; newChannels?: string[] }, event: NMEvent): Promise<{ id: string; slug: string }> {
    let slug = input.slug;
    for (let n = 2; this.projects.some((p) => p.workspace === input.workspace && p.slug === slug); n++) slug = `${input.slug}-${n}`;
    const id = crypto.randomUUID();
    this.projects.push({ id, workspace: input.workspace, name: input.name, slug, description: input.description, website: input.website || null, logoUrl: input.logoUrl || null, status: 'active', isDefault: false });
    this.events.push(event);
    return { id, slug };
  }

  async updateProject(projectId: string, patch: { name?: string; description?: string; website?: string; logoUrl?: string; autoOpenPr?: boolean; runCiBeforeMerge?: boolean; shipGate?: boolean; modelPack?: string }, makeEvent: (workspace: string) => NMEvent): Promise<{ id: string }> {
    const p = this.projects.find((x) => x.id === projectId);
    if (!p) throw new DomainError('NOT_FOUND', 'project not found');
    if (patch.name !== undefined) p.name = patch.name;
    if (patch.description !== undefined) p.description = patch.description;
    if (patch.website !== undefined) p.website = patch.website || null; // '' clears
    if (patch.logoUrl !== undefined) p.logoUrl = patch.logoUrl || null; // '' clears
    if (patch.autoOpenPr !== undefined) (p as { auto_open_pr?: boolean }).auto_open_pr = patch.autoOpenPr;
    if (patch.runCiBeforeMerge !== undefined) (p as { run_ci_before_merge?: boolean }).run_ci_before_merge = patch.runCiBeforeMerge;
    if (patch.shipGate !== undefined) (p as { ship_gate?: boolean }).ship_gate = patch.shipGate;
    if (patch.modelPack !== undefined) (p as { model_pack?: string | null }).model_pack = patch.modelPack || null; // '' clears → inherit
    this.events.push(makeEvent(p.workspace));
    return { id: projectId };
  }

  async assignChannel(_channelId: string, projectId: string, makeEvent: (workspace: string) => NMEvent): Promise<{ id: string }> {
    const p = this.projects.find((x) => x.id === projectId);
    if (!p) throw new DomainError('NOT_FOUND', 'project not found');
    this.events.push(makeEvent(p.workspace));
    return { id: _channelId };
  }

  async archiveProject(projectId: string, archived: boolean, makeEvent: (workspace: string) => NMEvent): Promise<{ id: string }> {
    const p = this.projects.find((x) => x.id === projectId);
    if (!p) throw new DomainError('NOT_FOUND', 'project not found');
    if (archived && p.isDefault) throw new DomainError('NOT_PERMITTED', 'the default project cannot be archived');
    p.status = archived ? 'archived' : 'active';
    this.events.push(makeEvent(p.workspace));
    return { id: projectId };
  }
  async deleteProject(projectId: string, _requestedBy: string, makeEvent: (workspace: string) => NMEvent): Promise<{ id: string }> {
    const p = this.projects.find((x) => x.id === projectId);
    if (!p) throw new DomainError('NOT_FOUND', 'project not found');
    if (p.isDefault) throw new DomainError('NOT_PERMITTED', 'the default project cannot be deleted');
    if (p.status !== 'archived') throw new DomainError('NOT_PERMITTED', 'archive the project before deleting it');
    this.events.push(makeEvent(p.workspace));
    this.projects = this.projects.filter((x) => x.id !== projectId);
    return { id: projectId };
  }

  private channels: Array<{ id: string; workspace: string; projectId: string; slug: string; topic: string; threadMode?: 'on' | 'off'; kind?: 'build' | 'marketing'; marketing?: { website: string | null; focus: string[]; setup_by: string; setup_at: string } }> = [];
  async createChannel(input: { workspace: string; projectId: string; slug: string; topic: string; createdByKind?: string; createdBy?: string }, event: NMEvent): Promise<{ id: string; slug: string }> {
    let slug = input.slug;
    for (let n = 2; this.channels.some((c) => c.projectId === input.projectId && c.slug === slug); n++) slug = `${input.slug}-${n}`;
    const id = crypto.randomUUID();
    this.channels.push({ id, workspace: input.workspace, projectId: input.projectId, slug, topic: input.topic });
    this.events.push(event);
    return { id, slug };
  }
  async renameChannel(channelId: string, patch: { slug?: string; topic?: string }, makeEvent: (workspace: string) => NMEvent): Promise<{ id: string; slug: string }> {
    const c = this.channels.find((x) => x.id === channelId);
    if (!c) throw new DomainError('NOT_FOUND', 'channel not found');
    if (patch.slug !== undefined) {
      if (this.channels.some((x) => x.projectId === c.projectId && x.slug === patch.slug && x.id !== channelId)) throw new DomainError('INVALID_INPUT', 'a room with that name already exists in this project');
      c.slug = patch.slug;
    }
    if (patch.topic !== undefined) c.topic = patch.topic;
    this.events.push(makeEvent(c.workspace));
    return { id: channelId, slug: c.slug };
  }
  async setChannelThreadMode(channelId: string, mode: 'on' | 'off', makeEvent: (workspace: string) => NMEvent): Promise<{ id: string }> {
    const c = this.channels.find((x) => x.id === channelId);
    if (!c) throw new DomainError('NOT_FOUND', 'channel not found');
    c.threadMode = mode;
    this.events.push(makeEvent(c.workspace));
    return { id: channelId };
  }
  async setChannelKind(channelId: string, kind: 'build' | 'marketing', makeEvent: (workspace: string) => NMEvent): Promise<{ id: string }> {
    const c = this.channels.find((x) => x.id === channelId);
    if (!c) throw new DomainError('NOT_FOUND', 'channel not found');
    c.kind = kind;
    if (kind === 'marketing') await this.ensureSetupTaskMem(c);
    this.events.push(makeEvent(c.workspace));
    return { id: channelId };
  }
  /** memstore mirror of pgstore.ensureSetupTask — same suppression rules, same one-per-channel */
  private async ensureSetupTaskMem(c: { id: string; slug: string; workspace: string; kind?: string; marketing?: unknown }): Promise<boolean> {
    const flow = flowForChannelKind(c.kind ?? null);
    if (!flow) return false;
    const profile = (c.marketing ?? null) as Record<string, unknown> | null;
    if (profile && Object.keys(profile).length > 0) return false;
    for (const t of this.tasks.values()) if (t.kind === 'setup' && t.channel === c.slug && t.workspace === c.workspace) return false;
    const now = new Date().toISOString();
    const task = TaskSchema.parse({
      id: crypto.randomUUID(), workspace: c.workspace, channel: c.slug, number: await this.nextTaskNumber(c.workspace),
      title: flow.title, description: 'Walk the steps below to set this room up — your answers save as you go, so you can leave and finish any time. Closing this task skips setup.',
      state: 'todo', kind: 'setup', creator: { kind: 'human', id: '00000000-0000-0000-0000-000000000001' },
      createdAt: now, updatedAt: now,
    });
    this.tasks.set(task.id, task);
    return true;
  }
  async setChannelSetupStep(channelId: string, input: { flowId: string; stepId: string; patch: Record<string, unknown> }, makeEvent: (workspace: string) => NMEvent): Promise<{ id: string; workspace: string }> {
    const c = this.channels.find((x) => x.id === channelId);
    if (!c) throw new DomainError('NOT_FOUND', 'channel not found');
    const profile = (c.marketing ?? {}) as Record<string, unknown>;
    c.marketing = { ...profile, ...input.patch, setup_progress: { flow: input.flowId, step: input.stepId } } as never;
    for (const t of this.tasks.values()) {
      if (t.kind === 'setup' && t.channel === c.slug && t.workspace === c.workspace && t.state === 'todo') this.tasks.set(t.id, { ...t, state: 'in_progress', updatedAt: new Date().toISOString() });
    }
    this.events.push(makeEvent(c.workspace));
    return { id: channelId, workspace: c.workspace };
  }
  async backfillSetupTasks(workspace: string): Promise<number> {
    let made = 0;
    for (const c of this.channels) {
      if (c.workspace !== workspace) continue;
      if (await this.ensureSetupTaskMem(c)) made += 1;
    }
    return made;
  }
  async setChannelMarketing(channelId: string, profile: { website: string | null; focus: string[]; goal?: string; bootstrap_thread_id?: string; setup_by: string; setup_at: string }, makeEvent: (workspace: string) => NMEvent): Promise<{ id: string; workspace: string }> {
    const c = this.channels.find((x) => x.id === channelId);
    if (!c) throw new DomainError('NOT_FOUND', 'channel not found');
    // merged, not replaced — mirrors pgstore (per-step writes land before completion now)
    c.marketing = { ...((c.marketing ?? {}) as Record<string, unknown>), ...profile };
    for (const t of this.tasks.values()) {
      if (t.kind === 'setup' && t.channel === c.slug && t.workspace === c.workspace && (t.state === 'todo' || t.state === 'in_progress')) {
        this.tasks.set(t.id, { ...t, state: 'done', updatedAt: new Date().toISOString() });
      }
    }
    this.events.push(makeEvent(c.workspace));
    return { id: channelId, workspace: c.workspace };
  }
  async setMarketingIntegration(channelId: string, provider: string, enabled: boolean, makeEvent: (workspace: string) => NMEvent): Promise<{ id: string }> {
    const c = this.channels.find((x) => x.id === channelId);
    if (!c) throw new DomainError('NOT_FOUND', 'channel not found');
    const profile = (c.marketing ?? {}) as Record<string, unknown>;
    c.marketing = { ...profile, mcp: { ...((profile['mcp'] as Record<string, boolean> | undefined) ?? {}), [provider]: enabled } } as never;
    this.events.push(makeEvent(c.workspace));
    return { id: channelId };
  }
  async channelWorkspace(channelId: string): Promise<{ workspace: string }> {
    const c = this.channels.find((x) => x.id === channelId);
    if (!c) throw new DomainError('NOT_FOUND', 'channel not found');
    return { workspace: c.workspace };
  }
  private schedules: Array<{ id: string; workspace: string; channelId: string; title: string; prompt: string; cadence: string; atTime: string; tz: string; weekday: number | null; nextRunAt: string | null; runCount: number; status: string; payload: Record<string, unknown>; lastError?: string | null }> = [];
  async createSchedule(input: ScheduleInput, makeEvent: (workspace: string) => NMEvent): Promise<{ id: string }> {
    const c = this.channels.find((x) => x.id === input.channelId);
    if (!c) throw new DomainError('NOT_FOUND', 'channel not found');
    const id = crypto.randomUUID();
    this.schedules.push({ id, workspace: c.workspace, channelId: input.channelId, title: input.title, prompt: input.prompt, cadence: input.cadence, atTime: input.atTime, tz: input.tz, weekday: input.weekday, nextRunAt: input.nextRunAt, runCount: 0, status: 'active', payload: { prompt: input.prompt, ...(input.payloadExtra ?? {}) } });
    this.events.push(makeEvent(c.workspace));
    return { id };
  }
  async setScheduleStatus(scheduleId: string, status: 'active' | 'paused', makeEvent: (workspace: string) => NMEvent): Promise<{ id: string }> {
    this.events.push(makeEvent(setScheduleStatusMem(this.schedules, scheduleId, status).workspace));
    return { id: scheduleId };
  }
  async updateSchedule(scheduleId: string, patch: { title: string; prompt: string; cadence: string; atTime: string; tz: string; weekday: number | null; nextRunAt: string }, makeEvent: (workspace: string) => NMEvent): Promise<{ id: string }> {
    const s = this.schedules.find((x) => x.id === scheduleId);
    if (!s) throw new DomainError('NOT_FOUND', 'schedule not found');
    Object.assign(s, { title: patch.title, prompt: patch.prompt, cadence: patch.cadence, atTime: patch.atTime, tz: patch.tz, weekday: patch.weekday, nextRunAt: patch.nextRunAt, payload: { ...s.payload, prompt: patch.prompt } });
    this.events.push(makeEvent(s.workspace));
    return { id: scheduleId };
  }
  async deleteSchedule(scheduleId: string, makeEvent: (workspace: string) => NMEvent): Promise<{ id: string }> {
    const { workspace, rest } = deleteScheduleMem(this.schedules, scheduleId);
    this.events.push(makeEvent(workspace));
    this.schedules = rest as typeof this.schedules;
    return { id: scheduleId };
  }
  private contentItems: Array<{ id: string; workspace: string; channelId: string; taskId: string | null; threadId: string | null; platform: string; body: string; scheduleId: string | null; status: string; scheduledAt: string | null; approvedBy: string | null; mediaUrl: string | null; mediaId?: string | null; brief?: string | null; script?: string | null; videoPending?: boolean; videoMeta?: VideoMeta | null; videoErrorCode?: 'NO_CREDITS' | 'UNAVAILABLE' | null; frame?: string | null; lastError?: string | null }> = [];
  async createContentItem(input: { channelId: string; taskId?: string | null; threadId?: string | null; platform: string; body: string; scheduleId: string | null; slotAt?: string | null; mediaUrl?: string | null; imageBrief?: string | null; script?: string | null; frame?: string | null; thumb?: string | null; imageError?: string | null; createdByKind: string; createdBy: string }, makeEvent: (workspace: string) => NMEvent): Promise<{ id: string }> {
    const c = this.channels.find((x) => x.id === input.channelId);
    if (!c) throw new DomainError('NOT_FOUND', 'channel not found');
    const id = crypto.randomUUID();
    this.contentItems.push({ id, workspace: c.workspace, channelId: input.channelId, taskId: input.taskId ?? null, threadId: input.threadId ?? null, platform: input.platform, body: input.body, scheduleId: input.scheduleId, status: 'draft', scheduledAt: input.slotAt ?? null, approvedBy: null, mediaUrl: input.mediaUrl ?? null, brief: input.imageBrief ?? null, script: input.script ?? null, frame: input.frame ?? null });
    this.events.push(makeEvent(c.workspace));
    return { id };
  }
  async setContentStatus(itemId: string, patch: { status: 'draft' | 'scheduled'; scheduledAt: string | null; approvedBy: string | null; keepSlot?: boolean }, makeEvent: (workspace: string) => NMEvent): Promise<{ id: string }> {
    const it = this.contentItems.find((x) => x.id === itemId);
    if (!it) throw new DomainError('NOT_FOUND', 'content item not found');
    it.status = patch.status;
    // mirror pg: approve with keepSlot holds a FUTURE draft-ahead slot; unschedule nulls
    it.scheduledAt = patch.status === 'draft'
      ? null
      : (patch.keepSlot && it.scheduledAt && new Date(it.scheduledAt).getTime() > Date.now() ? it.scheduledAt : patch.scheduledAt);
    it.approvedBy = patch.approvedBy;
    // mirror pg: a re-queued failure starts clean, or the card reads "failed: …" while scheduled
    if (patch.status === 'scheduled') it.lastError = null;
    this.events.push(makeEvent(it.workspace));
    return { id: itemId };
  }
  async updateContentBody(itemId: string, body: string, mediaUrl: string | null | undefined, makeEvent: (workspace: string) => NMEvent): Promise<{ id: string }> {
    const it = this.contentItems.find((x) => x.id === itemId && (x.status === 'draft' || x.status === 'scheduled'));
    if (!it) throw new DomainError('NOT_FOUND', 'content item not found (or already published)');
    it.body = body;
    if (mediaUrl !== undefined) it.mediaUrl = mediaUrl;
    this.events.push(makeEvent(it.workspace));
    return { id: itemId };
  }
  async reviseDraft(itemId: string, patch: { body: string | null; imageBrief: string | null; script?: string | null; frame?: string | null; videoPending?: boolean; videoMeta?: VideoMeta | null; videoErrorCode?: 'NO_CREDITS' | 'UNAVAILABLE' | null; thumb: string | null; imageError?: string | null; videoError?: string | null }, makeEvent: (workspace: string) => NMEvent): Promise<{ id: string }> {
    // draft OR scheduled, never published — mirrors pg (and updateContentBody/delete)
    const it = this.contentItems.find((x) => x.id === itemId && (x.status === 'draft' || x.status === 'scheduled'));
    if (!it) throw new DomainError('NOT_FOUND', 'content item not found (already published or gone)');
    const isRevision = patch.body !== null || patch.imageBrief !== null || !!patch.script;
    if (patch.body !== null) it.body = patch.body;
    if (patch.imageBrief !== null) it.brief = patch.imageBrief;   if (patch.script) it.script = patch.script;   if (patch.frame !== undefined) { it.frame = patch.frame; it.videoMeta = null; }   if (patch.videoPending !== undefined) it.videoPending = patch.videoPending;   if (patch.videoMeta !== undefined) it.videoMeta = patch.videoMeta;   if (patch.videoErrorCode !== undefined) it.videoErrorCode = patch.videoErrorCode;
    // thumb tracked in the mem store only for parity; the card reads it from media in pg
    // rewriting the copy/brief of a SCHEDULED post unschedules it back to draft (pg parity), so the
    // changed text can't auto-publish on the old slot without a fresh human approve
    if (isRevision && it.status === 'scheduled') { it.status = 'draft'; it.scheduledAt = null; it.approvedBy = null; }
    this.events.push(makeEvent(it.workspace));
    return { id: itemId };
  }
  private contentMedia = new Map<string, { mime: string; bytes: Buffer; workspace: string }>();
  async attachContentMedia(itemId: string, mime: string, bytes: Buffer, _actor: { kind: string; id: string }, makeEvent: (workspace: string) => NMEvent): Promise<{ id: string }> {
    const it = this.contentItems.find((x) => x.id === itemId && (x.status === 'draft' || x.status === 'scheduled'));
    if (!it) throw new DomainError('NOT_FOUND', 'content item not found (or already published)');
    if (it.mediaId) this.contentMedia.delete(it.mediaId); // mirror pg: one hosted image per draft
    const id = crypto.randomUUID();
    this.contentMedia.set(id, { mime, bytes, workspace: it.workspace });
    it.mediaId = id;
    this.events.push(makeEvent(it.workspace));
    return { id };
  }
  async contentMediaBytes(mediaId: string): Promise<{ mime: string; bytes: Buffer; workspace: string } | null> {
    return this.contentMedia.get(mediaId) ?? null;
  }
  async deleteContentItem(itemId: string, makeEvent: (workspace: string) => NMEvent): Promise<{ id: string }> {
    const it = this.contentItems.find((x) => x.id === itemId && (x.status === 'draft' || x.status === 'scheduled'));
    if (!it) throw new DomainError('NOT_FOUND', 'content item not found (published items stay — they are history)');
    this.contentItems = this.contentItems.filter((x) => x.id !== itemId);
    this.events.push(makeEvent(it.workspace));
    return { id: itemId };
  }
  private channelArtifacts: Array<{ id: string; workspace: string; channelId: string; kind: string; name: string }> = [];
  async createChannelArtifact(input: { channelId: string; kind: string; name: string; inlineContent: string; mime: string | null; tags?: string[]; createdByKind: string; createdBy: string }, makeEvent: (workspace: string) => NMEvent): Promise<{ id: string }> {
    const c = this.channels.find((x) => x.id === input.channelId);
    if (!c) throw new DomainError('NOT_FOUND', 'channel not found');
    const id = crypto.randomUUID();
    this.channelArtifacts.push({ id, workspace: c.workspace, channelId: input.channelId, kind: input.kind, name: input.name });
    this.events.push(makeEvent(c.workspace));
    return { id };
  }
  private whiteboards: WhiteboardRow[] = [];
  async createWhiteboard(input: WhiteboardCreate, makeEvent: (workspace: string) => NMEvent): Promise<{ id: string; workspace: string }> {
    const existing = input.id ? this.whiteboards.find((w) => w.id === input.id) : null;
    if (existing) return { id: existing.id, workspace: existing.workspace }; // idempotent replay — no second event
    const c = this.channels.find((x) => x.id === input.channelId);
    if (!c) throw new DomainError('NOT_FOUND', 'channel not found');
    const now = new Date().toISOString();
    const row: WhiteboardRow = {
      id: input.id ?? crypto.randomUUID(),
      workspace: c.workspace,
      channelId: input.channelId,
      threadId: input.threadId ?? null,
      taskId: input.taskId ?? null,
      title: input.title,
      scene: input.scene ?? null,
      source: input.source ?? null,
      snapshotSvg: input.snapshotSvg ?? null,
      snapshotRev: input.snapshotRev ?? 0,
      rev: input.rev ?? 1,
      archivedAt: null,
      createdByKind: input.createdByKind,
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
    };
    this.whiteboards.push(row);
    this.events.push(makeEvent(c.workspace));
    return { id: row.id, workspace: c.workspace };
  }
  async patchWhiteboardLww(input: WhiteboardLwwPatch): Promise<{ applied: boolean }> {
    const w = this.whiteboards.find((x) => x.id === input.id);
    // an unknown id is ACKed too: the create PUT ahead of this patch may still be in flight on
    // a parallel lane — the desktop replays the whole scene on the next save, nothing is lost
    if (!w || input.rev <= w.rev) return { applied: false };
    w.rev = input.rev;
    if (input.title !== undefined) w.title = input.title;
    if (input.scene !== undefined) w.scene = input.scene;
    if (input.snapshotSvg !== undefined) w.snapshotSvg = input.snapshotSvg;
    if (input.snapshotRev !== undefined) w.snapshotRev = input.snapshotRev;
    if (input.archivedAt !== undefined) w.archivedAt = input.archivedAt;
    w.updatedAt = new Date().toISOString();
    return { applied: true };
  }
  async updateWhiteboard(input: WhiteboardUpdate, makeEvent: (workspace: string) => NMEvent): Promise<{ id: string; rev: number }> {
    const w = this.whiteboards.find((x) => x.id === input.id);
    if (!w) throw new DomainError('NOT_FOUND', 'whiteboard not found');
    if (w.archivedAt) throw new DomainError('CONFLICT', 'this board is archived — un-archive it first');
    if (w.rev !== input.baseRev) throw new DomainError('WHITEBOARD_STALE', `the board moved to rev ${w.rev} — re-read it and reapply your change`);
    if (input.clearSource && !w.source) throw new DomainError('INVALID_INPUT', 'nothing to materialize — the board has no pending source');
    w.rev = input.baseRev + 1;
    if (input.title !== undefined) w.title = input.title;
    if (input.source !== undefined) w.source = input.source;
    if (input.scene !== undefined) w.scene = input.scene;
    if (input.snapshotSvg !== undefined) {
      w.snapshotSvg = input.snapshotSvg;
      w.snapshotRev = w.rev;
    }
    if (input.clearSource) w.source = null;
    w.updatedAt = new Date().toISOString();
    this.events.push(makeEvent(w.workspace));
    return { id: w.id, rev: w.rev };
  }
  async getWhiteboard(id: string): Promise<WhiteboardRow | null> {
    return this.whiteboards.find((x) => x.id === id) ?? null;
  }
  async listWhiteboards(q: { workspace?: string; channel?: string; includeArchived?: boolean; limit?: number }): Promise<WhiteboardMeta[]> {
    return this.whiteboards
      .filter((w) => (q.channel ? w.channelId === q.channel : w.workspace === q.workspace))
      .filter((w) => q.includeArchived || !w.archivedAt)
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
      .slice(0, q.limit ?? 100)
      .map(({ scene, source, snapshotSvg, ...meta }) => ({ ...meta, hasScene: !!scene, hasSource: !!source }));
  }
  private connectors: Array<{ id: string; workspace: string; channelId: string | null; projectId: string | null; provider: string; handle: string; status: string }> = [];
  private connectorSecrets = new Map<string, string>();
  async upsertConnector(input: { workspace: string; channelId: string | null; provider: string; handle: string; connectedBy: string; scopes: string }): Promise<{ id: string }> {
    // keyed on the PROJECT, mirroring 0106 — connecting the same provider from a different
    // project adds an account rather than overwriting the first
    const projectId = input.channelId ? this.channels.find((c) => c.id === input.channelId)?.projectId ?? null : null;
    const existing = this.connectors.find((x) => x.workspace === input.workspace && x.provider === input.provider && x.projectId === projectId);
    if (existing) { existing.handle = input.handle; existing.status = 'connected'; existing.channelId = input.channelId; return { id: existing.id }; }
    const id = crypto.randomUUID();
    this.connectors.push({ id, workspace: input.workspace, channelId: input.channelId, projectId, provider: input.provider, handle: input.handle, status: 'connected' });
    return { id };
  }
  async setConnectorSecret(connectorId: string, ciphertext: string): Promise<void> { this.connectorSecrets.set(connectorId, ciphertext); }
  async connectorWithSecret(workspace: string, provider: string, channelId?: string | null): Promise<{ id: string; status: string; handle: string; ciphertext: string | null } | null> {
    const want = channelId ? this.channels.find((c) => c.id === channelId)?.projectId ?? null : undefined;
    const hit = (x: { workspace: string; provider: string; projectId: string | null }) => x.workspace === workspace && x.provider === provider;
    // the project's own account first; a project-less connector remains a fallback (see pgstore)
    const c = this.connectors.find((x) => hit(x) && (want === undefined || x.projectId === want))
      ?? this.connectors.find((x) => hit(x) && x.projectId === null);
    return c ? { id: c.id, status: c.status, handle: c.handle, ciphertext: this.connectorSecrets.get(c.id) ?? null } : null;
  }
  async markConnectorReauth(connectorId: string): Promise<void> {
    const c = this.connectors.find((x) => x.id === connectorId);
    // status only — the secret stays (see the Store contract). 'reauth_required', NOT the
    // 'revoked' a human disconnect writes: the secret never syncs, so this synced word is the
    // only way a client can tell "the grant died under us" from "I turned this off".
    if (c) c.status = 'reauth_required';
  }
  async revokeConnector(connectorId: string, makeEvent: (workspace: string) => NMEvent): Promise<{ id: string }> {
    const c = this.connectors.find((x) => x.id === connectorId);
    if (!c) throw new DomainError('NOT_FOUND', 'connector not found');
    c.status = 'revoked';
    this.connectorSecrets.delete(connectorId);
    this.events.push(makeEvent(c.workspace));
    return { id: connectorId };
  }
  async dueContentItems(nowIso: string, limit: number): Promise<Array<{ id: string; workspace: string; channel: string; platform: string; body: string; mediaUrl?: string | null; mediaId?: string | null; mediaKind?: 'image' | 'video' | null; imageIntended: boolean }>> {
    return this.contentItems
      .filter((i) => i.status === 'scheduled' && !!i.scheduledAt && i.scheduledAt <= nowIso)
      .slice(0, limit)
      // the one media slot holds a picture or a film: the row's mime says which (pg: video_id vs image_id); a video post's hold is its film in flight
      .map((i) => ({ id: i.id, workspace: i.workspace, channel: i.channelId, platform: i.platform, body: i.body, mediaUrl: i.mediaUrl, mediaId: i.mediaId ?? null, mediaKind: i.mediaId ? ((this.contentMedia.get(i.mediaId)?.mime ?? '').startsWith('video/') ? 'video' as const : 'image' as const) : null, imageIntended: i.script || i.videoPending ? !!i.videoPending && !i.mediaId : !!i.brief }));
  }
  async upcomingContentItems(fromIso: string, toIso: string, limit: number): Promise<Array<{ id: string; workspace: string; channel: string; threadId: string | null; platform: string; body: string; scheduledAt: string }>> {
    return this.contentItems
      .filter((i) => i.status === 'scheduled' && !!i.scheduledAt && i.scheduledAt > fromIso && i.scheduledAt <= toIso)
      .slice(0, limit)
      .map((i) => ({ id: i.id, workspace: i.workspace, channel: i.channelId, threadId: (i as { threadId?: string | null }).threadId ?? null, platform: i.platform, body: i.body, scheduledAt: i.scheduledAt! }));
  }
  async contentItemMedia(itemId: string): Promise<{ platform: string; mediaUrl: string | null; mediaId?: string | null; workspace: string; channel?: string; frame?: string | null } | null> {
    const it = this.contentItems.find((x) => x.id === itemId);
    return it ? { platform: it.platform, mediaUrl: it.mediaUrl ?? null, mediaId: it.mediaId ?? null, workspace: it.workspace, channel: it.channelId, frame: it.frame ?? null } : null;
  }
  async markContentPublished(itemId: string, _url: string, _publishedAtIso: string): Promise<void> {
    const it = this.contentItems.find((x) => x.id === itemId);
    if (it) it.status = 'published';
  }
  async markContentFailed(itemId: string, error: string): Promise<void> {
    // the reason is RECORDED, not swallowed: it is what the post preview shows a human, and what
    // the re-queue clears. This stub used to drop it, so nothing in the memory suite could prove
    // either half (2026-08-18).
    const it = this.contentItems.find((x) => x.id === itemId);
    if (it) { it.status = 'failed'; it.lastError = error; }
  }

  async claimScheduleRun(scheduleId: string, runCount: number, nextRunAt: string | null, makeEvent: (workspace: string) => NMEvent): Promise<{ claimed: boolean }> {
    const s = this.schedules.find((x) => x.id === scheduleId);
    if (!s) throw new DomainError('NOT_FOUND', 'schedule not found');
    if (s.runCount !== runCount || s.status !== 'active') return { claimed: false }; // another machine won the CAS (or the schedule retired)
    s.runCount += 1;
    s.nextRunAt = nextRunAt;
    if (nextRunAt === null) s.status = 'done';
    this.events.push(makeEvent(s.workspace));
    return { claimed: true };
  }
  async markScheduleResult(scheduleId: string, error: string | null, makeEvent: (workspace: string) => NMEvent): Promise<{ id: string }> {
    this.events.push(makeEvent(markScheduleResultMem(this.schedules, scheduleId, error).workspace));
    return { id: scheduleId };
  }
  async setScheduleCursor(scheduleId: string, cursor: { at: string; tag: string | null }, log: { at: string; key: string | null; note: string } | null, makeEvent: (workspace: string) => NMEvent): Promise<{ id: string }> {
    this.events.push(makeEvent(setScheduleCursorMem(this.schedules, scheduleId, cursor, log).workspace));
    return { id: scheduleId };
  }
  async deleteChannel(channelId: string, makeEvent: (workspace: string) => NMEvent): Promise<{ id: string }> {
    const c = this.channels.find((x) => x.id === channelId);
    if (!c) throw new DomainError('NOT_FOUND', 'channel not found');
    this.events.push(makeEvent(c.workspace));
    this.channels = this.channels.filter((x) => x.id !== channelId);
    return { id: channelId };
  }
  private agentChannels = new Set<string>(); // `${agentId}:${channelId}` membership
  // test double: resolve the channel row if present, else accept the ref as the id (the PG
  // store does the real channel-existence validation; the memory store backs FSM unit tests).
  private memChannelId(workspace: string, channel: string): string {
    return this.channels.find((x) => x.id === channel || (x.workspace === workspace && x.slug === channel))?.id ?? channel;
  }
  async addAgentToChannel(workspace: string, channel: string, agent: string, makeEvent: (workspace: string) => NMEvent, _by?: { kind: string; id: string }): Promise<{ agentId: string; channelId: string }> {
    const channelId = this.memChannelId(workspace, channel);
    const agentId = this.agents.get(`${workspace}/${agent}`) ?? agent; // name → id, else assume id
    this.agentChannels.add(`${agentId}:${channelId}`);
    this.events.push(makeEvent(workspace));
    return { agentId, channelId };
  }
  async removeAgentFromChannel(workspace: string, channel: string, agent: string, makeEvent: (workspace: string) => NMEvent, _by?: { kind: string; id: string }): Promise<{ agentId: string; channelId: string }> {
    const channelId = this.memChannelId(workspace, channel);
    const agentId = this.agents.get(`${workspace}/${agent}`) ?? agent;
    this.agentChannels.delete(`${agentId}:${channelId}`);
    this.events.push(makeEvent(workspace));
    return { agentId, channelId };
  }
  private channelPeople = new Set<string>();
  async addPersonToChannel(workspace: string, channel: string, person: string, makeEvent: (workspace: string) => NMEvent, _by?: string | null): Promise<{ userId: string; channelId: string }> {
    const channelId = this.memChannelId(workspace, channel);
    this.channelPeople.add(`${person}:${channelId}`);
    this.events.push(makeEvent(workspace));
    return { userId: person, channelId };
  }
  async removePersonFromChannel(workspace: string, channel: string, person: string, makeEvent: (workspace: string) => NMEvent, _by?: string | null): Promise<{ userId: string; channelId: string }> {
    const channelId = this.memChannelId(workspace, channel);
    this.channelPeople.delete(`${person}:${channelId}`);
    this.events.push(makeEvent(workspace));
    return { userId: person, channelId };
  }

  private creds: Array<{ workspace: string; provider: string; scope: string; agentId: string | null; token: string | null; authMode: 'apikey' | 'subscription'; updatedAt: string }> = [];

  async setCredential(
    input: { workspace: string; provider: string; scope: 'workspace' | 'agent'; agentId: string | null; token: string | null; authMode: 'apikey' | 'subscription'; setBy: string },
    event: NMEvent,
  ): Promise<void> {
    this.creds = this.creds.filter(
      (c) => !(c.workspace === input.workspace && c.provider === input.provider && c.scope === input.scope && c.agentId === input.agentId),
    );
    this.creds.push({ workspace: input.workspace, provider: input.provider, scope: input.scope, agentId: input.agentId, token: input.token, authMode: input.authMode, updatedAt: new Date().toISOString() });
    this.events.push(event);
  }

  async resolveCredential(workspace: string, provider: string, agentId: string | null) {
    const autoFailover = this.workspaces.find((w) => w.id === workspace)?.autoFailover ?? false;
    const agent = agentId
      ? this.creds.find((c) => c.workspace === workspace && c.provider === provider && c.scope === 'agent' && c.agentId === agentId)
      : undefined;
    if (agent) return { token: agent.token, authMode: agent.authMode, source: 'agent', autoFailover };
    const ws = this.creds.find((c) => c.workspace === workspace && c.provider === provider && c.scope === 'workspace');
    return ws
      ? { token: ws.token, authMode: ws.authMode, source: 'workspace', autoFailover }
      : { token: null, authMode: null, source: 'none', autoFailover };
  }

  async listCredentials(workspace: string) {
    return this.creds
      .filter((c) => c.workspace === workspace)
      .map((c) => ({ provider: c.provider, scope: c.scope, agentId: c.agentId, authMode: c.authMode, last4: c.token ? c.token.slice(-4) : null, updatedAt: c.updatedAt }));
  }

  async enabledProviders(workspace: string): Promise<Set<string>> {
    return new Set(this.creds.filter((c) => c.workspace === workspace && c.scope === 'workspace').map((c) => c.provider));
  }

  private desktopAuth = new Map<string, { pollSecretHash: string; status: 'pending' | 'done'; result?: DesktopAuthResult; expiresAt: number }>();

  async startDesktopAuth(input: { nonce: string; pollSecretHash: string; ttlSeconds: number }): Promise<void> {
    this.desktopAuth.set(input.nonce, { pollSecretHash: input.pollSecretHash, status: 'pending', expiresAt: Date.now() + input.ttlSeconds * 1000 });
  }

  async completeDesktopAuth(nonce: string, result: DesktopAuthResult): Promise<{ ok: boolean }> {
    const row = this.desktopAuth.get(nonce);
    if (!row || row.expiresAt < Date.now() || row.status === 'done') return { ok: false };
    row.status = 'done';
    row.result = result;
    return { ok: true };
  }

  async claimDesktopAuth(nonce: string, pollSecretHash: string): Promise<{ status: 'pending' | 'done' | 'gone'; result?: DesktopAuthResult }> {
    const row = this.desktopAuth.get(nonce);
    // wrong secret, expired, or unknown nonce all collapse to 'gone' (don't distinguish)
    if (!row || row.expiresAt < Date.now() || row.pollSecretHash !== pollSecretHash) return { status: 'gone' };
    if (row.status === 'pending') return { status: 'pending' };
    this.desktopAuth.delete(nonce); // single-use: claimed once, then gone
    return { status: 'done', result: row.result };
  }

  private devices: Array<{ userId: string; platform: string; token: string; revoked: boolean }> = [];
  private pushLog = new Map<string, number>();
  private wsMembers = new Map<string, Set<string>>();
  // compute choice (0118) — 'workspace/userId' -> prefs; the pg store keeps this on the member row
  private memberCompute = new Map<string, { machine: string | null; agents: Record<string, string>; shares: string[] }>();

  private addMember(workspace: string, userId: string): void {
    const set = this.wsMembers.get(workspace) ?? new Set<string>();
    set.add(userId);
    this.wsMembers.set(workspace, set);
  }

  async registerDevice(input: { userId: string; platform: 'ios' | 'android'; token: string; deviceName?: string | null; appVersion?: string | null }): Promise<void> {
    const existing = this.devices.find((d) => d.userId === input.userId && d.token === input.token);
    if (existing) { existing.platform = input.platform; existing.revoked = false; return; }
    this.devices.push({ userId: input.userId, platform: input.platform, token: input.token, revoked: false });
  }

  async removeDevice(userId: string, token: string): Promise<void> {
    this.devices = this.devices.filter((d) => !(d.userId === userId && d.token === token));
  }

  async devicesForUsers(userIds: string[]): Promise<Array<{ userId: string; token: string; platform: string }>> {
    const set = new Set(userIds);
    return this.devices.filter((d) => !d.revoked && set.has(d.userId)).map((d) => ({ userId: d.userId, token: d.token, platform: d.platform }));
  }

  async revokeDeviceToken(token: string): Promise<void> {
    for (const d of this.devices) if (d.token === token) d.revoked = true;
  }

  async agentWorkspace(agentId: string): Promise<string | null> {
    return this.agentMeta.get(agentId)?.workspace ?? null;
  }

  async humanMemberIds(workspace: string): Promise<string[]> {
    return [...(this.wsMembers.get(workspace) ?? [])];
  }

  async recordPushOnce(userId: string, dedupeKey: string, windowMs: number): Promise<boolean> {
    const key = `${userId}:${dedupeKey}`;
    const last = this.pushLog.get(key);
    const now = Date.now();
    if (last !== undefined && now - last < windowMs) return false;
    this.pushLog.set(key, now);
    return true;
  }
}
