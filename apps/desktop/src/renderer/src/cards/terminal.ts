// The Claude Design hand-off a card fires into the workspace terminal (docs/14).

export type ClaudeDesignLaunch = { cwd: string; command: string; taskNumber: number | null };

export const CLAUDE_DESIGN_TERMINAL_EVENT = 'nm:open-claude-design-terminal';

export const openClaudeDesignTerminal = (launch: ClaudeDesignLaunch) =>
  window.dispatchEvent(new CustomEvent<ClaudeDesignLaunch>(CLAUDE_DESIGN_TERMINAL_EVENT, { detail: launch }));
