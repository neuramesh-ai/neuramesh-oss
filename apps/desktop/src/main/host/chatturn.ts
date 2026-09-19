// CHAT MODE (docs/34) — the turn an agent runs when the composer's Tasks toggle is OFF.
//
// Enforced twice, never by prompt: this registry has no create_task in it, and the server
// rejects a task.create naming a chat thread (CHAT_THREAD). A conversation asks in prose
// rather than filing an item in the needs-you queue, so there are no nmq cards here either.
//
// Files land in a per-conversation scratch workspace and render inline; commands run under the
// existing kernel jail and the policy gate. Extracted from agents.ts (track B2).


import { drainQuery, claudeAgentPrompt } from './turnkit';
import { claudePathOption, providerEnv, providerFor, sandboxFsEnabled, type AgentAttachment } from '../runtime/adapter';
import { claudeSandboxOptions, computeFsJail } from '../sandbox/fsjail';
import { ORCH_EMPTY_TURN } from '../replypolicy';
import { type WhiteboardToolClosures } from '../harness/toolbus';



import { runtimeFor, stageConnections, xPublishConnectedFor, xResearchNote } from '../agents';
import { brandNote } from './brandnote';
import type { HostedAgent, SkillRef } from '../agents';
// `chatSystemPrompt` is already taken by the BOARD's chat prompt (runtime/adapter), which says
// the opposite thing ("work moves through the board"), so this one is aliased, not shadowed.
import { chatSystemPrompt as chatModeSystemPrompt } from '../chatmode';
import type { LogFn } from '../agentlog';
import type { RunHandle } from './runs';
import type { HostCtx } from './ctx';
import type { DraftRow } from './orchtools';
import { makeChatSupport } from './chatsupport';
import { makeChatTools } from './chattools';

export function makeChatTurn(ctx: HostCtx & {
  db: import('@powersync/node').PowerSyncDatabase;
  agents: Map<string, HostedAgent>;
  apiGet: (path: string, actor: { kind: string; id: string; role?: string }) => Promise<any>;
  discoverSkills: (channelId: string, workspaceId: string) => Promise<SkillRef[]>;
  draftsForAnchor: (taskId: string | null, threadId: string | null) => Promise<{ posts: DraftRow[]; msgAnchor: { taskId: string } | { threadId: string } } | null>;
  ensureChatWorkspace: (threadId: string) => string;
  generateDraftImage: (agent: HostedAgent, ch: { id: string; slug: string; workspace_id: string }, itemId: string) => Promise<string>;
  generateShareImage: (agent: HostedAgent, ch: { id: string; slug: string; workspace_id: string }, brief: string) => Promise<{ thumb?: string; error?: string }>;
  libraryDocs: import('./grounding').LibraryReader;
  narrate: (run: RunHandle, log: LogFn) => LogFn;
  whiteboardClosures: (actor: { kind: string; id: string; role?: string }, ch: { id: string; workspace_id: string }, at: { taskId?: string; threadId?: string }) => WhiteboardToolClosures;
}) {
const { post, db, agents, apiGet, discoverSkills, draftsForAnchor, ensureChatWorkspace, generateDraftImage, generateShareImage, libraryDocs, narrate, whiteboardClosures } = ctx;
const { defaultResponder, threadModeFor, recallFor, loadSkillBody, chatProtectedPaths, chatPermissionGate, deliverChatFiles } = makeChatSupport({ post, machineId: ctx.machineId, guards: ctx.guards, db, agents, apiGet, discoverSkills });

// ── Chat mode (docs/34): the turn a thread with Tasks OFF runs ────────────────────────────
//
// This is not a smaller orchestrator turn — it is a different job. The board turn's registry
// is board tools with no web access, which is why it has to promise a background run for
// anything it can't answer from memory. Here the agent has the machine: web, files, the
// shell — inside the SAME kernel jail and the SAME policy gate a worker runs under — and it
// answers now. What it does NOT have is any way to touch the board: `create_task` and every
// routing tool are absent from this registry, which is the first of chat mode's two stops
// (the second is the server's CHAT_THREAD floor).
//
// Any agent woken in a chat thread runs this — orchestrator or not — because the mode belongs
// to the thread. Only a Claude runtime gets the tool loop; codex/gemini degrade honestly to a
// conversational turn (logged, never silently passed off as the full thing).
async function chatTurn(args: {
  agent: HostedAgent;
  ch: { id: string; slug: string; workspace_id: string };
  threadId: string;
  transcript: string;
  token: string;
  log: LogFn;
  onDelta: (text: string) => void;
  attachments: AgentAttachment[];
  run: RunHandle;
}): Promise<string> {
  const { agent, ch, threadId, transcript, token, log, onDelta, attachments, run } = args;
  const { mkdirSync } = await import('node:fs');
  // the thread's brain workspace, with any pre-merge `chats/` directory adopted on first use
  const dir = ensureChatWorkspace(threadId);
  const canUseTools = providerFor(agent.runtime) === 'anthropic';
  const system = chatModeSystemPrompt(
    { id: agent.id, name: agent.name, role: agent.role, brief: agent.brief, runtime: agent.runtime },
    ch.slug,
    { canUseTools, workspaceDir: dir },
  ) + await (async () => {
    // the connected account is the read capability (search_x rides the nm registry below)
    const xConn = await xPublishConnectedFor(db, ch);
    return xResearchNote(xConn);
  })() + await stageConnections(db, ch.id).catch(() => '') + await brandNote(db, ch.id).catch(() => '');
  // ^ the room's connected accounts, the same note a content task gets: a marketer asked for
  // creator scripts drafted TikTok for a room whose accounts were X and LinkedIn (live, 2026-09-18),
  // because nothing in a chat turn said which networks this room can reach. And the room's shelf
  // (host/brandnote.ts): the brand docs by name and the head of the business profile, so a turn
  // never tells the human the room has no brand docs while they sit beside the thread (2026-09-19)

  if (!canUseTools) {
    // Honest degradation (docs/34 §6): this runtime has no tool loop through our seam, so it
    // gets a conversational turn and the human is never told it "wrote a file".
    log({ kind: 'tool', phase: 'inject', summary: `chat turn on ${agent.runtime} — conversational only (no file/shell tools on this runtime)` });
    return runtimeFor(agent.runtime).streamTurn(agent, ch.slug, `${system}\n\n${transcript}`, token, log, onDelta, attachments);
  }

  // load_skill was BLIND in chat (2026-08-18 audit, defect A5): the tool was registered but the
  // system prompt injected no skill names, so the model had nothing to pass. One tight line per
  // skill — the tool call pays for the body only when one actually fits.
  const skills = await discoverSkills(ch.id, ch.workspace_id).catch(() => []);
  const skillsNote = skills.length
    ? `\n\nTeam skills — call load_skill with a name when one fits this ask:\n${skills
        .slice(0, 20)
        .map((s) => `- ${s.name}${s.pack_name ? ` (${s.pack_name})` : ''} — ${(s.description ?? '').slice(0, 90)}`)
        .join('\n')}`
    : '';
  if (skills.length) log({ kind: 'tool', phase: 'inject', summary: `chat skills listed: ${Math.min(skills.length, 20)} (${skillsNote.length} chars)` });

  mkdirSync(dir, { recursive: true }); // persistent per thread — a revision edits, never re-writes
  const turnStart = Date.now();
  const { query, tool, createSdkMcpServer } = await import('@anthropic-ai/claude-agent-sdk');
  const { z } = await import('zod');
  const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });

  // The conversation registry (host/chattools.ts) — turn-scoped, so it takes the turn.
  const nm = makeChatTools({ z, tool, createSdkMcpServer, text, agent, ch, threadId, log,
    db, post, apiGet, recallFor, loadSkillBody, whiteboardClosures, draftsForAnchor, generateDraftImage, generateShareImage, libraryDocs });

  const jail = sandboxFsEnabled()
    ? claudeSandboxOptions(computeFsJail({
        worktree: dir,
        userDataDir: (await import('electron')).app.getPath('userData'),
        extraPaths: await chatProtectedPaths(ch.workspace_id),
      }))
    : {};

  const reply = await drainQuery(
    query({
      prompt: claudeAgentPrompt(transcript, attachments),
      options: {
        ...claudePathOption(),
        ...jail,
        env: providerEnv('anthropic', token),
        model: agent.model,
        maxTurns: 24,
        mcpServers: { nm },
        // AVAILABILITY is `tools` (the #1010 lesson — allowedTools only auto-permits). The
        // preset pins the standard toolset; the allowlist is what runs without a prompt.
        tools: { type: 'preset' as const, preset: 'claude_code' as const },
        allowedTools: ['WebSearch', 'WebFetch', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash', 'TodoWrite', 'mcp__nm__recall', 'mcp__nm__load_skill', 'mcp__nm__list_playbooks', 'mcp__nm__create_whiteboard', 'mcp__nm__update_whiteboard', 'mcp__nm__list_whiteboards', 'mcp__nm__read_whiteboard', 'mcp__nm__draft_posts', 'mcp__nm__revise_posts', 'mcp__nm__generate_image', 'mcp__nm__search_x'],
        permissionMode: 'bypassPermissions',
        // the same policy engine a worker runs under — PreToolUse fires even under
        // bypassPermissions, so a shell call in a chat is gated exactly as one in a task
        hooks: {
          PreToolUse: [{
            hooks: [async (input: { hook_event_name?: string; tool_name?: string; tool_input?: unknown }) => {
              if (input.hook_event_name !== 'PreToolUse') return {};
              const g = await chatPermissionGate(agent, ch, threadId, token, String(input.tool_name ?? ''), (input.tool_input ?? {}) as Record<string, unknown>);
              return { hookSpecificOutput: { hookEventName: 'PreToolUse' as const, permissionDecision: g.decision, permissionDecisionReason: g.reason } };
            }],
            timeout: 900,
          }],
        },
        cwd: dir,
        systemPrompt: system + skillsNote,
      },
    }) as AsyncIterable<any>,
    ORCH_EMPTY_TURN,
    narrate(run, log), // a minute-long turn narrates through the ghost the room already paints
    onDelta,
  );

  // Whatever it actually wrote this turn becomes a deliverable, rendered in the thread.
  await deliverChatFiles(agent, ch, threadId, dir, turnStart, log);
  return reply;
}

/**
 * Who answers a thread message that @mentioned nobody (docs/34).
 *
 * In a TASKS thread this stays exactly what it has always been — the room's orchestrator owns
 * intake, and changing that would re-route everybody's work. In a CHAT thread the last agent
 * who spoke keeps the conversation, because that is what "talking to patch" means everywhere
 * else; the orchestrator is the fallback when nobody has spoken yet.
 */


  return { chatTurn, defaultResponder, threadModeFor };
}
