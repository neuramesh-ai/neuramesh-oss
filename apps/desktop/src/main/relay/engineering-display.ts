import { publishConversationArtifact, withConversationBrain } from '../harness/brain-sync';
import { z, type ZodRawShape } from 'zod';
import { DEFAULT_ENGINEERING_AGENT, type EngineeringAgent } from '@neuramesh/shared';
import { allToolDefs } from '../harness/toolbus';
import { jsonSchemaFor } from '../harness/toolschema';
import { articleChatTool, imagesChatTool } from '../host/chattools-share';
import { makeWbClosures } from '../host/wbclosures';
import type { EngineeringConversation } from './engineering-conversation';

export interface EngineeringDisplayTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute(input: unknown): Promise<unknown>;
}
export interface EngineeringDisplayContext {
  id: string; slug: string; workspace_id: string;
  shareImage?: (agent: EngineeringAgent, brief: string) => Promise<{ thumb?: string; error?: string }>;
}

/** Adapter only: existing NeuraMesh display definitions keep their schemas and execution. The
 * host supplies the authenticated thread/room, never a model-controlled destination or actor. */
export function engineeringDisplayTools(o: {
  apiUrl: string; threadId: string; cwd: string;
  headers: () => Promise<Record<string, string>>;
  context?: EngineeringDisplayContext | null;
  conversation?: EngineeringConversation;
  fetchImpl?: typeof fetch;
}, selected?: EngineeringAgent): EngineeringDisplayTool[] {
  const agent = selected ?? DEFAULT_ENGINEERING_AGENT;
  const tools: EngineeringDisplayTool[] = [];
  if (o.conversation) tools.push({
    name: 'show_artifact',
    description: 'Publish an existing deliverable from .nm-artifacts/ to this thread. Images, video, audio, PDF, HTML and text can open in the right pane; other files can be downloaded. Call after creating and checking the file, before your final handoff. The returned Markdown link opens the saved artifact. Do not claim delivery if this fails. This does not create or modify the source file.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['path'], properties: { path: { type: 'string', minLength: 1, maxLength: 1024, description: 'File path within .nm-artifacts/, including any subfolder.' } } },
    execute: async input => {
      const { path } = z.object({ path: z.string().min(1).max(1024) }).strict().parse(input);
      const artifact = await o.conversation!.publishArtifact(path);
      const href = artifact.name.split('/').map(part => encodeURIComponent(part).replace(/\(/g, '%28').replace(/\)/g, '%29')).join('/');
      return { saved: true, ...artifact, markdown: `[${artifact.name.replace(/[\[\]\\]/g, '\\$&')}](.nm-artifacts/${href})` };
    },
  });
  if (!o.context) return tools;
  const actor = { kind: 'agent', id: agent.id, role: agent.role };
  const request = async (path: string, body?: unknown) => (o.fetchImpl ?? fetch)(`${o.apiUrl}${path}`, {
    headers: { ...await o.headers(), 'x-nm-actor': JSON.stringify(actor), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000),
  });
  const post = async (path: string, _actor: unknown, body: unknown) => {
    const portable = o.conversation ? await withConversationBrain(o.conversation.brain, async () => publishConversationArtifact(path, body, actor)) : null;
    if (portable) { await o.conversation!.brain.flush(); return portable; }
    return request(path, body);
  };
  const whiteboards = makeWbClosures({ apiUrl: o.apiUrl, post, get: path => request(path) }).whiteboardClosures(actor, o.context, { threadId: o.threadId });
  for (const def of allToolDefs().filter(def => ['create_whiteboard', 'update_whiteboard', 'list_whiteboards', 'read_whiteboard'].includes(def.name))) tools.push({
    name: def.name, description: def.description, inputSchema: jsonSchemaFor(def.params),
    execute: async input => def.run({ dir: o.cwd, whiteboards }, z.object(def.params).strict().parse(input)),
  });
  // The Claude-shaped declaration is adapted to the coding SDK without loading a second model.
  const declaration = {
    z, agent: agent as Parameters<typeof articleChatTool>[0]['agent'], ch: o.context, threadId: o.threadId, post, log: () => {},
    text: (text: string) => ({ content: [{ type: 'text' as const, text }] }),
    tool: ((name: string, description: string, params: ZodRawShape, execute: (input: Record<string, unknown>, extra: Record<string, never>) => Promise<unknown>) => {
      tools.push({ name, description, inputSchema: jsonSchemaFor(params), execute: async input => execute(z.object(params).strict().parse(input), {}) });
      return {};
    }) as unknown as Parameters<typeof articleChatTool>[0]['tool'],
  };
  articleChatTool(declaration);
  if (o.context.shareImage) imagesChatTool({ ...declaration, generateShareImage: (_agent, _channel, brief) => o.context!.shareImage!(agent, brief) });
  return tools;
}

export const ENGINEERING_DISPLAY_PROMPT = `Use NeuraMesh's display tools for deliverables: show_artifact publishes a file and returns its actual clickable Markdown link; draft_article delivers a reading card; create_whiteboard delivers an editable diagram; share_images generates and displays image attachments. Use existing read/update tools to revise a whiteboard. These are the same NeuraMesh surfaces used in other conversations. Never invent artifact IDs or claim a display tool succeeded when it failed.
Save portable output files under .nm-artifacts/. Keep installed dependencies, caches and intermediate frames outside that folder. Each saved file must be at most 16 MB; compress or split larger deliverables and explain any remaining limitation. Call show_artifact for each final deliverable and include its returned link in your reply. No extra server is needed for local media or documents. Web preview cards are for actual running web URLs, not local file paths.`;
