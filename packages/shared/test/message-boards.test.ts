// What the core API, the relay and the daemon share about Message boards (src/message-boards.ts).
//   pnpm test message-boards
import { describe, expect, it } from 'vitest';
import { NM_TOOLS } from '../src/harness';
import { BOARD_TOKEN_PREFIX, MESSAGE_BOARD_READS, MESSAGE_BOARD_TOOLS, MESSAGE_BOARD_WRITES, isBoardToken } from '../src/message-boards';
import { NM_VERBS } from '../src/runs';

describe('the Message boards names', () => {
  // packages/relay carries no workspace package (its image copies the relay alone), so hub.ts
  // spells this prefix as a literal. A change here must change that line too
  it('the token prefix is nmbd_, and a machine boot credential (nmb_) is not a board token', () => {
    expect(BOARD_TOKEN_PREFIX).toBe('nmbd_');
    expect(isBoardToken(`nmbd_${'a'.repeat(8)}_${'b'.repeat(36)}`)).toBe(true);
    expect(isBoardToken('nmbd_x')).toBe(true);
    for (const other of [`nmb_${'ab'.repeat(32)}`, `nmm_${'c'.repeat(48)}`, `nmh_${'d'.repeat(48)}`, 'eyJhbGciOiJSUzI1NiJ9.x.y', '', null, undefined]) {
      expect(isBoardToken(other)).toBe(false);
    }
  });

  it('the four tools are in the shared catalogue, each with its words', () => {
    expect([...MESSAGE_BOARD_TOOLS]).toEqual(['message_board_list', 'message_board_catch_up', 'message_board_send', 'message_board_take_handoff']);
    expect([...MESSAGE_BOARD_READS, ...MESSAGE_BOARD_WRITES]).toEqual([...MESSAGE_BOARD_TOOLS]);
    for (const tool of MESSAGE_BOARD_TOOLS) {
      expect(NM_TOOLS).toContain(tool);
      expect(NM_VERBS[tool]?.verb, tool).toBeTruthy();
    }
  });
});
