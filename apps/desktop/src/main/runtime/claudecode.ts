// THE CLAUDE RUNTIME — real execution through the Agent SDK.
//
// The SDK works with file + shell tools inside the task's git worktree (repo-backed) or a
// scratch workspace (repo-less — produced files submit as artifacts). Git stays host-owned:
// the agent never commits.
//
// Split out of agents.ts, where it was the largest single function (~340 lines). It moved
// WHOLE and unchanged: it closes over nothing in agents.ts — every binding it uses is an
// import — and it has exactly one consumer, the `runQuery` seat on the anthropic adapter.
import { CLAUDE_DESIGN_MCP_URL } from '@neuramesh/shared';
import { nmToolServer } from './nmtools';
import { createBeatRun } from '../beats';
import { drainQuery, instructionsFor } from '../host/turnkit';
import { buildCodingPrompt, claudePathOption, codingSystemPrompt, providerEnv, sandboxFsEnabled, type PermissionGate, type PromptOverride, type TurnOpts } from '../runtime/adapter';
import { claudeSandboxOptions, computeFsJail } from '../sandbox/fsjail';
// type-only, so the agents.ts ⇄ here edge is erased at compile time
import type { ExecTask, HostedAgent, SkillRef } from '../agents';
import type { LogFn } from '../agentlog';

// Real execution: the SDK works with file + shell tools inside the task's
// git worktree (repo-backed) or a scratch workspace (repo-less — produced
// files submit as artifacts). Git stays host-owned: the agent never commits.
export async function claudeCode(
  agent: HostedAgent,
  t: ExecTask,
  dir: string,
  token: string,
  channelBlock: string | null | undefined,
  repoBacked: boolean,
  ac?: AbortController,
  log?: LogFn,
  skills?: SkillRef[],
  proposeSkill?: (input: { name: string; description: string; scope: 'channel' | 'global'; body: string }) => Promise<{ ok: boolean; error?: string }>,
  reworkNotes?: string,
  attachmentsNote?: string,
  recordLesson?: (input: { lesson: string }) => Promise<{ ok: boolean; error?: string }>,
  lessonsNote?: string,
  promptOverride?: PromptOverride,
  addBacklogItem?: (input: { title: string; description?: string; parent?: boolean }) => Promise<{ ok: boolean; number?: number; error?: string }>,
  beats?: { declare: (items: string[]) => Promise<void>; advance: (seq: number, status: string) => Promise<void> },
  permissionGate?: PermissionGate,
  protectedPaths?: string[],
  opts?: TurnOpts,
): Promise<string> {
  const { query } = await import('@anthropic-ai/claude-agent-sdk');
  // The worker's plan → beats (docs/17), coordinated by createBeatRun with two write
  // paths and first-declare-wins: the explicit nm declare_beats/advance_beat tools
  // (the runtime-OWNED primary — the #1010 lesson: TodoWrite silently vanished from
  // the SDK's default toolset, so beats must never depend on harness tool policy),
  // and the native TodoWrite mapping when the model uses todos instead. Writes are
  // serialized + best-effort (a beats hiccup never disturbs the run). The design turn
  // (promptOverride) is not a board phase the worker owns → no beats there.
  const beatRun = beats && !promptOverride ? createBeatRun(beats) : null;
  const onTodos = beatRun ? (todos: Array<{ content?: string; status?: string }>) => beatRun.absorbTodos(todos) : undefined;;

  // native, fast HTML→PNG so agents validate MORE, not less — no Rosetta Chrome
  // fight. The PNG lands in the workspace (auto-attached as a screenshot
  // artifact for the human) AND is returned so the agent SEES its own render.
  const nm = await nmToolServer({ dir, log, skills, proposeSkill, recordLesson, addBacklogItem, opts, beatRun });

  // Containment L1b (flag-gated NM_SANDBOX_FS): run the worker's Claude under its native sandbox
  // (Seatbelt on macOS / bubblewrap on Linux), jailing reads of credential stores + NeuraMesh's own
  // userData (auth token + replica) at the KERNEL — the evasion-proof backstop under the PreToolUse
  // cred-read heuristic, and the layer that also covers non-hook access paths. Fail-open
  // (failIfUnavailable:false): if the sandbox can't initialize, the agent still runs.
  const claudeSandbox = sandboxFsEnabled()
    ? claudeSandboxOptions(computeFsJail({ worktree: dir, userDataDir: (await import('electron')).app.getPath('userData'), extraPaths: protectedPaths }))
    : {};
  const summary = await drainQuery(
      query({
        // ONE authoritative turn: composed from defaults/agents/worker.yaml exactly like the CLI
        // runtimes (2026-08-18 — the inline literal here had drifted AHEAD of the contract that
        // claimed to be the single copy; its extra guidance now lives in the contract's blocks).
        // hasNmTools is always true on this path: the nm server below is unconditionally mounted.
        prompt: promptOverride?.prompt ?? buildCodingPrompt(t, channelBlock, repoBacked, skills, reworkNotes, attachmentsNote, lessonsNote, null, true),
        options: {
          ...claudePathOption(),
          ...claudeSandbox,
          env: providerEnv('anthropic', token),
          model: agent.model,
          maxTurns: 30,
          ...(ac ? { abortController: ac } : {}),
          mcpServers: {
            nm,
            ...(promptOverride?.claudeDesign
              ? { 'claude-design': { type: 'http' as const, url: CLAUDE_DESIGN_MCP_URL } }
              : {}),
          },
          // AVAILABILITY is `tools` (the #1010 lesson: allowedTools is only the
          // auto-permission list — TodoWrite was allowed but never AVAILABLE, because
          // the SDK's default base toolset omits it). The claude_code preset pins the
          // full standard toolset explicitly instead of renting per-version defaults.
          tools: { type: 'preset' as const, preset: 'claude_code' as const },
          allowedTools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash', 'TodoWrite', 'mcp__nm__screenshot', 'mcp__nm__load_skill', 'mcp__nm__propose_skill', 'mcp__nm__record_lesson', 'mcp__nm__add_backlog_item', ...(promptOverride?.claudeDesign ? ['mcp__claude-design__*'] : []), ...(beatRun ? ['mcp__nm__declare_beats', 'mcp__nm__advance_beat'] : []), ...(opts?.spawn ? ['mcp__nm__spawn'] : []), ...(opts?.park ? ['mcp__nm__park'] : []), ...(opts?.whiteboards ? ['mcp__nm__create_whiteboard', 'mcp__nm__update_whiteboard', 'mcp__nm__list_whiteboards', 'mcp__nm__read_whiteboard'] : []), ...(opts?.searchX ? ['mcp__nm__search_x'] : []), ...(opts?.draftReplies ? ['mcp__nm__draft_replies'] : []), ...(opts?.repo ? ['mcp__nm__list_repo_changes', 'mcp__nm__read_repo_file', 'mcp__nm__list_repo_files'] : [])],
          permissionMode: 'bypassPermissions',
          // The policy gate (agent permission engine, Phase 1). PreToolUse fires even under
          // bypassPermissions and sees every tool; the gate maps the call, evaluates policy,
          // and resolves `ask` by awaiting a human — returning allow/deny (fail-closed).
          ...(permissionGate
            ? {
                hooks: {
                  PreToolUse: [
                    {
                      hooks: [
                        async (input: { hook_event_name?: string; tool_name?: string; tool_input?: unknown }) => {
                          if (input.hook_event_name !== 'PreToolUse') return {};
                          const g = await permissionGate(String(input.tool_name ?? ''), (input.tool_input ?? {}) as Record<string, unknown>);
                          return { hookSpecificOutput: { hookEventName: 'PreToolUse' as const, permissionDecision: g.decision, permissionDecisionReason: g.reason } };
                        },
                      ],
                      timeout: 900,
                    },
                  ],
                },
              }
            : {}),
          cwd: dir,
          systemPrompt: promptOverride?.system ?? codingSystemPrompt(agent.name, repoBacked, instructionsFor(agent)),
        },
      }) as AsyncIterable<any>,
      '(no summary)',
      log,
      undefined,
      onTodos,
  );
  // let the last beat writes land before the phase can transition on submit
  // (a beat write needs the worker to still own in_progress); best-effort, never blocks the result.
  // closeOut ALSO retires whatever step was in flight — settle() only flushed writes, so a run that
  // ended with a beat still `active` left it spinning long after the task reached in_review.
  await beatRun?.closeOut();
  return summary;
}
