import { isCompactCommand } from './compact-command';
import { conversationContext, conversationToolsThrough, setConversationHistoryBoundary, withoutConversationBrain } from '../harness/brain-sync';
import { agentHomeTranscript } from './team-context';
import { STARTER_MODEL } from '@neuramesh/shared';
import { bindConversationCallback } from '../harness/brain-sync';
// CHAT MODE (docs/34) — the turn an agent runs when the composer's Tasks toggle is OFF.
//
// Enforced twice, never by prompt: this registry has no create_task in it, and the server
// rejects a task.create naming a chat thread (CHAT_THREAD). A conversation asks in prose
// rather than filing an item in the needs-you queue, so there are no nmq cards here either.
//
// Files land in a per-conversation scratch workspace and render inline; commands run under the
// existing kernel jail and the policy gate. Extracted from agents.ts (track B2).


import { drainQuery, claudeAgentPrompt, partialMessages } from './turnkit';
import { claudePathOption, providerEnv, providerFor, sandboxFsEnabled, type AgentAttachment } from '../runtime/adapter';
import { claudeEffort } from '../runtime/thinking';
import { claudeSandboxOptions, computeFsJail } from '../sandbox/fsjail';
import { ORCH_EMPTY_TURN } from '../replypolicy';
import { type WhiteboardToolClosures } from '../harness/toolbus';



import { runtimeFor, stageConnections, xPublishConnectedFor, xResearchNote } from '../agents';
import { brandNote } from './brandnote';
import { projectNote } from './projectnote';
import type { HostedAgent, SkillRef } from '../agents';
// `chatSystemPrompt` is already taken by the BOARD's chat prompt (runtime/adapter), which says
// the opposite thing ("work moves through the board"), so this one is aliased, not shadowed.
import { chatSystemPrompt as chatModeSystemPrompt } from '../chatmode';
import type { LogFn } from '../agentlog';
import type { RunHandle } from './runs';
import type { HostCtx } from './ctx';
import type { DraftRow } from './orchtools';
import type { DrawOutcome } from './drawdraft';
import { makeChatSupport } from './chatsupport';
import { makeChatTools } from './chattools';
import { chatTransportTools } from './chattools-transport';
import { codexSdkOrchestratorTurn, geminiDispatch } from './orchturn';
import { WEB_TOOL_NAMES } from '../runtime/nmtools-web';
import { browserService } from '../browser/registry';
import { conversationInput } from '../runtime/brain-recording';

export function makeChatTurn(ctx: HostCtx & {
  apiUrl: string; ownerActorId: string;
  db: import('@neuramesh/client-core/replica').ReplicaDatabase;
  agents: Map<string, HostedAgent>;
  apiGet: (path: string, actor: { kind: string; id: string; role?: string }) => Promise<any>;
  discoverSkills: (channelId: string, workspaceId: string) => Promise<SkillRef[]>;
  draftsForAnchor: (taskId: string | null, threadId: string | null) => Promise<{ posts: DraftRow[]; msgAnchor: { taskId: string } | { threadId: string } } | null>;
  ensureChatWorkspace: (threadId: string) => string;
  generateDraftImage: (agent: HostedAgent, ch: { id: string; slug: string; workspace_id: string }, itemId: string) => Promise<DrawOutcome>;
  generateShareImage: (agent: HostedAgent, ch: { id: string; slug: string; workspace_id: string }, brief: string) => Promise<{ thumb?: string; bytes?: Buffer; error?: string }>;
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
// to the thread. Claude, Codex and Gemini share the same project tools; unsupported runtimes
// explicitly report their conversational-only capability.
async function chatTurn(args: {
  agent: HostedAgent;
  ch: { id: string; slug: string; workspace_id: string };
  threadId: string;
  transcript: string;
  request?: { body: string; author_kind: string };
  token: string;
  log: LogFn;
  onDelta: (text: string, thinking?: string) => void;
  attachments: AgentAttachment[];
  run: RunHandle;
}): Promise<string> {
  const { agent, ch, threadId, token, log, onDelta, attachments, run } = args;
  let transcript = args.transcript;
  const home = await db.get<{ home_agent_id: string | null }>('select home_agent_id from threads where id = ?', [threadId]);
  const manualCompact = !!args.request && isCompactCommand(args.request.body, args.request.author_kind, agent.name);
  if (manualCompact && attachments.length) return 'Send /compact on its own, without attachments. Your conversation has not been changed.';
  let compactMode: 'manual' | 'auto' = manualCompact ? 'manual' : 'auto';
  let checkedPressure = false;
  let compacted = false;
  {
    const actor = { kind: 'agent', id: agent.id, role: agent.role };
    const continued = await agentHomeTranscript({
      read: async () => {
        const read = async () => { const res: Response = await apiGet(`/v1/team/context?workspace=${ch.workspace_id}&threadId=${threadId}&mode=${compactMode}`, actor); if (!res.ok) throw new Error(`Could not restore the agent thread (${res.status}).`); return res.json() as Promise<import('@neuramesh/shared').TeamContext>; };
        const context = await read();
        setConversationHistoryBoundary(context.compactedThroughAt);
        if (!checkedPressure && !manualCompact) {
          checkedPressure = true;
          if (conversationContext().length > 128000) { compactMode = 'manual'; return read(); }
        }
        return context;
      },
      compact: async (revision, through, summary) => { const res = await post('/v1/team/compact', actor, { workspace: ch.workspace_id, threadId, revision, through, summary, mode: compactMode }); if (!res.ok) throw new Error('Could not save the context summary. Retry to continue safely.'); compacted = true; },
      summarize: (system, input) => withoutConversationBrain(() => runtimeFor(agent.runtime).complete(system, input, token, agent.model, 3500)),
      toolsThrough: conversationToolsThrough, boundary: setConversationHistoryBoundary,
      status: summary => log({ kind: 'tool', phase: 'inject', summary }),
    });
    if (continued) transcript = continued;
  }
  if (manualCompact) return compacted ? 'Compacted the earlier conversation. Decisions, constraints and unfinished work are retained in a working summary; the complete history stays available.' : 'This conversation is already compact. Its complete history is unchanged.';
  const { mkdirSync } = await import('node:fs');
  // the thread's brain workspace, with any pre-merge `chats/` directory adopted on first use
  const dir = ensureChatWorkspace(threadId);
  const provider = providerFor(agent.runtime);
  const canUseTools = provider === 'anthropic' || provider === 'openai' || provider === 'gemini';
  const system = chatModeSystemPrompt(
    { id: agent.id, name: agent.name, role: agent.role, brief: agent.brief, runtime: agent.runtime },
    ch.slug,
    { canUseTools, workspaceDir: dir, canWriteFiles: provider === 'anthropic' },
  ) + await projectNote(db, ch.id, { threadId }) + await (async () => {
    // the connected account is the read capability (search_x rides the nm registry below)
    const xConn = await xPublishConnectedFor(db, ch, { threadId });
    return xResearchNote(xConn);
  })() + await stageConnections(db, ch.id, { threadId }).catch(() => '') + await brandNote(db, ch.id, { threadId }).catch(() => '');
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
  const toolContext = { z, tool: ((name, description, shape, handler, extras) => tool(name, description, shape, bindConversationCallback(handler), extras)) as typeof tool, createSdkMcpServer, text, agent, ch, threadId, log,
    db, post, apiGet, recallFor: home?.home_agent_id ? async (_ws: string, _ch: string, query: string) => {
      const response: Response = await apiGet(`/v1/team/recall?workspace=${ch.workspace_id}&threadId=${threadId}&query=${encodeURIComponent(query)}`, { kind: 'agent', id: agent.id, role: agent.role });
      if (!response.ok) throw new Error('Project recall is unavailable.');
      return JSON.stringify(await response.json());
    } : recallFor, loadSkillBody, whiteboardClosures, draftsForAnchor, generateDraftImage, generateShareImage, libraryDocs: (id: string, limit?: number, scope?: 'room' | 'project' | 'workspace', _at?: import('./project-context').ProjectAnchor, name?: string, offset?: number) => libraryDocs(id, limit, scope, { threadId }, name, offset) };
  if (provider === 'gemini') {
    return geminiDispatch({ model: agent.model, thinking: agent.thinking, token, systemPrompt: system + skillsNote, transcript,
      tools: chatTransportTools(toolContext), attachments, cwd: dir, log: narrate(run, log), onDelta },
      { houseModel: agent.model === STARTER_MODEL, apiUrl: ctx.apiUrl, workspace: ch.workspace_id, actorId: ctx.ownerActorId });
  }
  if (provider === 'openai') {
    return codexSdkOrchestratorTurn({ model: agent.model, thinking: agent.thinking, token, systemPrompt: system + skillsNote, transcript,
      tools: chatTransportTools(toolContext), attachments, cwd: dir, log: narrate(run, log), onDelta });
  }
  const nm = makeChatTools(toolContext);

  const jail = sandboxFsEnabled()
    ? claudeSandboxOptions(computeFsJail({
        worktree: dir,
        userDataDir: (await import('electron')).app.getPath('userData'),
        extraPaths: await chatProtectedPaths(ch.workspace_id),
      }))
    : {};

  const reply = await drainQuery(
    query({
      prompt: claudeAgentPrompt(conversationInput('claude', agent.model, system + skillsNote, transcript, token), attachments),
      options: {
        ...claudePathOption(),
        ...jail,
        env: providerEnv('anthropic', token),
        model: agent.model,
        ...claudeEffort(agent),
        maxTurns: 24,
        mcpServers: { nm },
        // AVAILABILITY is `tools` (the #1010 lesson — allowedTools only auto-permits). The
        // preset pins the standard toolset; the allowlist is what runs without a prompt.
        tools: { type: 'preset' as const, preset: 'claude_code' as const },
        allowedTools: ['WebSearch', 'WebFetch', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash', 'TodoWrite', 'mcp__nm__propose_routine', 'mcp__nm__offer_routine_session', 'mcp__nm__create_coding_task', 'mcp__nm__read_coding_tasks', 'mcp__nm__list_team', 'mcp__nm__read_agent_thread', 'mcp__nm__message_agent', 'mcp__nm__recall', 'mcp__nm__load_skill', 'mcp__nm__list_playbooks', 'mcp__nm__create_whiteboard', 'mcp__nm__update_whiteboard', 'mcp__nm__list_whiteboards', 'mcp__nm__read_whiteboard', 'mcp__nm__draft_posts', 'mcp__nm__revise_posts', 'mcp__nm__generate_image', 'mcp__nm__search_x', ...(browserService() ? WEB_TOOL_NAMES.map((n) => `mcp__nm__${n}`) : [])],
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
        ...partialMessages(onDelta, agent.model), // the chat types as it is written, its thoughts beside it (turnkit.ts)
        stderr: (d: string) => { for (const line of d.split('\n')) if (/mcp|\bnm\b/i.test(line)) log({ kind: 'turn', summary: `claude: ${line.trim().slice(0, 240)}`, level: 'warn' }); },
      },
    }) as AsyncIterable<any>,
    ORCH_EMPTY_TURN,
    narrate(run, log), // a minute-long turn narrates through the ghost the room already paints
    onDelta,
    undefined,
    { mcp: 'nm' }, // a turn the CLI opened without the nm server stops and says so (turnkit.ts)
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
