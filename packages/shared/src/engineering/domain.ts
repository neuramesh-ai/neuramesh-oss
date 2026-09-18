import { firstSentence } from '../linear';
import { engineeringModeHandoff, type EngineeringModeHandoff } from './handoff';
import type { EngineeringMode } from './protocol';
export type { EngineeringMode };

/**
 * Engineering OS' client contract. Cline Core owns execution on the machine/relay; this module
 * owns the product invariants the browser must be able to render and enforce before a tool runs.
 * It is deliberately runtime-agnostic so the local harness and the relay consume one state model.
 */

export type EngineeringTurnState = 'idle' | 'streaming' | 'awaiting_approval' | 'resumable' | 'completed' | 'error';
export type PermissionCategory = 'read' | 'edit' | 'command' | 'web' | 'mcp';
export type PermissionDecision = 'auto' | 'ask' | 'blocked';

export interface EngineeringPermissions { read: boolean; edit: boolean; command: boolean; web: boolean; mcp: boolean }

export interface EngineeringPolicy { read: boolean; edit: boolean; command: boolean; web: boolean; mcp: boolean }

export interface EngineeringRepo {
  id: string;
  name: string;
  owner: string;
  branch: string;
  root: string | null;
}

export interface EngineeringProject {
  id: string;
  name: string;
  slug: string;
  logoUrl?: string | null;
}

export interface EngineeringAttachment {
  name: string;
  mime: string;
}

export interface EngineeringMessage { id: string; role: 'user' | 'assistant' | 'tool' | 'reasoning'; body: string; createdAt: string; tone?: 'plain' | 'plan' | 'success' | 'warning'; streaming?: boolean; collapsed?: boolean; redacted?: boolean; attachments?: EngineeringAttachment[] }

export interface EngineeringActiveActivity { phase: 'thinking' | 'tool' | 'composing'; toolName?: string; startedAt: string }

export interface EngineeringChange {
  path: string;
  kind: 'added' | 'modified' | 'deleted';
  before: string;
  after: string;
  diff: string;
}

export interface EngineeringApproval {
  id: string;
  category: PermissionCategory;
  title: string;
  detail: string;
  command?: string;
  changes?: EngineeringChange[];
  continuation: 'inspect' | 'apply' | 'verify';
}

export interface EngineeringCheckpoint {
  id: string;
  label: string;
  createdAt: string;
  messageCount: number;
  changes: EngineeringChange[];
  workPlan: string | null;
}

export interface EngineeringSession {
  id: string;
  title: string;
  repo: EngineeringRepo;
  /** The project fixes repository and inherited brain context for this thread. */
  project?: EngineeringProject | null;
  mode: EngineeringMode;
  permissions: EngineeringPermissions;
  policy: EngineeringPolicy;
  state: EngineeringTurnState;
  /** Ephemeral live narration for the one thinking-orb surface in the transcript. */
  activeActivity?: EngineeringActiveActivity | null;
  /** A Plan-mode side effect that can resume through the one-click Act gate. */
  pendingModeHandoff?: EngineeringModeHandoff | null;
  messages: EngineeringMessage[];
  pendingApproval: EngineeringApproval | null;
  proposedChanges: EngineeringChange[];
  changes: EngineeringChange[];
  checkpoints: EngineeringCheckpoint[];
  /** Task-scoped model override. Null inherits the repository/project developer model. */
  workPlan: string | null; modelOverride: string | null;
  /** WHERE THIS SESSION RUNS (rule D9): the machine the engineering channel opens to — this Mac's
   *  id routes to the app's own host, anything else to the relay; null = the lane's default. */
  machineId?: string | null;
  /** @deprecated Persisted only so Code threads created by older clients can resume. */
  brainPack: string | null;
  provider?: string; model?: string;
  createdAt: string; updatedAt: string;
}

export const PERMISSION_LABELS: Record<PermissionCategory, { label: string; detail: string }> = {
  read: { label: 'Read files', detail: 'Inspect files and search the repository' },
  edit: { label: 'Edit files', detail: 'Create, modify, rename, or delete files' },
  command: { label: 'Execute commands', detail: 'Run shell commands and test suites' },
  web: { label: 'Fetch web content', detail: 'Open URLs and search the web' },
  mcp: { label: 'Use MCP servers', detail: 'Call tools exposed by connected MCP servers' },
};

/** Recommended session posture: reads flow; every side effect is reviewed. */
export const RECOMMENDED_ENGINEERING_PERMISSIONS: EngineeringPermissions = {
  read: true,
  edit: false,
  command: false,
  web: false,
  mcp: false,
};

export const OPEN_ENGINEERING_POLICY: EngineeringPolicy = {
  read: true,
  edit: true,
  command: true,
  web: true,
  mcp: true,
};

const stamp = () => new Date().toISOString();
const uid = (prefix: string) => `${prefix}-${globalThis.crypto.randomUUID()}`;

export function effectivePermission(
  mode: EngineeringMode,
  category: PermissionCategory,
  session: EngineeringPermissions,
  policy: EngineeringPolicy,
): PermissionDecision {
  if (!policy[category]) return 'blocked';
  // Plan is structurally read-only, even if a stale client claims edit/command auto-approval.
  if (mode === 'plan' && (category === 'edit' || category === 'command')) return 'blocked';
  return session[category] ? 'auto' : 'ask';
}

const msg = (role: EngineeringMessage['role'], body: string, tone: EngineeringMessage['tone'] = 'plain'): EngineeringMessage => ({
  id: uid('msg'), role, body, tone, createdAt: stamp(),
});

const initialCheckpoint = (): EngineeringCheckpoint => ({
  id: uid('cp'), label: 'Session start', createdAt: stamp(), messageCount: 1, changes: [], workPlan: null,
});

export function createEngineeringSession(repo: EngineeringRepo, title = 'New Code task', project: EngineeringProject | null = null, machineId: string | null = null): EngineeringSession {
  const now = stamp();
  const hello = msg('assistant', `Ready in **${repo.name}**. I’ll begin in Plan mode and ask before any side effect.`, 'plain');
  const checkpoint = initialCheckpoint();
  checkpoint.messageCount = 1;
  return {
    // a BARE uuid (the mobile-cloud round, S5): the session id is the thread id, and the thread id is
    // the synced code_sessions row's id (0135, a uuid pk) — a prefixed id could never become a row
    id: globalThis.crypto.randomUUID(), title, repo, project, mode: 'plan',
    permissions: { ...RECOMMENDED_ENGINEERING_PERMISSIONS },
    policy: { ...OPEN_ENGINEERING_POLICY }, state: 'idle', activeActivity: null, pendingModeHandoff: null, messages: [hello], pendingApproval: null,
    proposedChanges: [], changes: [], checkpoints: [checkpoint], workPlan: null, modelOverride: null, brainPack: null, machineId,
    createdAt: now, updatedAt: now,
  };
}

export function setEngineeringMode(session: EngineeringSession, mode: EngineeringMode): EngineeringSession {
  if (session.state === 'streaming' || session.state === 'awaiting_approval') return session;
  return { ...session, mode, ...(mode === 'act' ? { pendingModeHandoff: null } : {}), updatedAt: stamp() };
}

export const dismissEngineeringModeHandoff = (session: EngineeringSession): EngineeringSession => ({ ...session, pendingModeHandoff: null, updatedAt: stamp() });

export function setEngineeringPermission(session: EngineeringSession, category: PermissionCategory, value: boolean): EngineeringSession {
  if (session.state === 'streaming' || session.state === 'awaiting_approval') return session;
  return { ...session, permissions: { ...session.permissions, [category]: value }, updatedAt: stamp() };
}

export const setEngineeringBrainPack = (session: EngineeringSession, brainPack: string | null): EngineeringSession =>
  session.state === 'streaming' || session.state === 'awaiting_approval' || session.brainPack === brainPack ? session : { ...session, brainPack, updatedAt: stamp() };

/** the machine chip: a session's machine may change while it is idle — never mid-turn, the channel is open to one host */
export const setEngineeringMachine = (session: EngineeringSession, machineId: string | null): EngineeringSession => session.state === 'streaming' || session.state === 'awaiting_approval' || (session.machineId ?? null) === machineId ? session : { ...session, machineId, updatedAt: stamp() };

export const setEngineeringModel = (session: EngineeringSession, modelOverride: string | null): EngineeringSession =>
  session.state === 'streaming' || session.state === 'awaiting_approval' || (session.modelOverride === modelOverride && session.brainPack === null)
    ? session
    : { ...session, modelOverride, brainPack: null, updatedAt: stamp() };

export function setEngineeringPolicy(session: EngineeringSession, policy: Partial<EngineeringPolicy>): EngineeringSession {
  return { ...session, policy: { ...session.policy, ...policy }, updatedAt: stamp() };
}

function readApproval(): EngineeringApproval {
  return {
    id: uid('approval'), category: 'read', title: 'Inspect repository files',
    detail: 'Read package.json, the app shell, navigation model, and existing tests.', continuation: 'inspect',
  };
}

const SAMPLE_CHANGES: EngineeringChange[] = [
  {
    path: 'src/components/AuthCallback.tsx', kind: 'modified',
    before: `useEffect(() => {\n  exchangeCode(code).then(navigateHome)\n}, [code])\n`,
    after: `useEffect(() => {\n  const request = new AbortController()\n  exchangeCode(code, request.signal).then(navigateHome)\n  return () => request.abort()\n}, [code])\n`,
    diff: `diff --git a/src/components/AuthCallback.tsx b/src/components/AuthCallback.tsx\nindex e421af0..bc21e2a 100644\n--- a/src/components/AuthCallback.tsx\n+++ b/src/components/AuthCallback.tsx\n@@ -1,3 +1,5 @@\n useEffect(() => {\n-  exchangeCode(code).then(navigateHome)\n+  const request = new AbortController()\n+  exchangeCode(code, request.signal).then(navigateHome)\n+  return () => request.abort()\n }, [code])\n`,
  },
  {
    path: 'src/components/AuthCallback.test.tsx', kind: 'added', before: '',
    after: `it('cancels the exchange when the route unmounts', async () => {\n  const { unmount } = render(<AuthCallback code="demo" />)\n  unmount()\n  expect(exchangeSignal.aborted).toBe(true)\n})\n`,
    diff: `diff --git a/src/components/AuthCallback.test.tsx b/src/components/AuthCallback.test.tsx\nnew file mode 100644\nindex 0000000..78ce3d1\n--- /dev/null\n+++ b/src/components/AuthCallback.test.tsx\n@@ -0,0 +1,5 @@\n+it('cancels the exchange when the route unmounts', async () => {\n+  const { unmount } = render(<AuthCallback code="demo" />)\n+  unmount()\n+  expect(exchangeSignal.aborted).toBe(true)\n+})\n`,
  },
];

const WORK_PLAN = `## Work Plan\n\n1. Trace the callback lifecycle and reproduce the duplicate exchange.\n2. Make the in-flight request cancellable when the route unmounts.\n3. Add regression coverage for unmount and a successful callback.\n4. Run the focused test, typecheck, and the application build.\n\n**Guardrails:** no auth protocol changes; no token material leaves the machine.`;

function afterInspection(session: EngineeringSession): EngineeringSession {
  if (session.mode === 'plan') {
    return {
      ...session, state: 'completed', activeActivity: null, workPlan: WORK_PLAN, pendingApproval: null,
      pendingModeHandoff: engineeringModeHandoff('edit', 'apply_patch'),
      messages: [...session.messages,
        msg('tool', 'Read 4 files · package.json · AuthCallback.tsx · auth-client.ts · auth tests'),
        msg('assistant', `${WORK_PLAN}\n\nNo files were changed in Plan mode. Switch to **Act** when you want me to implement it.`, 'plan')],
      updatedAt: stamp(),
    };
  }
  const proposal: EngineeringApproval = {
    id: uid('approval'), category: 'edit', title: 'Apply 2-file patch',
    detail: 'Cancel the stale callback exchange and add regression coverage.', changes: SAMPLE_CHANGES, continuation: 'apply',
  };
  const decision = effectivePermission(session.mode, 'edit', session.permissions, session.policy);
  if (decision === 'blocked') {
    return { ...session, state: 'error', activeActivity: null, pendingApproval: null, messages: [...session.messages, msg('assistant', 'File edits are blocked by the effective workspace policy.', 'warning')], updatedAt: stamp() };
  }
  const proposed = { ...session, activeActivity: null, proposedChanges: SAMPLE_CHANGES, pendingApproval: proposal, state: 'awaiting_approval' as const, updatedAt: stamp() };
  return decision === 'auto' ? applyProposedChanges(proposed) : proposed;
}

function applyProposedChanges(session: EngineeringSession): EngineeringSession {
  const changes = session.pendingApproval?.changes ?? session.proposedChanges;
  const checkpoint: EngineeringCheckpoint = {
    id: uid('cp'), label: 'Before file edits', createdAt: stamp(), messageCount: session.messages.length,
    changes: session.changes.map((c) => ({ ...c })), workPlan: session.workPlan,
  };
  const next: EngineeringSession = {
    ...session, changes, proposedChanges: [], checkpoints: [...session.checkpoints, checkpoint],
    pendingApproval: null, state: 'streaming', activeActivity: { phase: 'thinking', startedAt: stamp() },
    messages: [...session.messages, msg('tool', `Applied ${changes.length} files · +${changes.reduce((n, c) => n + c.after.split('\n').length, 0)} lines`, 'success')],
    updatedAt: stamp(),
  };
  const verify: EngineeringApproval = {
    id: uid('approval'), category: 'command', title: 'Run verification',
    detail: 'Run the focused auth test and TypeScript typecheck.',
    command: 'pnpm test AuthCallback.test.tsx && pnpm typecheck', continuation: 'verify',
  };
  const decision = effectivePermission(next.mode, 'command', next.permissions, next.policy);
  if (decision === 'blocked') {
    return { ...next, state: 'resumable', activeActivity: null, messages: [...next.messages, msg('assistant', 'The patch is applied, but command execution is blocked by workspace policy. Verification remains outstanding.', 'warning')] };
  }
  return decision === 'auto' ? finishVerification(next) : { ...next, pendingApproval: verify, state: 'awaiting_approval', activeActivity: null };
}

function finishVerification(session: EngineeringSession): EngineeringSession {
  const done = msg('assistant', 'Implemented and verified. The focused regression test, typecheck, and build all pass.', 'success');
  const messages = [...session.messages, msg('tool', '✓ AuthCallback.test.tsx · ✓ typecheck · ✓ build', 'success'), done];
  const checkpoint: EngineeringCheckpoint = {
    id: uid('cp'), label: 'Verified implementation', createdAt: stamp(), messageCount: messages.length,
    changes: session.changes.map((c) => ({ ...c })), workPlan: session.workPlan,
  };
  return { ...session, messages, pendingApproval: null, state: 'completed', activeActivity: null, checkpoints: [...session.checkpoints, checkpoint], updatedAt: stamp() };
}

export function submitEngineeringPrompt(session: EngineeringSession, prompt: string): EngineeringSession {
  const text = prompt.trim();
  if (!text || session.state === 'streaming' || session.state === 'awaiting_approval') return session;
  const title = session.title === 'New Code task' || session.title === 'New engineering task' ? firstSentence(text).slice(0, 64) || session.title : session.title;
  const started: EngineeringSession = {
    ...session, title, state: 'streaming', activeActivity: { phase: 'thinking', startedAt: stamp() }, pendingModeHandoff: null, pendingApproval: null, proposedChanges: [],
    messages: [...session.messages, msg('user', text)], updatedAt: stamp(),
  };
  const decision = effectivePermission(started.mode, 'read', started.permissions, started.policy);
  if (decision === 'blocked') return { ...started, state: 'error', activeActivity: null, messages: [...started.messages, msg('assistant', 'Repository reads are blocked by workspace policy.', 'warning')] };
  if (decision === 'ask') return { ...started, state: 'awaiting_approval', activeActivity: null, pendingApproval: readApproval() };
  return afterInspection(started);
}

export function continueEngineeringInAct(session: EngineeringSession): EngineeringSession {
  const handoff = session.pendingModeHandoff;
  if (!handoff || session.mode !== 'plan' || session.state === 'streaming' || session.state === 'awaiting_approval') return session;
  return submitEngineeringPrompt({ ...session, mode: 'act', pendingModeHandoff: null, updatedAt: stamp() }, handoff.prompt);
}

export function resolveEngineeringApproval(session: EngineeringSession, approved: boolean): EngineeringSession {
  const approval = session.pendingApproval;
  if (!approval || session.state !== 'awaiting_approval') return session;
  if (!approved) {
    return {
      ...session, state: 'resumable', activeActivity: null, pendingApproval: null, proposedChanges: [],
      messages: [...session.messages, msg('assistant', `${approval.title} was declined. No further action was taken.`, 'warning')], updatedAt: stamp(),
    };
  }
  if (approval.continuation === 'inspect') return afterInspection({ ...session, pendingApproval: null, state: 'streaming', activeActivity: { phase: 'thinking', startedAt: stamp() } });
  if (approval.continuation === 'apply') return applyProposedChanges(session);
  return finishVerification(session);
}
