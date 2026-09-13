// THE PHONE'S LIVE CODE SESSIONS (the mobile-cloud round, S5.3): one store of open Engineering
// channels, keyed by the session (= thread = code_sessions row) id. The transcript is the SHARED
// reducer over the machine's events — the same applyRemoteEngineeringEvent the desktop and the
// browser run — held in memory only: the machine keeps the authoritative transcript, and the
// synced row (0135) is what the list reads when nothing is open. A screen subscribes to one id.
import {
  applyRemoteEngineeringEvent, beginRemoteEngineeringPrompt, createEngineeringSession, failRemoteEngineeringTransport,
  OPEN_ENGINEERING_POLICY, RECOMMENDED_ENGINEERING_PERMISSIONS, resolveRemoteEngineeringApproval, setEngineeringMode,
  setEngineeringModel,
  type EngineeringMode, type EngineeringProject, type EngineeringRepo, type EngineeringRuntimeEvent, type EngineeringSession,
} from '@neuramesh/shared';
import { useEffect, useState } from 'react';
import { type EngineeringHandle, openEngineering } from './relay';

interface Live { session: EngineeringSession; handle: EngineeringHandle | null; workspace: string }
const live = new Map<string, Live>();
const subs = new Map<string, Set<() => void>>();

const notify = (id: string) => subs.get(id)?.forEach((f) => f());
function update(id: string, next: (s: EngineeringSession) => EngineeringSession): void {
  const cur = live.get(id);
  if (!cur) return;
  cur.session = next(cur.session);
  notify(id);
}

export function useCodeSession(id: string): EngineeringSession | null {
  const [, bump] = useState(0);
  useEffect(() => {
    const set = subs.get(id) ?? new Set();
    const f = () => bump((n) => n + 1);
    set.add(f);
    subs.set(id, set);
    return () => { set.delete(f); };
  }, [id]);
  return live.get(id)?.session ?? null;
}

/** dial the machine for a session and route its events through the reducer */
function connect(entry: Live): EngineeringHandle {
  if (entry.handle) return entry.handle;
  const s = entry.session;
  const handle = openEngineering(entry.workspace, {
    threadId: s.id, repoId: s.repo.id, repoName: s.repo.name, branch: s.repo.branch,
    ...(s.project?.id ? { projectId: s.project.id } : {}),
    mode: s.mode, permissions: s.permissions, policy: s.policy, modelId: s.modelOverride, brainPack: s.brainPack,
    ...(s.machineId ? { machineId: s.machineId } : {}),
  }, (event: EngineeringRuntimeEvent) => {
    update(s.id, (cur) => applyRemoteEngineeringEvent(cur, event as unknown as Record<string, unknown>));
  }, () => {
    entry.handle = null;
    update(s.id, (cur) => (cur.state === 'streaming' || cur.state === 'awaiting_approval') ? failRemoteEngineeringTransport(cur, new Error('The Code connection closed.')) : cur);
  });
  entry.handle = handle;
  return handle;
}

const fail = (id: string, error: unknown) => update(id, (cur) => failRemoteEngineeringTransport(cur, error));

/** a NEW session: mint it, open the lane, send the first prompt; returns the id the screen routes to */
export function startCodeSession(input: { workspace: string; repo: EngineeringRepo; project: EngineeringProject | null; machineId: string | null; mode: EngineeringMode; prompt: string; modelId?: string | null }): string {
  const created = createEngineeringSession(input.repo, 'New Code task', input.project, input.machineId);
  // the model the composer's chip picked; null keeps the project's own default (the fix round, 2026-09-06)
  const configured: EngineeringSession = { ...created, mode: input.mode, modelOverride: input.modelId ?? null, permissions: { ...RECOMMENDED_ENGINEERING_PERMISSIONS }, policy: { ...OPEN_ENGINEERING_POLICY }, checkpoints: [] };
  const started = beginRemoteEngineeringPrompt(configured, input.prompt);
  const entry: Live = { session: started, handle: null, workspace: input.workspace };
  live.set(started.id, entry);
  try {
    const handle = connect(entry);
    void handle.send({ type: 'prompt', prompt: input.prompt }).catch((e: unknown) => fail(started.id, e));
  } catch (e) {
    fail(started.id, e);
  }
  return started.id;
}

/** an EXISTING session (a synced row): rebuild the shell from the row and re-open the lane — the
 *  machine finds the thread's history by its id; what it sends is what the transcript shows */
export function openCodeSession(input: { workspace: string; id: string; title: string; repo: EngineeringRepo; project: EngineeringProject | null; machineId: string | null; mode: EngineeringMode }): EngineeringSession {
  const existing = live.get(input.id);
  if (existing) { connect(existing); return existing.session; }
  const shell: EngineeringSession = {
    ...createEngineeringSession(input.repo, input.title, input.project, input.machineId), id: input.id, mode: input.mode,
    messages: [], checkpoints: [], state: 'resumable',
  };
  const entry: Live = { session: shell, handle: null, workspace: input.workspace };
  live.set(input.id, entry);
  try { connect(entry); } catch (e) { fail(input.id, e); }
  return entry.session;
}

export function sendCodePrompt(id: string, prompt: string): void {
  const entry = live.get(id);
  if (!entry) return;
  update(id, (cur) => beginRemoteEngineeringPrompt(cur, prompt));
  try { void connect(entry).send({ type: 'prompt', prompt }).catch((e: unknown) => fail(id, e)); } catch (e) { fail(id, e); }
}

export function setCodeMode(id: string, mode: EngineeringMode): void {
  const entry = live.get(id);
  if (!entry) return;
  const next = setEngineeringMode(entry.session, mode);
  if (next === entry.session) return;
  update(id, () => next);
  try { void connect(entry).send({ type: 'controls', controls: { mode: next.mode, permissions: next.permissions, policy: next.policy } }).catch((e: unknown) => fail(id, e)); } catch (e) { fail(id, e); }
}

/** change the brain a session runs on. Refused mid-turn by the shared reducer, which is why the
 *  chip is disabled while a turn streams. The machine hears it on its OWN frame: `modelId` is not
 *  part of `EngineeringControls`, so sending it as a controls frame would drop it silently. The
 *  machine answers `model_changed`, and the reducer takes the machine's word over ours. */
export function setCodeModel(id: string, modelId: string | null): void {
  const entry = live.get(id);
  if (!entry) return;
  const next = setEngineeringModel(entry.session, modelId);
  if (next === entry.session) return;
  update(id, () => next);
  try { void connect(entry).send({ type: 'model', modelId }).catch((e: unknown) => fail(id, e)); } catch (e) { fail(id, e); }
}

export function approveCode(id: string, approved: boolean): void {
  const entry = live.get(id);
  const approvalId = entry?.session.pendingApproval?.id;
  if (!entry || !approvalId) return;
  update(id, (cur) => resolveRemoteEngineeringApproval(cur, approved));
  try { void connect(entry).send({ type: 'approval', approvalId, approved }).catch((e: unknown) => fail(id, e)); } catch (e) { fail(id, e); }
}

/** the screen left: close the lane, keep the transcript for a quick return */
export function closeCodeLane(id: string): void {
  const entry = live.get(id);
  entry?.handle?.close();
  if (entry) entry.handle = null;
}
