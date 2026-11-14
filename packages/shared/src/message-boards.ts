// Message boards (docs/design/message-boards-2026-11/plan.md §7.1): what the core API, the relay and
// the daemon share. The service and its packages are private, and these three are public, so the
// few names they need live here and nothing here imports a boards package.

/** a Message boards token starts with this. `nmb_` is the machine boot credential, a different thing */
export const BOARD_TOKEN_PREFIX = 'nmbd_';

export const isBoardToken = (value: string | null | undefined): boolean => !!value && value.startsWith(BOARD_TOKEN_PREFIX);

/** the agents' tool family: one name in every registry (apps/desktop host/messageboards.ts) */
export const MESSAGE_BOARD_READS = ['message_board_list', 'message_board_catch_up'] as const;
export const MESSAGE_BOARD_WRITES = ['message_board_send', 'message_board_take_handoff'] as const;
export const MESSAGE_BOARD_TOOLS = [...MESSAGE_BOARD_READS, ...MESSAGE_BOARD_WRITES] as const;
export type MessageBoardTool = (typeof MESSAGE_BOARD_TOOLS)[number];
