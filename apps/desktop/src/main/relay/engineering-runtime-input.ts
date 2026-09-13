import type { ClineCore } from '@cline/sdk';
import { ENGINEERING_CLINE_TOOL_POLICIES, type EngineeringControls, type EngineeringMachineOpenMeta } from '../../engineering-protocol';
import type { EngineeringProviderResolution } from './engineering-provider';

type RuntimeMessages = Awaited<ReturnType<ClineCore['readMessages']>>;

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
}): Parameters<ClineCore['start']>[0] {
  return {
    source: 'web',
    interactive: true,
    ...(prompt ? { prompt } : {}),
    ...(initialMessages?.length ? { initialMessages } : {}),
    ...(userImages?.length ? { userImages } : {}),
    ...(userFiles?.length ? { userFiles } : {}),
    sessionMetadata: {
      neurameshThreadId: meta.threadId,
      repoId: meta.repoId,
      repoName: meta.repoName,
      ...(meta.projectId ? { projectId: meta.projectId } : {}),
      actorId: meta.actorId,
      ...(modelId ? { modelId } : {}),
      ...(brainPack ? { brainPack } : {}),
    },
    // Repository-owned runtime extensions can contain executable hooks and plugins. Code sessions
    // expose only Neuramesh's audited tools, whose side effects pass through policy + sandboxing.
    localRuntime: { configExtensions: [] },
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
      reasoningEffort: 'low',
      thinking: true,
      systemPrompt: 'You are the coding agent inside Neuramesh Engineering. Work only in the supplied workspace. Respect Plan mode as read-only. Explain decisions concisely, use tools for repository facts, and finish with what changed and what was verified. Never expose the implementation harness or its vendor name to the user.',
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
