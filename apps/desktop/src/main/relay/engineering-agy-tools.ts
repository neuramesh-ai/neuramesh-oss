// the NeuraMesh tools a Gemini sign-in thread reaches over the loopback MCP bridge (runtime/orchmcp.ts):
// the managed shell, web, editor and patch tools the Cline lane runs (createDefaultTools over
// engineering-tools.ts executors), and NeuraMesh's own plan, title and display tools. every call
// passes the same gate as the Cline lane (requestEngineeringApproval): Plan blocks edits and
// commands, the chip decides auto or ask, and workspace policy can deny.
import type { ToolApprovalRequest, ToolExecutors } from '@cline/sdk';
import type { PolicyRule } from '@neuramesh/shared';
import type { EngineeringControls, EngineeringRuntimeEvent } from '../../engineering-protocol';
import type { BridgeTool } from '../runtime/orchmcp';
import { requestEngineeringApproval } from './engineering-approvals';

/** a tool the lane offers: execute takes the validated input only */
export interface AgyLaneTool { name: string; description: string; inputSchema: Record<string, unknown>; execute(input: unknown): Promise<unknown> }

/** host-owned metadata tools: they write no file and run no command, as in ENGINEERING_CLINE_TOOL_POLICIES */
export const AGY_UNGATED_TOOLS: ReadonlySet<string> = new Set(['set_thread_title', 'propose_work_plan', 'update_plan_progress']);

type CreateDefaultTools = typeof import('@cline/sdk').createDefaultTools;

/** the managed tools for this mode. agy reads the workspace with its own tools, and in accept-edits it
 *  edits with its own tools too, so the managed editor and patch tools ride only when edits need a gate */
export function agyManagedTools(createDefaultTools: CreateDefaultTools, executors: ToolExecutors, cwd: string, nativeEdits: boolean): AgyLaneTool[] {
  const tools = createDefaultTools({
    executors, cwd,
    enableReadFiles: false, enableSearch: false, enableBash: true, enableWebFetch: true,
    enableEditor: !nativeEdits, enableApplyPatch: !nativeEdits,
    enableSkills: false, enableAskQuestion: false, enableSubmitAndExit: false,
  });
  let call = 0;
  return tools.map((tool) => ({
    name: tool.name, description: tool.description, inputSchema: tool.inputSchema,
    execute: async (input: unknown) => tool.execute(input, { agentId: 'agy', iteration: 0, toolCallId: `agy-managed-${++call}` }),
  }));
}

/** the lane's tools as bridge tools. a declined or refused call answers the model with the reason */
export function agyBridgeTools(o: {
  tools: readonly AgyLaneTool[];
  threadId: string;
  controls: () => EngineeringControls;
  policyRules: readonly PolicyRule[];
  pending: Map<string, (approved: boolean) => void>;
  emit: (event: EngineeringRuntimeEvent) => void;
  record: (type: string, payload: unknown) => void;
  cwd: string;
  isActive: () => boolean;
  /** a successful call's output: plan receipts are journaled from here */
  onResult?: (toolName: string, toolCallId: string, output: unknown) => void;
  /** any call at all: proof that the nm tools reached the model */
  onCall?: (toolName: string) => void;
}): BridgeTool[] {
  let serial = 0;
  return o.tools.map((tool) => ({
    name: tool.name, description: tool.description, inputSchema: tool.inputSchema,
    run: async (input: unknown): Promise<string> => {
      o.onCall?.(tool.name);
      const toolCallId = `agy-tool-${Date.now().toString(36)}-${++serial}`;
      if (!AGY_UNGATED_TOOLS.has(tool.name)) {
        const request: ToolApprovalRequest = {
          sessionId: o.threadId, agentId: 'agy', conversationId: o.threadId, iteration: 0,
          toolCallId, toolName: tool.name, input,
          policy: { enabled: true, autoApprove: false },
        };
        const verdict = await requestEngineeringApproval(request, o.controls(), [...o.policyRules], o.pending, o.emit, o.record, o.cwd, o.isActive);
        if (!verdict.approved) return JSON.stringify({ error: verdict.reason ?? 'Declined in Neuramesh' });
      }
      try {
        const output = await tool.execute(input);
        o.record('tool.result', { toolName: tool.name, ok: true });
        o.onResult?.(tool.name, toolCallId, output);
        return typeof output === 'string' ? output : JSON.stringify(output ?? null);
      } catch (error) {
        o.record('tool.result', { toolName: tool.name, ok: false });
        return JSON.stringify({ error: error instanceof Error ? error.message : String(error) });
      }
    },
  }));
}
