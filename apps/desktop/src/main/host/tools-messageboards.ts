// Message boards on the orchestrator's belt, in the conversation and in a coding thread
// (docs/design/message-boards-2026-11 §7.6): an agent that a person gave access to a board lists the
// boards, reads a topic, posts a message and takes a handoff. the words come from harness/tooldesc.ts
// and the work from host/messageboards.ts, the same two the worker bus uses, so no surface describes
// or answers a board call differently. the three registries take this one list and wrap each entry
// in their own tool shape.
//
// `messageBoards` is null when the turn's agent has no access: the group is then empty, so that
// agent's prompt carries no board tool at all. the shared catalogue keeps the family off a sweep.
import { toolAvailable, type NmTool, type TurnKind } from '@neuramesh/shared';
import { BOARD_CATCH_UP_DESC, BOARD_LIST_DESC, BOARD_SEND_DESC, BOARD_TAKE_DESC, boardCatchUpParams, boardSendParams, boardTakeParams } from '../harness/tooldesc';
import type { LogFn } from '../agentlog';
import type { BoardMessageKind, MessageBoardTools } from './messageboards';
import type { OrchTool } from './orchtools';

// two transports hand a tool its arguments as the model wrote them, with no schema check (the
// NeuraMesh brain, the CLI bridge): an absent value must read as empty, never as the word "undefined",
// and a list can arrive as JSON text
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));
function tagsOf(v: unknown): string[] | undefined {
  let list: unknown = v;
  if (typeof v === 'string') { try { list = JSON.parse(v); } catch { list = v.split(','); } }
  return Array.isArray(list) ? list.map((t) => str(t).trim()).filter(Boolean) : undefined;
}

export function messageBoardTools(tc: { z: typeof import('zod')['z']; messageBoards?: MessageBoardTools | null; log?: LogFn; kind?: TurnKind }): OrchTool[] {
  const { z, log, kind, messageBoards: boards } = tc;
  if (!boards) return [];
  const tools: OrchTool[] = [
    { name: 'message_board_list', description: BOARD_LIST_DESC, schema: {}, run: async () => {
      log?.({ kind: 'tool', phase: 'call', summary: 'message_board_list' });
      return boards.list();
    } },
    { name: 'message_board_catch_up', description: BOARD_CATCH_UP_DESC, schema: boardCatchUpParams(z), run: async (i: Record<string, unknown>) => {
      log?.({ kind: 'tool', phase: 'call', summary: `message_board_catch_up ${str(i['board']).slice(0, 80)} ${str(i['topic']).slice(0, 60)}` });
      const limit = Number(i['limit']);
      return boards.catchUp({ board: str(i['board']), topic: str(i['topic']), ...(str(i['since']) ? { since: str(i['since']) } : {}), ...(Number.isInteger(limit) && limit > 0 ? { limit } : {}) });
    } },
    { name: 'message_board_send', description: BOARD_SEND_DESC, schema: boardSendParams(z), run: async (i: Record<string, unknown>) => {
      log?.({ kind: 'tool', phase: 'call', summary: `message_board_send ${str(i['board']).slice(0, 80)} ${str(i['topic']).slice(0, 60)} (${str(i['kind']).slice(0, 20)})` });
      const tags = tagsOf(i['tags']);
      return boards.send({ board: str(i['board']), topic: str(i['topic']), kind: str(i['kind']) as BoardMessageKind, body: str(i['body']), ...(str(i['title']) ? { title: str(i['title']) } : {}), ...(tags ? { tags } : {}) });
    } },
    { name: 'message_board_take_handoff', description: BOARD_TAKE_DESC, schema: boardTakeParams(z), run: async (i: Record<string, unknown>) => {
      log?.({ kind: 'tool', phase: 'call', summary: `message_board_take_handoff ${str(i['messageId']).slice(0, 40)}` });
      return boards.takeHandoff({ messageId: str(i['messageId']), ...(str(i['note']) ? { note: str(i['note']) } : {}) });
    } },
  ];
  return kind ? tools.filter((t) => toolAvailable(t.name as NmTool, kind)) : tools;
}
