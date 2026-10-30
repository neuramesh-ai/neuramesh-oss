import { randomUUID } from 'node:crypto';
import type { OrchTool } from '../host/orchtools';
import { bindConversationCallback, captureConversationRecorder, conversationContext, excludeConversationSecret, recordConversationEvent } from '../harness/brain-sync';
import type { RuntimeAdapter } from './adapter';

/** Records the portable input without the token that authenticates a model call. */
export function conversationInput(provider: string, model: string, system: string, prompt: string, token?: string): string {
  excludeConversationSecret(token);
  const input = prompt + conversationContext(prompt);
  recordConversationEvent('model.input', { provider, model, system, prompt: input });
  return input;
}

/** Complete SDK records precede any display truncation or event projection. */
export function recordRuntimeEvent(provider: string, event: any): void {
  recordConversationEvent('runtime.event', { provider, event });
  if (provider === 'claude') {
    for (const block of event.message?.content ?? []) {
      if (event.type === 'assistant' && block.type === 'text' && !event.parent_tool_use_id) recordConversationEvent('assistant.message', { text: block.text });
      if (block.type === 'tool_use') recordConversationEvent('tool.call', { id: block.id, name: block.name, input: block.input });
      if (block.type === 'tool_result') recordConversationEvent('tool.result', { id: block.tool_use_id, output: block.content, isError: block.is_error });
    }
  }
  if (provider === 'codex') {
    const item = event.item;
    if (event.type === 'item.completed' && item?.type === 'agent_message') recordConversationEvent('assistant.message', { text: item.text });
    if (event.type === 'item.started' && ['mcp_tool_call', 'command_execution', 'web_search'].includes(item?.type)) recordConversationEvent('tool.call', item);
    if (event.type === 'item.completed' && ['mcp_tool_call', 'command_execution', 'file_change', 'web_search'].includes(item?.type)) recordConversationEvent('tool.result', item);
  }
}

const adapters = new WeakMap<RuntimeAdapter, RuntimeAdapter>();
export function recordedRuntime(adapter: RuntimeAdapter, provider: string): RuntimeAdapter {
  const found = adapters.get(adapter);
  if (found) return found;
  const recorded: RuntimeAdapter = {
    async streamTurn(agent, channel, transcript, token, ...rest) {
      const input = conversationInput(provider, agent.model, '', transcript, token);
      const answer = await adapter.streamTurn(agent, channel, input, token, ...rest);
      recordConversationEvent('assistant.message', { text: answer, provider, model: agent.model });
      return answer;
    },
    async complete(system, user, token, model, maxTokens) {
      const input = conversationInput(provider, model, system, user, token);
      const answer = await adapter.complete(system, input, token, model, maxTokens);
      recordConversationEvent('assistant.message', { text: answer, provider, model });
      return answer;
    },
    async runQuery(...args) {
      excludeConversationSecret(args[3]);
      recordConversationEvent('model.input', { provider, model: args[0].model, task: args[1], channel: args[4], prompt: args[14] });
      const answer = await adapter.runQuery(...args);
      recordConversationEvent('assistant.message', { text: answer, provider, model: args[0].model });
      return answer;
    },
  };
  adapters.set(adapter, recorded);
  return recorded;
}

export function recordedTools(tools: OrchTool[]): OrchTool[] {
  const record = captureConversationRecorder();
  return tools.map((tool) => ({ ...tool, run: bindConversationCallback(async (input: unknown) => {
    const id = randomUUID();
    record('tool.call', { id, name: tool.name, input });
    try { const output = await tool.run(input); record('tool.result', { id, name: tool.name, output, ok: true }); return output; }
    catch (error) { record('tool.result', { id, name: tool.name, output: error instanceof Error ? error.message : String(error), ok: false }); throw error; }
  }) }));
}
