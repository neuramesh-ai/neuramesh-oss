export { runNarratedCalls } from './orch-narrated';
export { geminiOrchestratorTurn } from './orchturn-gemini';
import { geminiOrchestratorTurn } from './orchturn-gemini';
import { zodShapeToGemini } from './gemini-tool-schema';
export { zodShapeToGemini };
import { orchToolsToBridge } from './orchtools-bridge';
export { orchToolsToBridge } from './orchtools-bridge';
import { agyConversationStream, agyFailureMessage } from './agy-stream';
import { agyArgs, agyModelFor, agyUserLine } from '../relay/engineering-agy-args';
// THE ORCHESTRATOR'S FOUR TRANSPORTS — extracted from agents.ts (track B2).
//
// One registry (host/orchtools.ts), four ways to hand it to a model: the Agent SDK wraps each
// tool in tool(), Gemini renders them as function declarations, agy and the Codex SDK bridge
// them. They are separate functions rather than one adapter because their failure modes differ
// — an empty turn means something different in each — and collapsing them would hide that.
import { drainQuery, claudeAgentPrompt, partialMessages } from './turnkit';


import { claudePathOption, providerEnv, type AgentAttachment } from '../runtime/adapter';
import { boxRelayEnv } from '../cloudrun/runtime-state'; // the agy relay ticket on a Cloud Run machine; {} elsewhere
import { ORCH_EMPTY_TURN } from '../replypolicy';
import { claudeEffort, codexEffort } from '../runtime/thinking';
import { NARRATION_RULE, type ThinkingLevel } from '@neuramesh/shared';
import { narrationStats } from './narration-stats';

import type { LogFn } from '../agentlog';
import type { OrchTool } from './orchtools';
import type { CodexCtor } from '../runtime/codexsdk';
import { nativePermissionHooks } from '../chat-permission-action';
import { conversationInput, recordRuntimeEvent, recordedTools } from '../runtime/brain-recording';
import { recordConversationEvent } from '../harness/brain-sync';

// The three orchestrator transports share ONE signature so `orchestratorTurn` dispatches by
// provider with no coupling — each runs the SAME buildOrchestratorTools registry its own way.
export type OrchTransportArgs = { nativeGate?: import('../runtime/adapter').PermissionGate; managedTools?:boolean; abort?:AbortSignal; abortController?: AbortController; model: string; token: string; systemPrompt: string; transcript: string; tools: OrchTool[]; log?: LogFn; attachments?: AgentAttachment[]; cwd?: string; onDelta?: (t: string, thinking?: string, progress?: readonly string[]) => void; thinking?: ThinkingLevel | null;
  /** names the turn in its narration_stats log line (the conversation or task thread id) */
  traceKey?: string };




/** Which Gemini transport a turn takes. Lives here with the transports rather than in the host's
 *  dispatcher, so the rule — house model → metered proxy, never the human's own agy login and
 *  never a machine-local key — sits beside the thing it governs. */
export async function geminiDispatch(
  args: OrchTransportArgs,
  ctx: { houseModel: boolean; apiUrl: string; workspace: string; actorId: string },
): Promise<string> {
  if (ctx.houseModel && !args.token) {
    return geminiOrchestratorTurn({ ...args, starter: true, apiUrl: ctx.apiUrl, workspace: ctx.workspace, actorId: ctx.actorId });
  }
  const { which } = await import('../runtime/cli');
  if (!args.token && (await which('agy'))) return agyOrchestratorTurn(args);
  return geminiOrchestratorTurn(args);
}

// ANTHROPIC: the Agent SDK (query) with the tools as an in-process MCP server.
export async function anthropicOrchestratorTurn(args: OrchTransportArgs): Promise<string> {
  args = { ...args, transcript: conversationInput('claude', args.model, args.systemPrompt, args.transcript, args.token), tools: recordedTools(args.tools) };
  const os = await import('node:os');
  const { query, tool, createSdkMcpServer } = await import('@anthropic-ai/claude-agent-sdk');
  const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });
  // `alwaysLoad` keeps the nm catalogue IN the turn-1 prompt instead of behind tool search.
  // Without it the model spends a whole round trip on ToolSearch before it can call the
  // first board tool — visible in the activity log as `ToolSearch → nm.list_repos` on turns
  // that only ever wanted nm.list_repos.
  const nm = createSdkMcpServer({ name: 'nm', alwaysLoad: true, tools: args.tools.map((t) => tool(t.name, t.description, t.schema, async (i) => text(await t.run(i)))) });
  return drainQuery(
    query({
      prompt: claudeAgentPrompt(args.transcript, args.attachments),
      options: {
        abortController: args.abortController,
        ...claudePathOption(),
        env: providerEnv('anthropic', args.token),
        model: args.model,
        ...claudeEffort(args),
        maxTurns: 14,
        mcpServers: { nm },
        // AVAILABILITY is `tools` (the #1010 lesson — allowedTools only auto-permits), and
        // this turn had NO positive fence: it inherited the CLI's whole default toolset.
        // Measured on this machine, 2026-08-01: 81 tools exposed and 3.6s of session init,
        // against 28 and 0.6s fenced — Bash, Workflow, CronCreate, NotebookEdit and friends
        // on a turn whose entire job is to route work.
        //
        // ToolSearch is deliberately KEPT: `tools` gates MCP tools too, so fencing it out
        // entirely would silently strip the workspace's own connectors (a Drive lookup this
        // room really does use). With nm on alwaysLoad the round trip is gone from the hot
        // path and paid only when a connector is genuinely reached for. Verified both ways.
        // Plus the file tools. The fence (81 tools → 28) was right about Bash, Workflow, CronCreate
        // and friends on a routing turn — and wrong to leave the orchestrator unable to read or
        // write anything at all, which is what made it answer "I don't have a write tool" and go
        // looking for a teammate. Five tools back, scoped to `cwd` above; Bash stays out, because
        // running commands on the user's machine is a worker's job behind the policy gate.
        tools: args.managedTools ? ['ToolSearch'] : ['ToolSearch', 'Read', 'Write', 'Edit', 'Glob', 'Grep'],
        allowedTools: args.tools.map((t) => `mcp__nm__${t.name}`),
        permissionMode: 'bypassPermissions',
        ...(args.nativeGate ? { hooks: nativePermissionHooks(args.nativeGate) } : {}),
        cwd: args.cwd ?? os.tmpdir(),
        systemPrompt: args.systemPrompt,
        ...partialMessages(args.onDelta, args.model), // token deltas for the live bubble (turnkit.ts)
        // the CLI's own stderr into the activity log, MCP lines only: when the nm server does not
        // come up, the reason is printed there and nowhere else (2026-09-19)
        stderr: (d: string) => { for (const line of d.split('\n')) if (/mcp|\bnm\b/i.test(line)) args.log?.({ kind: 'turn', summary: `claude: ${line.trim().slice(0, 240)}`, level: 'warn' }); },
      },
    }) as AsyncIterable<any>,
    ORCH_EMPTY_TURN, // empty stream → stand down, never a posted placeholder
    args.log,
    args.onDelta,
    undefined,
    { mcp: 'nm' }, // a turn the CLI opened without the nm server stops and says so (turnkit.ts)
  );
}

// GOOGLE (agy / OAuth): the @google/genai SDK can't use the user's Google login, so when an `agy`
// login is present we drive the Antigravity CLI headless instead — it calls the SAME orchestrator
// tools over MCP via a loopback bridge (orchmcp.ts), so the orchestrator runs on the user's Google
// plan with NO API key. agy can't see our in-process tool closures (it spawns its MCP server as a
// separate process), so the bridge exposes them on 127.0.0.1 behind a per-turn secret and a tiny
// shim agy spawns proxies to it; per-turn context rides in the env we pass agy (it forwards env to
// the shim, verified). Send one stream-json turn on stdin so long threads fit without compaction.
// zod shape → MCP JSON-Schema BridgeTool[] (string/number/boolean/array/enum/optional subset) —
// shared by the agy + codex orchestrators, which both drive the same nm tools over the orchmcp bridge.

export async function agyOrchestratorTurn(args: OrchTransportArgs): Promise<string> {
  args = { ...args, transcript: conversationInput('agy', args.model, args.systemPrompt, args.transcript, args.token), tools: recordedTools(args.tools) };
  const { randomUUID } = await import('node:crypto');
  const { spawn } = await import('node:child_process');
  // userDataDir, never electron's app: a cloud machine runs this under plain node, where importing
  // electron throws, and the throw was the reply (orchturn-cloud.test.ts)
  const { userDataDir } = await import('../harness/turntools');
  const orchmcp = await import('../runtime/orchmcp');
  const { ensureCli } = await import('../runtime/cli');

  const port = await orchmcp.ensureBridge();
  orchmcp.ensureAgyMcpConfig(orchmcp.ensureShim(userDataDir()));
  const bin = await ensureCli('gemini', args.log); // resolves the `agy` binary (or throws install steps)

  const turnId = randomUUID();
  const secret = randomUUID();
  orchmcp.registerTurn(turnId, secret, orchToolsToBridge(args.tools));

  // Project reads and tool progress use the same MCP bridge and stream wire as Code.
  const env = { ...process.env, ...boxRelayEnv(), NM_ORCH_URL: `http://127.0.0.1:${port}`, NM_ORCH_TURN: turnId, NM_ORCH_SECRET: secret };
  // one narration_stats line per agy run (round 9): first visible text, tools, batches, progress lines, thoughts
  const stats = narrationStats('agy', args.traceKey);
  const runAgy = (promptText: string) => new Promise<string>((resolve, reject) => {
    const model = agyModelFor(args.model, args.thinking);
    const child = spawn(bin, ['--settings', orchmcp.managedAgySettings(), ...agyArgs({model,mode:null})], { stdio: ['pipe', 'pipe', 'pipe'], env, cwd: args.cwd, signal:args.abort });
    const stream = agyConversationStream(args.tools.map(t => t.name), args.onDelta, event => recordRuntimeEvent('agy', event), text => recordConversationEvent('assistant.message', { text, provider: 'agy', model: args.model }), stats);
    let errorStart = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (data: string) => { try { stream.push(data); } catch (error) { child.kill(); reject(error); } });
    // A CLI which rejects its flags may close stdin before reading; close reports its actual error.
    child.stdin.on('error', (error: NodeJS.ErrnoException) => { if (error.code !== 'EPIPE') { child.kill(); reject(error); } });
    child.stdin.end(agyUserLine(promptText));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d: string) => { if (errorStart.length < 4096) errorStart += d.slice(0, 4096 - errorStart.length); });
    child.on('error', (e) => reject(new Error(`agy failed to start: ${e.message}`)));
    child.on('close', (code) => {
      console.log(stats.line(code === 0 ? 'end' : `exit-${code}`));
      if (code !== 0) { reject(new Error(agyFailureMessage(code, errorStart))); return; }
      try { resolve(stream.finish()); } catch (error) { reject(error); }
    });
  });
  // round 9: no "answer in this thread" push (it made the model paste whole programs), lookups only when the
  // answer depends on project facts, and the shared narration rule
  const answerSuffix = `The NeuraMesh tools are on the nm MCP server. Call them with call_mcp_tool, ServerName nm. They are available in every conversation, including general and marketing work. When your answer depends on facts about this project (its library, brand documents, repositories or connected services), check them with these tools before you make claims. A self-contained request needs no lookups. Native shell and file writes need interactive permissions that this headless conversation does not have. Use the supplied NeuraMesh tools and their approval gates. ${NARRATION_RULE} Never invent project facts or report a tool succeeded when it failed.`;
  try {
    let reply = await runAgy(`${args.systemPrompt}\n\n${args.transcript}\n\n${answerSuffix}`);
    if (!reply) {
      // agy came back empty — almost always a native tool it auto-denied headless. A human is
      // waiting, so retry once while preserving access to the project tools.
      args.log?.({ kind: 'result', phase: 'retry', summary: 'agy returned empty — retrying the conversation', level: 'warn' });
      reply = await runAgy(`${args.systemPrompt}\n\n${args.transcript}\n\nThe previous attempt returned no answer. Inspect the project with the available NeuraMesh tools if needed, then answer the human directly. If a tool failed, explain that failure without inventing project facts.`);
    }
    args.log?.({ kind: 'result', phase: 'success', summary: 'replied · agy (Google OAuth)' });
    recordConversationEvent('assistant.message', { text: reply, provider: 'agy', model: args.model });
    return reply || ORCH_EMPTY_TURN; // still empty after the retry → genuine stand-down, never a placeholder
  } finally {
    orchmcp.unregisterTurn(turnId);
  }
}

// OPENAI (codex SDK): drive the in-process codex harness over the SAME orchmcp bridge as agy, so the
// orchestrator runs on the user's ChatGPT login with NO API key. codex reads MCP servers from
// per-instance config (no global file); `default_tools_approval_mode='approve'` + `approval_policy=
// 'never'` let the nm tools run headless, and per-turn context rides in mcp_servers.nm.env (codex
// forwards it to the shim) — all verified in Gate 0. finalResponse is the agent's reply with no step
// narration, so (unlike agy --print) no marker fencing is needed.
export async function codexSdkOrchestratorTurn(args: OrchTransportArgs): Promise<string> {
  args = { ...args, transcript: conversationInput('codex', args.model, args.systemPrompt, args.transcript, args.token), tools: recordedTools(args.tools) };
  const { randomUUID } = await import('node:crypto');
  const os = await import('node:os');
  const { mkdtempSync, rmSync, writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { userDataDir } = await import('../harness/turntools'); // not electron: see agyOrchestratorTurn
  const orchmcp = await import('../runtime/orchmcp');
  const { ensureCli } = await import('../runtime/cli');
  const { runResilient, codexInput } = await import('../runtime/codexsdk');
  const { Codex } = (await import('@openai/codex-sdk')) as unknown as { Codex: CodexCtor };

  const port = await orchmcp.ensureBridge();
  const shim = orchmcp.ensureShim(userDataDir());
  const bin = await ensureCli('codex', args.log);
  const turnId = randomUUID(); const secret = randomUUID();
  orchmcp.registerTurn(turnId, secret, orchToolsToBridge(args.tools));

  const raw = providerEnv('openai', args.token);
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) if (typeof v === 'string') env[k] = v;
  const dir = mkdtempSync(join(os.tmpdir(), 'nm-codexorch-'));
  // model_reasoning_summary: the reasoning sections are the live bubble's Thoughts (the repo-connect round's Option A)
  // Codex's native image tool renders into its own client, which this text-event transport
  // cannot deliver. Keep image generation on the tool that saves a NeuraMesh attachment.
  const imageDelivery = args.tools.some((tool) => tool.name === 'share_images') ? {
    features: { image_generation: false },
    developer_instructions: 'This turn runs inside NeuraMesh. Generate and deliver images with the nm share_images tool. It saves the image as an attachment in the current conversation. Host image-generation skills and files rendered in another client do not deliver images here. Only report an image as delivered after share_images confirms attachment success.',
  } : {};
  const config = { model_reasoning_summary: 'detailed', ...imageDelivery,
    features: { ...imageDelivery.features, shell_tool:false, unified_exec:false }, web_search:'disabled',
    mcp_servers: { nm: orchmcp.codexNmServer('node', shim, { NM_ORCH_URL: `http://127.0.0.1:${port}`, NM_ORCH_TURN: turnId, NM_ORCH_SECRET: secret }) } };
  // The SDK exposes structured config overrides but the CLI flag that isolates
  // user-installed MCP servers is separate. Keep the subscription credential
  // store while loading only the tools configured for this turn.
  const launcher = join(dir, 'nm-codex-exec');
  writeFileSync(launcher, '#!/bin/sh\nshift\nexec "$NM_CODEX_EXECUTABLE" exec --ignore-user-config "$@"\n', { mode: 0o700 });
  const codex = new Codex({ codexPathOverride: launcher, apiKey: args.token || undefined, env: { ...env, NM_CODEX_EXECUTABLE: bin }, config });
  const opts = { sandboxMode: 'read-only' as const, workingDirectory: dir, skipGitRepoCheck: true, approvalPolicy: 'never' as const };
  const prompt = `${args.systemPrompt}\n\n${args.transcript}`;
  try {
    // STREAMED, like every other codex turn: `.run()` gave the bubble nothing until the whole reply
    // landed. runResilient falls back to the account default when the plan lacks the model.
    const turn = await runResilient(codex, { ...opts, model: args.model, ...codexEffort(args) }, codexInput(prompt, args.attachments), {signal:args.abort}, args.log, args.onDelta);
    if (!turn.text && turn.failure) throw new Error(`codex: ${turn.failure.slice(0, 200)}`);
    args.log?.({ kind: 'result', phase: 'success', summary: 'replied · codex (ChatGPT login)' });
    return turn.text.trim() || ORCH_EMPTY_TURN; // empty text → stand down, never a posted placeholder
  } finally {
    orchmcp.unregisterTurn(turnId);
    rmSync(dir, { recursive: true, force: true });
  }
}

