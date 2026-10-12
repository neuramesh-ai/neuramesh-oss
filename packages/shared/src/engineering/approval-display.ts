import type { EngineeringApproval } from './domain';

/** Presentation only: retain the recorded request and send approval by its original ID. */
export function engineeringApprovalCommands(approval: Pick<EngineeringApproval, 'category' | 'command'>): string[] {
  const raw = approval.command;
  if (!raw) return [];
  if (approval.category === 'command') {
    try {
      const input: unknown = JSON.parse(raw);
      // Only unwrap the known run_commands envelope. Unknown fields or malformed
      // requests stay visible instead of silently dropping part of an approval.
      if (input && typeof input === 'object' && !Array.isArray(input)
        && Object.keys(input).length === 1 && 'commands' in input
        && Array.isArray(input.commands) && input.commands.length > 0
        && input.commands.every((command): command is string => typeof command === 'string' && command.trim().length > 0)) {
        return input.commands;
      }
    } catch { /* Existing plain shell commands are already displayable. */ }
  }
  return [raw];
}
