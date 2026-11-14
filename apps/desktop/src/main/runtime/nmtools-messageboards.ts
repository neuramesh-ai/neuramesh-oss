// Message boards on the Claude in-process server (docs/design/message-boards-2026-11 §7.6): the four
// clones of the bus tools, closure-gated like the repository reads (the host hands `messageBoards`
// only when the turn's agent has access to a board), one implementation behind them
// (host/messageboards.ts). the words come from the one table (harness/toolspec.ts). it takes the
// turn's options whole and answers no tool when they hold no access: nmToolServer sits at its
// complexity limit, so the question is asked here.
import type { TurnOpts } from './adapter';
import type { LogFn } from '../agentlog';
import { TOOL_SPECS } from '../harness/toolspec';

type Sdk = typeof import('@anthropic-ai/claude-agent-sdk');
type Zod = typeof import('zod')['z'];
const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });

export function messageBoardClones(opts: Pick<TurnOpts, 'messageBoards'> | undefined, tool: Sdk['tool'], z: Zod, log?: LogFn) {
  const boards = opts?.messageBoards;
  if (!boards) return [];
  return [
    tool('message_board_list', TOOL_SPECS.message_board_list.description, TOOL_SPECS.message_board_list.params(), async () => {
      log?.({ kind: 'tool', phase: 'call', summary: 'message_board_list' });
      return text(await boards.list());
    }),
    tool('message_board_catch_up', TOOL_SPECS.message_board_catch_up.description, TOOL_SPECS.message_board_catch_up.params(z), async (input) => {
      log?.({ kind: 'tool', phase: 'call', summary: `message_board_catch_up ${input.board.slice(0, 80)} ${input.topic.slice(0, 60)}` });
      return text(await boards.catchUp({ board: input.board, topic: input.topic, ...(input.since ? { since: input.since } : {}), ...(input.limit ? { limit: input.limit } : {}) }));
    }),
    tool('message_board_send', TOOL_SPECS.message_board_send.description, TOOL_SPECS.message_board_send.params(z), async (input) => {
      log?.({ kind: 'tool', phase: 'call', summary: `message_board_send ${input.board.slice(0, 80)} ${input.topic.slice(0, 60)} (${input.kind})` });
      return text(await boards.send({ board: input.board, topic: input.topic, kind: input.kind, body: input.body, ...(input.title ? { title: input.title } : {}), ...(input.tags ? { tags: input.tags } : {}) }));
    }),
    tool('message_board_take_handoff', TOOL_SPECS.message_board_take_handoff.description, TOOL_SPECS.message_board_take_handoff.params(z), async (input) => {
      log?.({ kind: 'tool', phase: 'call', summary: `message_board_take_handoff ${input.messageId.slice(0, 40)}` });
      return text(await boards.takeHandoff({ messageId: input.messageId, ...(input.note ? { note: input.note } : {}) }));
    }),
  ];
}
