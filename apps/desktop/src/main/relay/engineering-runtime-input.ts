import { ENGINEERING_DISPLAY_PROMPT, type EngineeringDisplayTool } from './engineering-display';
import { engineeringTitleTool } from './engineering-title';
import { engineeringPlanTool, engineeringProgressTool } from './engineering-plan';
import { ENGINEERING_PLAN_PROGRESS_PROMPT, WEB_PREVIEW_PROMPT, DEFAULT_ENGINEERING_AGENT, engineeringEffort, type EngineeringRuntimeEvent } from '@neuramesh/shared';
import type { ClineCore } from '@cline/sdk';
import { ENGINEERING_CLINE_TOOL_POLICIES, type EngineeringControls, type EngineeringMachineOpenMeta } from '../../engineering-protocol';
import type { EngineeringProviderResolution } from './engineering-provider';

type RuntimeMessages = Awaited<ReturnType<ClineCore['readMessages']>>;
const toolUseInstructions = `Use only tools exposed in the current request. Historical tool calls are context, not a list of available tools; a different model or mode may expose different editing tools. Follow the current tool schemas instead of copying another model's call.
Read repository files with read_files and search with search_codebase, not shell commands. File ranges are inclusive and one-based: start_line and end_line must be positive integers or null/omitted. To read from line 120 through the end, use {"files":[{"path":"src/example.js","start_line":120}]}; never use -1 for end_line. A range or schema error means correct the arguments and retry the file tool, not switch to the terminal.
Preserve the user's command restrictions across turns and model changes. If commands are limited to a named test command, request only that command; do not add pipes, redirections, file inspection, or shell edits. If the available tools cannot perform an operation within those restrictions, explain the blocker instead of requesting a prohibited alternative.`;
/** who the coding agent is and how it works in a thread: every coding lane sends these words */
export const engineeringCorePrompt = (provider: Pick<EngineeringProviderResolution, 'agent' | 'instructions'>): string =>
  `You are ${(provider.agent ?? DEFAULT_ENGINEERING_AGENT).name}, the ${(provider.agent ?? DEFAULT_ENGINEERING_AGENT).role} agent in NeuraMesh. ${provider.instructions ? `Your agent instructions: ${provider.instructions}\n` : ''}` + 'You are working in a coding conversation. When set_thread_title is available, call it once after you understand the first request, using a clean 2–6 word title describing the topic rather than echoing the prompt. Do not rename a conversation that already has a title-tool receipt.  Work only in the supplied workspace. Respect Plan mode as read-only. For function tools, generate complete JSON arguments matching the tool schema. Keep JSON formatting compact; do not emit padding or an unfinished argument object. Use normal prose for conversational replies. For a requested implementation plan, call propose_work_plan with a formal plan and a separate conversational report. In the report, explain in first person what you actually investigated or resolved, the finding that shaped your approach, two or three key choices with reasons and the verification approach, and the next step for the user. Do not simply repeat the plan summary or checklist. Do not claim you changed files or ran checks unless you actually did. The UI displays this report above the plan card, so after the tool succeeds finish with only one short readiness sentence. Ordinary answers and feature ideas do not need that tool. Explain decisions concisely, use tools for repository facts, and for implementation turns finish with what changed and what was verified. Save generated deliverables, images and portable files in .nm-artifacts/ so the thread can restore them on another device. Never place credentials or secrets in that folder. Never expose the implementation harness or its vendor name to the user.';

export function readRuntimeMessages(core: ClineCore, sessionId: string): Promise<RuntimeMessages> {
  return typeof core.readLiveMessages === 'function' ? core.readLiveMessages(sessionId) : core.readMessages(sessionId);
}

/** Native reasoning signatures are not portable between models. Archive them, but replay visible
 * conversation and tool results when a message was produced by another model or provider. */
export function portableRuntimeMessages(messages: RuntimeMessages, provider: string, model: string): RuntimeMessages {
  const portable = messages.map((message) => {
    if (message.modelInfo?.provider === provider && message.modelInfo.id === model) return message;
    if (!Array.isArray(message.content)) return message;
    return { ...message, content: message.content.filter((block) => block.type !== 'thinking' && block.type !== 'redacted_thinking').map((block) => {
      if ('signature' in block) { const { signature: _signature, ...portable } = block; return portable; }
      return block;
    }) };
  }).filter((message) => typeof message.content === 'string' ? !!message.content : message.content.length > 0);
  const result: RuntimeMessages = [];
  const missingResult = 'The previous device did not record a result for this call. Its execution outcome is unknown. Check the current state before any retry. Prior approvals do not grant permission on this device.';
  for (let index = 0; index < portable.length; index++) {
    const message = portable[index]!;
    result.push(message);
    if (message.role !== 'assistant' || !Array.isArray(message.content)) continue;
    const calls = message.content.filter((block) => block.type === 'tool_use');
    if (!calls.length) continue;
    // Parallel calls may finish in separate consecutive user messages. Read the whole result
    // batch before declaring a call interrupted, and emit exactly one result for each call.
    const following: RuntimeMessages = [];
    while (portable[index + 1]?.role === 'user') following.push(portable[++index]!);
    const blocks = following.flatMap((entry) => Array.isArray(entry.content) ? entry.content : []);
    const results = calls.map((call) => {
      const matches = blocks.filter((block) => block.type === 'tool_result').filter((block) => block.tool_use_id === call.id);
      const recorded = matches.filter((block) => !(block.is_error && block.content === missingResult));
      const unique = [...new Map(recorded.map((block) => [JSON.stringify(block), block])).values()];
      if (unique.length === 1) return unique[0]!;
      if (unique.length > 1) return {
        type: 'tool_result' as const, tool_use_id: call.id, name: call.name, is_error: true,
        content: `Conflicting recorded results for this call. Reconcile the current state before retrying. Recorded outcomes: ${JSON.stringify(unique)}`,
      };
      return matches[0] ?? { type: 'tool_result' as const, tool_use_id: call.id, name: call.name, is_error: true, content: missingResult };
    });
    result.push({ role: 'user', content: results });
    const ids = new Set(calls.map((call) => call.id));
    for (const entry of following) {
      if (!Array.isArray(entry.content)) { result.push(entry); continue; }
      const content = entry.content.filter((block) => block.type !== 'tool_result' || !ids.has(block.tool_use_id));
      if (content.length) result.push({ ...entry, content });
    }
  }
  return result;
}

export function engineeringRuntimeInput({
  meta,
  cwd,
  provider,
  modelId,
  brainPack,
  controls,
  prompt,
  initialMessages,
  userImages,
  userFiles,
  emit,
  readPlanMessages,
  readPlanProgress,
  setThreadTitle,
  displayTools = [],
}: {
  meta: EngineeringMachineOpenMeta;
  cwd: string;
  provider: EngineeringProviderResolution;
  modelId: string | null;
  brainPack: string | null;
  controls: EngineeringControls;
  prompt?: string;
  initialMessages?: RuntimeMessages;
  userImages?: string[];
  userFiles?: string[];
  readPlanMessages?: () => Promise<unknown>;
  readPlanProgress?: () => Promise<import('@neuramesh/shared').EngineeringPlanProgress | null>;
  setThreadTitle?: (title: string) => Promise<unknown>;
  displayTools?: EngineeringDisplayTool[];
  emit?: (event: EngineeringRuntimeEvent) => void;
}): Parameters<ClineCore['start']>[0] {
  return {
    source: 'web',
    interactive: true,
    ...(prompt ? { prompt } : {}),
    ...(initialMessages?.length ? { initialMessages: portableRuntimeMessages(initialMessages, provider.providerId, provider.modelId) } : {}),
    ...(userImages?.length ? { userImages } : {}),
    ...(userFiles?.length ? { userFiles } : {}),
    sessionMetadata: {
      neurameshThreadId: meta.threadId,
      repoId: meta.repoId,
      repoName: meta.repoName,
      ...(meta.projectId ? { projectId: meta.projectId } : {}),
      actorId: meta.actorId,
      agent: provider.agent ?? DEFAULT_ENGINEERING_AGENT,
      reasoningEffort: engineeringEffort(modelId, meta.reasoningEffort),
      ...(modelId ? { modelId } : {}),
      ...(brainPack ? { brainPack } : {}),
    },
    // Repository-owned runtime extensions can contain executable hooks and plugins. Code sessions
    // expose only Neuramesh's audited tools, whose side effects pass through policy + sandboxing.
    localRuntime: { configExtensions: [], ...(emit ? { extraTools: [...displayTools, ...(setThreadTitle ? [engineeringTitleTool(setThreadTitle)] : []), ...(controls.mode === 'plan' ? [engineeringPlanTool(emit)] : [engineeringProgressTool(emit, readPlanMessages ?? (async () => initialMessages), readPlanProgress)])] } : {}) },
    config: {
      providerId: provider.providerId,
      modelId: provider.modelId,
      ...(provider.apiKey ? { apiKey: provider.apiKey } : {}),
      ...(provider.baseUrl ? { baseUrl: provider.baseUrl } : {}),
      cwd,
      workspaceRoot: cwd,
      mode: controls.mode,
      // Ask capable brain-pack models for provider-native reasoning. The SDK
      // normalizes these portable controls against each model's advertised
      // options, so unsupported providers simply continue with ordinary text.
      reasoningEffort: engineeringEffort(modelId, meta.reasoningEffort) ?? 'low',
      thinking: true,
      systemPrompt: engineeringCorePrompt(provider) + '\n\n' + toolUseInstructions + '\n\n' + ENGINEERING_PLAN_PROGRESS_PROMPT + '\n\n' + WEB_PREVIEW_PROMPT + '\n\n' + ENGINEERING_DISPLAY_PROMPT,
      maxIterations: 50,
      enableTools: true,
      enableSpawnAgent: false,
      enableAgentTeams: false,
      disableMcpSettingsTools: true,
      checkpoint: { enabled: true },
    },
    toolPolicies: ENGINEERING_CLINE_TOOL_POLICIES,
  };
}

export async function restoreRuntimeCheckpoint(core: ClineCore, sessionId: string, checkpointRunCount: number, cwd: string, start: Parameters<ClineCore['start']>[0]): Promise<string> {
  const result = await core.restore({ sessionId, checkpointRunCount, start, cwd, restore: { workspace: true, messages: true, omitCheckpointMessageFromSession: false } });
  const restoredSessionId = result.startResult?.sessionId ?? result.sessionId;
  if (!restoredSessionId) throw new Error('Engineering restored the checkpoint without starting its resumed session.');
  await core.stop(sessionId).catch(() => {});
  return restoredSessionId;
}
