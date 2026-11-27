// Message boards on the bus (docs/design/message-boards-2026-11 §7.6): the four tools for a Codex,
// Gemini or Starter worker turn. they travel as a set, like the web five, and the words and shapes
// come from the one table (toolspec.ts). the work happens in host/messageboards.ts behind
// `host.messageBoards`, which the daemon hands over only when the agent has access to a board. these
// only log and forward: the answer is the service's envelope or a sentence, exactly as it came.
import { z } from 'zod';
import type { BoardMessageKind } from '../host/messageboards';
import { TOOL_SPECS, type SpeccedTool } from './toolspec';
import { text } from './toolbus';
import type { ToolDef } from './toolbus';

const spec = (name: SpeccedTool) => ({ name, description: TOOL_SPECS[name].description, params: TOOL_SPECS[name].params(z) });
const NONE = 'Message boards is not available on this turn.';

export const MESSAGE_BOARD_DEFS: ToolDef[] = [
  {
    ...spec('message_board_list'),
    async run(host) {
      if (!host.messageBoards) return text(NONE);
      host.log?.({ kind: 'tool', phase: 'call', summary: 'message_board_list' });
      return text(await host.messageBoards.list());
    },
  },
  {
    ...spec('message_board_catch_up'),
    async run(host, input) {
      if (!host.messageBoards) return text(NONE);
      host.log?.({ kind: 'tool', phase: 'call', summary: `message_board_catch_up ${String(input['board']).slice(0, 80)} ${String(input['topic']).slice(0, 60)}` });
      return text(await host.messageBoards.catchUp({
        board: String(input['board']), topic: String(input['topic']),
        ...(input['since'] ? { since: String(input['since']) } : {}), ...(input['limit'] ? { limit: Number(input['limit']) } : {}),
      }));
    },
  },
  {
    ...spec('message_board_send'),
    async run(host, input) {
      if (!host.messageBoards) return text(NONE);
      host.log?.({ kind: 'tool', phase: 'call', summary: `message_board_send ${String(input['board']).slice(0, 80)} ${String(input['topic']).slice(0, 60)} (${String(input['kind'])})` });
      return text(await host.messageBoards.send({
        board: String(input['board']), topic: String(input['topic']), kind: input['kind'] as BoardMessageKind, body: String(input['body']),
        ...(input['title'] ? { title: String(input['title']) } : {}), ...(Array.isArray(input['tags']) ? { tags: (input['tags'] as unknown[]).map(String) } : {}),
      }));
    },
  },
  {
    ...spec('message_board_take_handoff'),
    async run(host, input) {
      if (!host.messageBoards) return text(NONE);
      host.log?.({ kind: 'tool', phase: 'call', summary: `message_board_take_handoff ${String(input['messageId']).slice(0, 40)}` });
      return text(await host.messageBoards.takeHandoff({ messageId: String(input['messageId']), ...(input['note'] ? { note: String(input['note']) } : {}) }));
    },
  },
];
