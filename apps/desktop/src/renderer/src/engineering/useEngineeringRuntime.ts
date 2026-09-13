import { useCallback, useEffect, useRef, useState } from 'react';
import { bridgeReady, nm, type NMBridge } from '../bridge/nm';
import { codeBridge } from '../bridge/desktop-relay';
import {
  createEngineeringSession,
  dismissEngineeringModeHandoff,
  setEngineeringModel,
  setEngineeringMode,
  setEngineeringPermission,
  submitEngineeringPrompt,
  type EngineeringRepo,
  type EngineeringSession,
  type PermissionCategory,
} from './domain';
import { applyRemoteEngineeringEvent, beginRemoteEngineeringPrompt, resolveRemoteEngineeringApproval } from './remote';
import { engineeringSystemText } from './copy';
import { engineeringSessionForRequest } from './navigation';
import type { EngineeringAttachmentUpload } from './attachments';
import { scheduleEngineeringSync } from './sync';
import { sendEngineeringPrompt } from './transport';
import { failRemoteEngineeringTransport } from './transport-state';
import { engineeringSessionStorageReady, loadEngineeringSessions, persistEngineeringSessions } from './session-storage';
import { flashToast } from '../lib/toast';
import { closeInactiveEngineeringHandles } from './handle-lifecycle';

type RuntimeState = 'checking' | 'ready' | 'unavailable';
type Handle = ReturnType<NonNullable<NMBridge['openEngineering']>>;
const sendCommand = (handle: Handle | null, command: Parameters<Handle['send']>[0], failed: (error: unknown) => void): void => {
  if (!handle) { failed(new Error('The Code workspace connection is unavailable.')); return; }
  void handle.send(command).catch(failed);
};

export function useEngineeringRuntime(harness: boolean, repos: EngineeringRepo[], workspaceId: string, initialActiveId: string | null = null, defaultMachineId: string | null = null) {
  const [sessions, setSessions] = useState<EngineeringSession[]>(() => loadEngineeringSessions(workspaceId, repos));
  const [activeId, setActiveId] = useState<string | null>(() => initialActiveId && sessions.some((session) => session.id === initialActiveId) ? initialActiveId : null);
  const [runtime, setRuntime] = useState<RuntimeState>(harness ? 'ready' : 'checking');
  const [reason, setReason] = useState<string | undefined>(harness ? 'Deterministic local harness: permission gates, diffs, and checkpoints are simulated without model billing.' : undefined);
  const handles = useRef(new Map<string, Handle>());
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const appliedNavigationId = useRef<string | null>(activeId && activeId === initialActiveId ? initialActiveId : null);
  const persistenceWorkspace = useRef(workspaceId);
  const persistenceReady = useRef(engineeringSessionStorageReady(workspaceId));
  const persistenceWarned = useRef(false);
  if (persistenceWorkspace.current !== workspaceId) {
    persistenceWorkspace.current = workspaceId;
    persistenceReady.current = engineeringSessionStorageReady(workspaceId);
    persistenceWarned.current = false;
  }
  useEffect(() => scheduleEngineeringSync(() => {
    if (!persistenceReady.current) return;
    const result = persistEngineeringSessions(workspaceId, sessions);
    if (result === 'full' || persistenceWarned.current) return;
    persistenceWarned.current = true;
    flashToast(result === 'metadata'
      ? 'Code history storage is full — thread identities are safe, but older transcript details were trimmed.'
      : 'Code history could not be saved. Keep this window open and free browser storage.');
  }), [sessions, workspaceId]);
  useEffect(() => {
    if (persistenceReady.current || !repos.length) return;
    const migrated = loadEngineeringSessions(workspaceId, repos);
    persistenceReady.current = engineeringSessionStorageReady(workspaceId);
    if (migrated.length) setSessions(migrated);
  }, [repos, workspaceId]);
  useEffect(() => {
    if (harness) return;
    let live = true;
    // the desktop composes its relay lane at boot (bridge/desktop-relay.ts); deciding on the
    // bridge's SHAPE before that lands would call a fresh boot into Code "unavailable"
    void bridgeReady.then(() => {
      if (!live) return;
      const code = codeBridge();
      if (!code?.engineeringInfo || !code.openEngineering) {
        setRuntime('unavailable');
        // the desktop knows its relay facts and found no relay; a client without even those has no lane at all
        setReason(nm?.relayEnv
          ? 'This desktop build has no relay configured to reach a machine through. Code reaches a cloud machine over nm-relay; set NM_RELAY_URL for this stack, or use the browser client until then.'
          : 'This client has no Code bridge.');
        return;
      }
      void code.engineeringInfo().then((info) => { setRuntime(info.available ? 'ready' : 'unavailable'); setReason(info.reason ? engineeringSystemText(info.reason) : undefined); }).catch((error: unknown) => { setRuntime('unavailable'); setReason(engineeringSystemText(error instanceof Error ? error.message : 'Could not reach the Engineering runtime.')); });
    });
    return () => { live = false; };
  }, [harness]);
  useEffect(() => () => { for (const handle of handles.current.values()) handle.close(); handles.current.clear(); }, []);
  useEffect(() => {
    if (!harness || sessions.length || !repos.length) return;
    let seed = createEngineeringSession(repos[0]!, 'Investigate auth callback race');
    seed = submitEngineeringPrompt(seed, 'Investigate the auth callback race and propose a safe fix');
    setSessions([seed]);
  }, [harness, repos, sessions.length]);

  const update = (next: EngineeringSession) => setSessions((all) => all.map((session) => session.id === next.id ? next : session));
  const fail = useCallback((sessionId: string, error: unknown) => setSessions((all) => all.map((item) => item.id === sessionId
    ? failRemoteEngineeringTransport(item, error)
    : item)), []);
  const connect = useCallback((session: EngineeringSession): Handle | null => {
    closeInactiveEngineeringHandles(handles.current, sessionsRef.current, session.id);
    const existing = handles.current.get(session.id);
    const code = codeBridge();
    if (existing || harness || !code?.openEngineering) return existing ?? null;
    const handle = code.openEngineering({
      threadId: session.id, repoId: session.repo.id, repoName: session.repo.name, branch: session.repo.branch,
      ...(session.project?.id ? { projectId: session.project.id } : {}),
      ...(session.repo.root ? { cwd: session.repo.root } : {}),
      mode: session.mode, permissions: session.permissions, policy: session.policy,
      modelId: session.modelOverride, brainPack: session.brainPack,
      // rule D9: which machine hosts this session — the desktop routes its own id in process
      ...(session.machineId ? { machineId: session.machineId } : {}),
    }, (event) => setSessions((all) => all.map((item) => item.id === session.id ? applyRemoteEngineeringEvent(item, event as unknown as Record<string, unknown>) : item)), () => {
      handles.current.delete(session.id);
      setSessions((all) => all.map((item) => item.id === session.id && (item.state === 'streaming' || item.state === 'awaiting_approval')
        ? failRemoteEngineeringTransport(item, new Error('The Code workspace connection closed.'))
        : item));
    });
    handles.current.set(session.id, handle);
    return handle;
  }, [harness]);
  // A click in the workspace-wide All threads rail arrives as a requested Engineering session.
  // Resolve it inside the already-mounted destination so global navigation and the in-pane
  // history button share the same runtime connection rather than remounting an active runner.
  useEffect(() => {
    const session = engineeringSessionForRequest(sessions, initialActiveId, appliedNavigationId.current);
    if (!session) return;
    appliedNavigationId.current = session.id;
    setActiveId(session.id);
    connect(session);
  }, [connect, initialActiveId, sessions]);
  const create = (repo: EngineeringRepo, project: EngineeringSession['project'] = null) => {
    if (runtime !== 'ready') return;
    const created = createEngineeringSession(repo, 'New Code task', project, defaultMachineId);
    const session = harness ? created : { ...created, checkpoints: [] };
    setSessions((all) => [...all, session]); setActiveId(session.id); connect(session);
  };
  const start = (repo: EngineeringRepo, prompt: string, preferences: Pick<EngineeringSession, 'mode' | 'permissions' | 'modelOverride' | 'brainPack' | 'machineId'>, uploads: EngineeringAttachmentUpload[] = [], project: EngineeringSession['project'] = null) => {
    const text = prompt.trim();
    if (runtime !== 'ready' || !text) return;
    const created = createEngineeringSession(repo, 'New Code task', project, preferences.machineId ?? defaultMachineId);
    const configured: EngineeringSession = {
      ...created,
      mode: preferences.mode,
      permissions: { ...preferences.permissions },
      modelOverride: preferences.modelOverride,
      brainPack: preferences.brainPack,
      ...(harness ? {} : { checkpoints: [] }),
    };
    const attached = uploads.map(({ name, mime }) => ({ name, mime }));
    const started = harness ? submitEngineeringPrompt(configured, text) : beginRemoteEngineeringPrompt(configured, text, attached);
    setSessions((all) => [...all, started]);
    setActiveId(started.id);
    if (!harness) {
      const handle = connect(configured);
      if (handle) void sendEngineeringPrompt(handle, text, uploads).catch((error: unknown) => fail(started.id, error));
      else fail(started.id, new Error('The Code workspace connection is unavailable.'));
    }
  };
  const open = (id: string) => { setActiveId(id); const session = sessions.find((item) => item.id === id); if (session) connect(session); };
  const send = (session: EngineeringSession, prompt: string, uploads: EngineeringAttachmentUpload[] = []) => {
    const handle = connect(session); if (!handle) return;
    update(beginRemoteEngineeringPrompt(session, prompt, uploads.map(({ name, mime }) => ({ name, mime }))));
    void sendEngineeringPrompt(handle, prompt, uploads).catch((error: unknown) => fail(session.id, error));
  };
  const setMode = (session: EngineeringSession, mode: 'plan' | 'act') => {
    const next = setEngineeringMode(session, mode); if (next === session) return; update(next);
    sendCommand(connect(next), { type: 'controls', controls: { mode: next.mode, permissions: next.permissions, policy: next.policy } }, (error) => fail(next.id, error));
  };
  const continueInAct = (session: EngineeringSession) => {
    const handoff = session.pendingModeHandoff;
    if (!handoff || session.mode !== 'plan' || session.state === 'streaming' || session.state === 'awaiting_approval') return;
    const next = setEngineeringMode(session, 'act');
    const started = beginRemoteEngineeringPrompt(next, handoff.prompt);
    update(started);
    const handle = connect(next);
    if (!handle) { fail(next.id, new Error('The Code workspace connection is unavailable.')); return; }
    void (async () => {
      await handle.send({ type: 'controls', controls: { mode: next.mode, permissions: next.permissions, policy: next.policy } });
      await handle.send({ type: 'prompt', prompt: handoff.prompt });
    })().catch((error: unknown) => fail(next.id, error));
  };
  const dismissModeHandoff = (session: EngineeringSession) => update(dismissEngineeringModeHandoff(session));
  const setPermission = (session: EngineeringSession, category: PermissionCategory, value: boolean) => {
    const next = setEngineeringPermission(session, category, value); if (next === session) return; update(next);
    sendCommand(connect(next), { type: 'controls', controls: { mode: next.mode, permissions: next.permissions, policy: next.policy } }, (error) => fail(next.id, error));
  };
  const setModel = (session: EngineeringSession, modelId: string | null) => {
    const next = setEngineeringModel(session, modelId); if (next === session) return; update(next);
    sendCommand(connect(next), { type: 'model', modelId }, (error) => fail(next.id, error));
  };
  const approve = (session: EngineeringSession, approved: boolean) => {
    const approvalId = session.pendingApproval?.id; if (!approvalId) return;
    update(resolveRemoteEngineeringApproval(session, approved)); sendCommand(connect(session), { type: 'approval', approvalId, approved }, (error) => fail(session.id, error));
  };
  const restore = (session: EngineeringSession, checkpointId: string) => {
    const checkpointRunCount = Number(checkpointId.replace('cline-run-', ''));
    if (Number.isInteger(checkpointRunCount) && checkpointRunCount > 0) sendCommand(connect(session), { type: 'restore', checkpointRunCount }, (error) => fail(session.id, error));
  };
  const home = () => { closeInactiveEngineeringHandles(handles.current, sessions, null); setActiveId(null); };
  return { sessions, active: sessions.find((session) => session.id === activeId) ?? null, runtime, reason, update, create, start, open, home, send, setMode, continueInAct, dismissModeHandoff, setPermission, setModel, approve, restore };
}
