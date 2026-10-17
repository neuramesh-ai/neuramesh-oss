// the agy lane's pure rules (docs/design/gemini-code-lane-2026-10/plan.md): which agy model, which
// agy mode and which argv a coding session runs. pure, so a test reads every rule without a process.
//
// verified against agy 1.4.0 on 2026-10-16: `--output-format stream-json` streams typed events,
// `--input-format stream-json` with `-p=` keeps one conversation over many stdin turns, `--model`
// takes agy's own ids, `--mode accept-edits` writes inside the workspace and `--mode plan` writes
// nothing there. headless agy refuses its own commands, so commands reach the managed shell over MCP.
import { DEFAULT_THINKING, type EngineeringControls, type ThinkingLevel } from '@neuramesh/shared';

/** agy's model ids carry the thinking level as a suffix (`agy models`). a model agy does not list maps to null */
const AGY_FAMILIES: Record<string, { id: string; levels: readonly ThinkingLevel[] }> = {
  'gemini-4-argon': { id: 'gemini-4-argon', levels: ['low', 'medium', 'high'] },
  'gemini-3.8-flash': { id: 'gemini-3.8-flash', levels: ['low', 'medium', 'high'] },
  'gemini-3.1-pro-preview': { id: 'gemini-3.1-pro', levels: ['low', 'high'] },
};

/** the agy model id for a NeuraMesh model and thinking level, or null when agy has no such model */
export function agyModelFor(modelId: string, effort?: ThinkingLevel | null): string | null {
  const family = AGY_FAMILIES[modelId];
  if (!family) return null;
  const wanted = effort ?? DEFAULT_THINKING;
  // a level the family lacks takes the next one up, so a pick never quietly thinks less
  const level = family.levels.includes(wanted) ? wanted : family.levels.find((l) => l === 'high') ?? family.levels[0]!;
  return `${family.id}-${level}`;
}

export type AgyMode = 'plan' | 'accept-edits' | null;

/** Act with edits that run by themselves maps onto accept-edits. every other case, Plan too, keeps agy's
 *  default mode, where headless agy refuses its own writes and commands (verified live 2026-10-16), and the
 *  nm tools' gate blocks edits and commands in Plan. agy's own plan mode runs its own plan workflow instead
 *  of NeuraMesh's work plan, and once ended a turn with no reply after a refused command */
export function agyModeFor(controls: EngineeringControls): AgyMode {
  if (controls.mode === 'plan') return null;
  return controls.permissions.edit && controls.policy.edit ? 'accept-edits' : null;
}

/** the argv of one long-lived agy process. `-p=` stays last: a bare `-p` takes the next flag as its prompt */
export function agyArgs(o: { model: string | null; mode: AgyMode; conversationId?: string | null; addDirs?: readonly string[] }): string[] {
  return [
    '--input-format', 'stream-json', '--output-format', 'stream-json',
    ...(o.model ? ['--model', o.model] : []),
    ...(o.mode ? ['--mode', o.mode] : []),
    ...(o.conversationId ? ['--conversation', o.conversationId] : []),
    ...(o.addDirs ?? []).flatMap((dir) => ['--add-dir', dir]),
    '-p=',
  ];
}

/** one stdin line: a user turn */
export const agyUserLine = (text: string): string => `${JSON.stringify({ event: 'user', message: { role: 'user', content: text } })}\n`;

/** the NeuraMesh tool behind an agy tool step. agy 1.4.0 calls every MCP tool through its own
 *  `call_mcp_tool` ({ ServerName, ToolName, Arguments }, seen live 2026-10-16), so `init` never lists
 *  them one by one. a name that is already ours passes through */
export function nmToolCall(agyName: string, params: unknown, ours: ReadonlySet<string>): { toolName: string; input: unknown } | null {
  if (agyName === 'call_mcp_tool') {
    const p = params && typeof params === 'object' ? params as Record<string, unknown> : {};
    const tool = p['ToolName'];
    return p['ServerName'] === 'nm' && typeof tool === 'string' && ours.has(tool) ? { toolName: tool, input: p['Arguments'] ?? {} } : null;
  }
  return ours.has(agyName) ? { toolName: agyName, input: params ?? {} } : null;
}

/** agy's denied actions that mean the NeuraMesh tools did not reach the model: it fell back on its
 *  own command tool, or the MCP call itself was refused */
export const nmToolsMissed = (denied: readonly string[]): boolean =>
  denied.some((action) => /^(command|runcommand|mcp|callmcptool)$/i.test(action.replace(/[\s_-]/g, '')));

/** agy's own tools that change files: the diff refreshes after each one */
export const AGY_EDIT_TOOLS: ReadonlySet<string> = new Set(['write_to_file', 'replace_file_content', 'multi_replace_file_content', 'sed_file', 'notebook_edit', 'editor', 'apply_patch']);
