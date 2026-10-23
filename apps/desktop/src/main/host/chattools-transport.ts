import { z } from 'zod';
import { chatToolDefinitions, type ChatToolCtx } from './chattools';
import type { OrchTool } from './orchtools';

/** Reuse the conversation's exact handlers and turn-scoped grounding across providers.
 * No board registry is substituted, and each call is validated before any side effect. */
export function chatTransportTools(context: ChatToolCtx): OrchTool[] {
  return chatToolDefinitions(context).map(definition => ({
    name: definition.name,
    description: definition.description,
    schema: definition.inputSchema,
    run: async (input: unknown) => {
      const result = await definition.handler(z.object(definition.inputSchema).parse(input), {});
      const text = result.content.filter(block => block.type === 'text').map(block => block.text).join('\n');
      if (result.isError) throw new Error(text || `${definition.name} failed`);
      return text;
    },
  }));
}
