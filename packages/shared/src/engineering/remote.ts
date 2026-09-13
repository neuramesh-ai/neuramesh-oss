import type { EngineeringAttachment, EngineeringChange, EngineeringMessage, EngineeringSession, EngineeringTurnState, PermissionCategory } from './domain';
import { modelLabel } from '../model-labels';
import { engineeringModeHandoff } from './handoff';
import { engineeringSystemText } from './copy';
import { engineeringPatchPaths } from './patch';
let serial = 0; const stamp = () => new Date().toISOString();
const message = (role: EngineeringMessage['role'], body: string, tone: EngineeringMessage['tone'] = 'plain'): EngineeringMessage => ({
  id: `remote-${Date.now().toString(36)}-${(++serial).toString(36)}`, role, body, tone, createdAt: stamp(),
});
const textValue = (value: unknown): string => typeof value === 'string' ? value : JSON.stringify(value, null, 2);
const isPlanCeiling = (session: EngineeringSession, value: unknown): boolean => session.mode === 'plan' && /blocked by.*plan mode/i.test(textValue(value));
const terminalState = (reason: unknown): EngineeringTurnState => reason === 'completed' ? 'completed' : reason === 'error' ? 'error' : 'resumable';

function lastMessageIndex(messages: EngineeringMessage[], role: EngineeringMessage['role'], streamingOnly = false): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const current = messages[index];
    if (current?.role === role && (!streamingOnly || current.streaming)) return index;
  }
  return -1;
}

function updateMessage(messages: EngineeringMessage[], index: number, next: EngineeringMessage): EngineeringMessage[] {
  return messages.map((current, at) => at === index ? next : current);
}
function collapseReasoning(messages: EngineeringMessage[]): EngineeringMessage[] {
  return messages.map((current) => current.role === 'reasoning' && !current.collapsed ? { ...current, streaming: false, collapsed: true } : current);
}
function finishStreamingMessages(messages: EngineeringMessage[], collapseThoughts: boolean): EngineeringMessage[] {
  return (collapseThoughts ? collapseReasoning(messages) : messages).map((current) => current.streaming
    ? { ...current, streaming: false }
    : current);
}

function applyReasoningDelta(session: EngineeringSession, event: Record<string, unknown>): EngineeringSession {
  const redacted = event['redacted'] === true;
  const chunk = typeof event['reasoning'] === 'string' ? event['reasoning'] : '';
  if (!chunk && !redacted) return session;
  const index = lastMessageIndex(session.messages, 'reasoning', true);
  const body = redacted ? 'Reasoning is private for the selected model.' : chunk;
  const messages = index < 0
    ? [...session.messages, { ...message('reasoning', body), streaming: true, collapsed: false, redacted }]
    : updateMessage(session.messages, index, {
      ...session.messages[index]!,
      body: redacted ? session.messages[index]!.body || body : `${session.messages[index]!.body}${chunk}`,
      streaming: true,
      collapsed: false,
      redacted: session.messages[index]!.redacted || redacted,
    });
  return { ...session, activeActivity: { phase: 'thinking', startedAt: stamp() }, messages, updatedAt: stamp() };
}

function applyTextDelta(session: EngineeringSession, event: Record<string, unknown>): EngineeringSession {
  const chunk = typeof event['text'] === 'string' ? event['text'] : '';
  const accumulated = typeof event['accumulated'] === 'string' ? event['accumulated'] : null;
  const collapsed = collapseReasoning(session.messages);
  const index = lastMessageIndex(collapsed, 'assistant', true);
  if (!chunk && accumulated === null) return { ...session, activeActivity: { phase: 'composing', startedAt: stamp() }, messages: collapsed, updatedAt: stamp() };
  const body = accumulated ?? (index >= 0 ? `${collapsed[index]!.body}${chunk}` : chunk);
  const messages = index < 0
    ? [...collapsed, { ...message('assistant', body), streaming: true }]
    : updateMessage(collapsed, index, { ...collapsed[index]!, body, streaming: true });
  return { ...session, activeActivity: { phase: 'composing', startedAt: stamp() }, messages, updatedAt: stamp() };
}

function mergeChanges(current: EngineeringChange[], incoming: EngineeringChange[]): EngineeringChange[] {
  const paths = new Set(incoming.map((change) => change.path));
  return [...current.filter((change) => !paths.has(change.path)), ...incoming];
}

function remoteChange(toolName: string, input: unknown): EngineeringChange[] {
  const value = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  if (toolName === 'editor') {
    const path = typeof value['path'] === 'string' ? value['path'] : 'proposed-edit';
    const before = typeof value['old_text'] === 'string' ? value['old_text'] : '';
    const after = typeof value['new_text'] === 'string' ? value['new_text'] : '';
    return [{
      path, kind: before ? 'modified' : 'added', before, after,
      diff: `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ proposed change @@\n${before.split('\n').filter(Boolean).map((line) => `-${line}`).join('\n')}\n${after.split('\n').filter(Boolean).map((line) => `+${line}`).join('\n')}\n`,
    }];
  }
  if (toolName !== 'apply_patch') return [];
  const patch = typeof input === 'string' ? input : typeof value['input'] === 'string' ? value['input'] : textValue(input);
  const paths = engineeringPatchPaths(patch);
  return (paths.length ? paths : ['proposed.patch']).map((path): EngineeringChange => ({
    path,
    kind: patch.includes(`*** Add File: ${path}`) ? 'added' : patch.includes(`*** Delete File: ${path}`) ? 'deleted' : 'modified',
    before: '', after: patch, diff: patch,
  }));
}

export function beginRemoteEngineeringPrompt(session: EngineeringSession, prompt: string, attachments: EngineeringAttachment[] = []): EngineeringSession {
  const text = prompt.trim();
  if (!text || session.state === 'streaming' || session.state === 'awaiting_approval') return session;
  const title = session.title === 'New Code task' || session.title === 'New engineering task'
    ? text.replace(/[.!?].*$/, '').slice(0, 64) || session.title
    : session.title;
  return {
    ...session, title, state: 'streaming', activeActivity: { phase: 'thinking', startedAt: stamp() }, pendingModeHandoff: null,
    messages: [...session.messages, { ...message('user', text), ...(attachments.length ? { attachments } : {}) }], updatedAt: stamp(),
  };
}

export function resolveRemoteEngineeringApproval(session: EngineeringSession, approved: boolean): EngineeringSession {
  if (!session.pendingApproval) return session;
  return {
    ...session, pendingApproval: null, proposedChanges: approved ? session.proposedChanges : [],
    state: approved ? 'streaming' : 'resumable',
    activeActivity: approved ? { phase: 'thinking', startedAt: stamp() } : null,
    ...(!approved ? { messages: [...session.messages, message('assistant', 'The requested action was declined.', 'warning')] } : {}),
    updatedAt: stamp(),
  };
}

function applySnapshot(session: EngineeringSession, core: Record<string, unknown>): EngineeringSession {
  const payload = core['payload'] as Record<string, unknown> | undefined;
  const snapshot = payload?.['snapshot'] as Record<string, unknown> | undefined;
  const checkpoint = snapshot?.['checkpoint'] as Record<string, unknown> | undefined;
  const history = Array.isArray(checkpoint?.['history']) ? checkpoint['history'] as Array<Record<string, unknown>> : [];
  const checkpoints = history.flatMap((entry) => {
    const runCount = entry['runCount'];
    if (typeof runCount !== 'number') return [];
    return [{ id: `cline-run-${runCount}`, label: runCount === 1 ? 'Before first run' : `Before run ${runCount}`, createdAt: new Date(typeof entry['createdAt'] === 'number' ? entry['createdAt'] : Date.now()).toISOString(), messageCount: session.messages.length, changes: session.changes.map((change) => ({ ...change })), workPlan: session.workPlan }];
  });
  return checkpoints.length ? { ...session, checkpoints, updatedAt: stamp() } : session;
}

function applyContentEvent(session: EngineeringSession, event: Record<string, unknown>): EngineeringSession {
  // Cline Core intentionally projects its internal AgentRuntimeEvent vocabulary into this
  // stable public AgentEvent facade. Capturing tool input at content_start also preserves
  if (event['type'] === 'content_start' && event['contentType'] === 'tool') {
    const changes = remoteChange(String(event['toolName'] ?? 'tool'), event['input']);
    return {
      ...session,
      activeActivity: { phase: 'tool', toolName: String(event['toolName'] ?? 'tool'), startedAt: stamp() },
      messages: finishStreamingMessages(session.messages, true),
      ...(changes.length ? { proposedChanges: changes } : {}),
      updatedAt: stamp(),
    };
  }
  if (event['type'] === 'content_start' && event['contentType'] === 'reasoning') {
    return applyReasoningDelta(session, event);
  }
  if (event['type'] === 'content_start' && event['contentType'] === 'text') {
    return applyTextDelta(session, event);
  }
  if (event['type'] === 'notice' && typeof event['message'] === 'string' && event['message'].trim()) {
    if (isPlanCeiling(session, event['message'])) return session;
    return { ...session, messages: [...session.messages, message('tool', engineeringSystemText(event['message']))], updatedAt: stamp() };
  }
  if (event['type'] === 'content_end' && event['contentType'] === 'reasoning') {
    const index = lastMessageIndex(session.messages, 'reasoning', true);
    if (index < 0) return session;
    const final = typeof event['reasoning'] === 'string' && event['reasoning'].trim() && !session.messages[index]!.redacted
      ? event['reasoning']
      : session.messages[index]!.body;
    return { ...session, messages: updateMessage(session.messages, index, { ...session.messages[index]!, body: final, streaming: false }), updatedAt: stamp() };
  }
  if (event['type'] === 'content_end' && event['contentType'] === 'text' && typeof event['text'] === 'string' && event['text'].trim()) {
    const body = event['text'];
    const collapsed = collapseReasoning(session.messages);
    const index = lastMessageIndex(collapsed, 'assistant', true);
    const messages = index < 0
      ? collapsed.at(-1)?.role === 'assistant' && collapsed.at(-1)?.body === body ? collapsed : [...collapsed, message('assistant', body)]
      : updateMessage(collapsed, index, { ...collapsed[index]!, body, streaming: false });
    return {
      ...session,
      activeActivity: null,
      messages,
      ...(session.mode === 'plan' ? {
        workPlan: body,
        // A well-behaved model normally stops itself before requesting a forbidden
        // Plan-mode mutation. Treat the completed plan as the same structured
        // handoff as a machine-side denial so the user never has to copy a prompt
        // or manually toggle modes just because the model respected the boundary.
        pendingModeHandoff: session.pendingModeHandoff ?? engineeringModeHandoff('edit', 'plan'),
      } : {}),
      updatedAt: stamp(),
    };
  }
  if (event['type'] === 'content_end' && event['contentType'] === 'tool') {
    const toolName = String(event['toolName'] ?? 'tool');
    const changed = toolName === 'editor' || toolName === 'apply_patch';
    const errorText = event['error'] ? textValue(event['error']) : '';
    const planBlocked = isPlanCeiling(session, errorText);
    const detail = event['error'] ? engineeringSystemText(`${toolName} failed · ${errorText}`) : `${toolName} completed`;
    return {
      ...session,
      activeActivity: { phase: 'thinking', startedAt: stamp() },
      changes: changed && !event['error'] ? mergeChanges(session.changes, session.proposedChanges) : session.changes,
      proposedChanges: changed ? [] : session.proposedChanges,
      messages: planBlocked ? session.messages : [...session.messages, message('tool', detail, event['error'] ? 'warning' : 'success')],
      updatedAt: stamp(),
    };
  }
  if (event['type'] === 'done') {
    const body = typeof event['text'] === 'string' ? event['text'] : '';
    const finished = finishStreamingMessages(session.messages, Boolean(body));
    const state = terminalState(event['reason']);
    return { ...session, state, activeActivity: null, pendingApproval: null, messages: body && finished.at(-1)?.body !== body ? [...finished, message('assistant', body, state === 'completed' ? 'success' : 'warning')] : finished, updatedAt: stamp() };
  }
  if (event['type'] === 'error') {
    const error = event['error'] as Record<string, unknown> | undefined;
    if (isPlanCeiling(session, error?.['message'] ?? event['message'])) return session;
    return { ...session, state: event['recoverable'] ? 'resumable' : 'error', activeActivity: null, messages: [...finishStreamingMessages(session.messages, false), message('assistant', engineeringSystemText(String(error?.['message'] ?? 'Engineering encountered an error.')), 'warning')], updatedAt: stamp() };
  }
  return session;
}

/** Project Cline Core's transport events into the stable Engineering UI model. */
export function applyRemoteEngineeringEvent(session: EngineeringSession, wire: Record<string, unknown>): EngineeringSession {
  const type = wire['type'];
  if (type === 'ready') {
    const provider = engineeringSystemText(String(wire['provider']));
    const model = engineeringSystemText(String(wire['model']));
    const brainPack = typeof wire['brainPack'] === 'string' ? wire['brainPack'] : null;
    const modelOverride = typeof wire['modelId'] === 'string' ? wire['modelId'] : null;
    // Runtime readiness is already expressed by the enabled composer and model selector. A
    // transcript receipt made connection setup look like user work and created a noisy one-item
    // task list before the first repository action.
    return { ...session, provider, model, modelOverride, brainPack, updatedAt: stamp() };
  }
  if (type === 'model_changed') {
    const provider = engineeringSystemText(String(wire['provider']));
    const model = engineeringSystemText(String(wire['model']));
    const brainPack = typeof wire['brainPack'] === 'string' ? wire['brainPack'] : null;
    const modelOverride = typeof wire['modelId'] === 'string' ? wire['modelId'] : null;
    return { ...session, provider, model, modelOverride, brainPack, messages: [...session.messages, message('tool', `Model switched · ${provider} · ${modelLabel(model)}`)], updatedAt: stamp() };
  }
  if (type === 'brain_changed') {
    const provider = engineeringSystemText(String(wire['provider']));
    const model = engineeringSystemText(String(wire['model']));
    const brainPack = typeof wire['brainPack'] === 'string' ? wire['brainPack'] : null;
    return { ...session, provider, model, modelOverride: null, brainPack, messages: [...session.messages, message('tool', `Model switched · ${provider} · ${modelLabel(model)}`)], updatedAt: stamp() };
  }
  if (type === 'status') return wire['status'] === 'running'
    ? { ...session, state: 'streaming', activeActivity: session.activeActivity ?? { phase: 'thinking', startedAt: stamp() }, updatedAt: stamp() }
    : session.state === 'streaming' ? { ...session, state: 'idle', activeActivity: null, messages: finishStreamingMessages(session.messages, false), updatedAt: stamp() } : session;
  if (type === 'mode_blocked' && session.mode === 'plan' && (wire['category'] === 'edit' || wire['category'] === 'command')) {
    // A completed implementation plan already carries the stronger edit+verify
    // continuation. Do not downgrade it when the model subsequently probes the
    // verification command and hits the same Plan ceiling.
    if (session.pendingModeHandoff?.category === 'edit' && wire['category'] === 'command') return session;
    return { ...session, pendingModeHandoff: engineeringModeHandoff(wire['category'], String(wire['toolName'] ?? 'tool')), updatedAt: stamp() };
  }
  if (type === 'approval') {
    const category = wire['category'] as PermissionCategory;
    const toolName = String(wire['toolName'] ?? 'tool');
    const changes = remoteChange(toolName, wire['input']);
    const command = toolName === 'run_commands' || toolName === 'fetch_web_content' ? textValue(wire['input']) : undefined;
    return { ...session, state: 'awaiting_approval', activeActivity: null, proposedChanges: changes, pendingApproval: {
      id: String(wire['approvalId']), category,
      title: category === 'edit' ? 'Apply proposed file changes' : category === 'command' ? 'Execute command' : category === 'web' ? 'Fetch web content' : category === 'mcp' ? 'Use MCP tool' : 'Read repository files',
      detail: `${toolName} requested by Engineering`, ...(command ? { command } : {}), ...(changes.length ? { changes } : {}),
      continuation: category === 'edit' ? 'apply' : category === 'command' ? 'verify' : 'inspect',
    }, updatedAt: stamp() };
  }
  if (type === 'error') {
    // Core can project the same Plan ceiling twice: first as the typed
    // mode_blocked handoff and then as a recoverable facade error. The typed
    // event is the user-facing state; surfacing the duplicate error makes a
    // successful read-only Plan look broken and can arrive after `ended`.
    if (isPlanCeiling(session, wire['message'])) return session;
    return { ...session, state: wire['recoverable'] ? 'resumable' : 'error', activeActivity: null, pendingApproval: null, messages: [...finishStreamingMessages(session.messages, false), message('assistant', engineeringSystemText(String(wire['message'] ?? 'Engineering failed.')), 'warning')], updatedAt: stamp() };
  }
  if (type === 'changes' && Array.isArray(wire['changes'])) return { ...session, changes: wire['changes'] as EngineeringChange[], proposedChanges: [], updatedAt: stamp() };
  if (type === 'restored') {
    const checkpoint = session.checkpoints.find((item) => item.id === `cline-run-${String(wire['checkpointRunCount'])}`); const restoredMessages = checkpoint ? session.messages.slice(0, checkpoint.messageCount) : session.messages;
    return { ...session, state: 'resumable', activeActivity: null, pendingModeHandoff: null, pendingApproval: null, proposedChanges: [], changes: checkpoint?.changes.map((change) => ({ ...change })) ?? [], workPlan: checkpoint?.workPlan ?? session.workPlan, messages: [...finishStreamingMessages(restoredMessages, true), message('tool', `Restored checkpoint · run ${String(wire['checkpointRunCount'])}`, 'success')], updatedAt: stamp() };
  }
  if (type === 'ended') return { ...session, state: terminalState(wire['reason']), activeActivity: null, pendingApproval: null, messages: finishStreamingMessages(session.messages, false), updatedAt: stamp() };
  if (type !== 'agent_event') return session;
  const core = wire['event'] as Record<string, unknown> | undefined;
  if (core?.['type'] === 'session_snapshot') return applySnapshot(session, core);
  if (core?.['type'] !== 'agent_event') return session;
  const payload = core['payload'] as Record<string, unknown> | undefined;
  const event = payload?.['event'] as Record<string, unknown> | undefined;
  return event ? applyContentEvent(session, event) : session;
}
