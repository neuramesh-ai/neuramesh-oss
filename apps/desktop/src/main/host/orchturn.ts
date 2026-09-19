// THE ORCHESTRATOR'S FOUR TRANSPORTS — extracted from agents.ts (track B2).
//
// One registry (host/orchtools.ts), four ways to hand it to a model: the Agent SDK wraps each
// tool in tool(), Gemini renders them as function declarations, agy and the Codex SDK bridge
// them. They are separate functions rather than one adapter because their failure modes differ
// — an empty turn means something different in each — and collapsing them would hide that.
import { apiAuthHeaders } from '../apiauth';
import { drainQuery, claudeAgentPrompt } from './turnkit';
import { claudePathOption, keyEnvFor, providerEnv, type AgentAttachment } from '../runtime/adapter';
import { ORCH_EMPTY_TURN } from '../replypolicy';
import { stripPseudoToolCalls } from './pseudocalls';
import type { LogFn } from '../agentlog';
import type { OrchTool } from './orchtools';

// The three orchestrator transports share ONE signature so `orchestratorTurn` dispatches by
// provider with no coupling — each runs the SAME buildOrchestratorTools registry its own way.
export type OrchTransportArgs = { model: string; token: string; systemPrompt: string; transcript: string; tools: OrchTool[]; log?: LogFn; attachments?: AgentAttachment[]; cwd?: string; onDelta?: (t: string) => void };


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

/** the metered lane: control-api holds the key, guards the balance, and records the spend. it
 *  answers with Google's own response body, so the caller's loop is unchanged. a 402 surfaces as
 *  a readable refusal rather than an empty turn — running out of credits is a thing to say, not
 *  a thing to fail silently at. */
export async function starterGenerate(a: { apiUrl: string; workspace: string; actorId: string; contents: any[]; config: any }): Promise<any> {
  const res = await fetch(`${a.apiUrl}/v1/starter/generate`, {
    method: 'POST',
    headers: await apiAuthHeaders(a.apiUrl, { kind: 'human', id: a.actorId }),
    body: JSON.stringify({
      workspace: a.workspace,
      contents: a.contents,
      system: a.config?.systemInstruction,
      tools: a.config?.tools,
    }),
  });
  if (res.status === 402) throw new Error('out of credits — connect your own brain in Settings, or wait for the monthly refill');
  if (!res.ok) throw new Error(`starter brain unavailable (${res.status})`);
  return res.json();
}

// The orchestrator's tool-loop on GEMINI (the free default brain). Mirrors the Anthropic query()
// loop — same tools, same system prompt — but via @google/genai function-calling, in-process.
// The reply (which may embed a ```nmq card — plain text) is returned exactly like the Claude path.
/** the enum of Gemini schema types, as `@google/genai` exports it (passed in, so this stays a pure function) */
type GeminiTypes = { STRING: unknown; NUMBER: unknown; BOOLEAN: unknown; ARRAY: unknown; OBJECT: unknown };

/**
 * zod shape → a Gemini parameter Schema. describe() text rides through as the field description.
 * OBJECTS NEST (2026-09-19, the local fleet harness): `draft_posts` takes `posts: array(object)`, and
 * the old table mapped every unknown zod type to STRING, so the house model saw `items: STRING`,
 * answered `["{body:", "imageBrief:", "script:", "}"]` ten times over and hit the turn cap. A
 * schema the model cannot satisfy is a tool the model cannot call.
 */
export function zodShapeToGemini(shape: Record<string, any>, Type: GeminiTypes): any | undefined {
  const unwrap = (t: any): { inner: any; optional: boolean } => {
    let inner = t; let optional = false;
    while (['ZodOptional', 'ZodNullable', 'ZodDefault'].includes(inner?._def?.typeName)) { optional = true; inner = inner._def.innerType; }
    return { inner, optional };
  };
  const geminiType = (t: any): any => {
    const tn = t?._def?.typeName;
    if (tn === 'ZodNumber') return { type: Type.NUMBER };
    if (tn === 'ZodBoolean') return { type: Type.BOOLEAN };
    if (tn === 'ZodArray') return { type: Type.ARRAY, items: geminiType(unwrap(t._def.type).inner) };
    if (tn === 'ZodEnum') return { type: Type.STRING, enum: t._def.values };
    if (tn === 'ZodObject') return zodShapeToGemini(typeof t._def.shape === 'function' ? t._def.shape() : t.shape, Type) ?? { type: Type.OBJECT };
    return { type: Type.STRING };
  };
  const keys = Object.keys(shape);
  if (!keys.length) return undefined; // no-arg tool → omit parameters
  const properties: Record<string, any> = {};
  const required: string[] = [];
  for (const [key, zt] of Object.entries(shape)) {
    const { inner, optional } = unwrap(zt);
    const description = (zt as any).description as string | undefined;
    properties[key] = { ...geminiType(inner), ...(description ? { description } : {}) };
    if (!optional) required.push(key);
  }
  return { type: Type.OBJECT, properties, ...(required.length ? { required } : {}) };
}

export async function geminiOrchestratorTurn(args: {
  model: string; token: string; systemPrompt: string; transcript: string; tools: OrchTool[]; log?: LogFn;
  /** the platform pays: route through control-api's metered proxy, never a local key */
  starter?: boolean; apiUrl?: string; workspace?: string; actorId?: string;
  /** a WORKER on the lane (runtime/starter.ts) takes more rounds than a routing turn, and a human Stop must end it */
  maxTurns?: number; abort?: AbortSignal;
}): Promise<string> {
  const { GoogleGenAI, Type } = await import('@google/genai');
  const shapeToParams = (shape: Record<string, any>): any | undefined => zodShapeToGemini(shape, Type);

  // TWO transports, one loop. With a token (or an env key) we call Google directly. On the
  // STARTER lane there is deliberately no token — the platform's key never reaches a machine —
  // so the same request goes through control-api's metered proxy, which is the only place the
  // balance can be guarded and the spend recorded. An env key must NOT rescue that path: a
  // GEMINI_API_KEY sitting in a machine's environment would silently make the house brain free
  // and unmetered, which is the exact hole this lane exists to close.
  const viaProxy = args.starter === true;
  const apiKey = viaProxy ? '' : (args.token || keyEnvFor('gemini').map((k) => process.env[k]).find((v): v is string => !!v) || '');
  const ai = viaProxy ? null : new GoogleGenAI({ apiKey });
  const functionDeclarations = args.tools.map((t) => {
    const parameters = shapeToParams(t.schema);
    return { name: t.name, description: t.description, ...(parameters ? { parameters } : {}) };
  });
  const byName = new Map(args.tools.map((t) => [t.name, t]));
  const contents: any[] = [{ role: 'user', parts: [{ text: args.transcript }] }];
  const config = { systemInstruction: args.systemPrompt, tools: [{ functionDeclarations }], temperature: 0.4 };

  let lastText = '';
  for (let turn = 0; turn < (args.maxTurns ?? 14); turn++) {
    if (args.abort?.aborted) throw new Error('stopped by a human');
    const r: any = viaProxy
      ? await starterGenerate({ apiUrl: args.apiUrl ?? '', workspace: args.workspace ?? '', actorId: args.actorId ?? '', contents, config })
      : await ai!.models.generateContent({ model: args.model, contents, config });
    // the SDK exposes r.functionCalls; the proxy returns raw REST json, where the same calls
    // live on the candidate's parts. normalize so the loop below cannot tell them apart.
    const calls = (r.functionCalls ?? (r.candidates?.[0]?.content?.parts ?? [])
      .map((p: any) => p?.functionCall).filter(Boolean)) as Array<{ name: string; args?: any; id?: string }>;
    if (!calls.length) {
      const raw = (r.text ?? (r.candidates?.[0]?.content?.parts ?? []).map((p: any) => p?.text).filter(Boolean).join('') ?? '').trim();
      // a call the model NARRATED instead of making never reaches the room (host/pseudocalls.ts)
      const clean = stripPseudoToolCalls(raw, byName.keys());
      if (clean.stripped) args.log?.({ kind: 'result', phase: 'warn', summary: `dropped ${clean.stripped} narrated tool call${clean.stripped === 1 ? '' : 's'} from the reply`, level: 'warn' });
      lastText = clean.text;
      args.log?.({ kind: 'result', phase: 'success', summary: `replied · gemini (${args.model})` });
      return lastText || ORCH_EMPTY_TURN; // empty text → stand down, never a posted placeholder
    }
    // append the model's function-call turn, then run each call and feed the results back
    contents.push(r.candidates?.[0]?.content ?? { role: 'model', parts: calls.map((c) => ({ functionCall: c })) });
    const responseParts: any[] = [];
    for (const call of calls) {
      const t = byName.get(call.name);
      let out: string;
      try { out = t ? await t.run(call.args ?? {}) : `error: unknown tool ${call.name}`; }
      catch (e) { out = `error: ${e instanceof Error ? e.message : 'tool failed'}`; }
      args.log?.({ kind: 'tool', phase: 'call', summary: `${call.name} ${JSON.stringify(call.args ?? {}).slice(0, 120)}` });
      responseParts.push({ functionResponse: { ...(call.id ? { id: call.id } : {}), name: call.name, response: { result: out } } });
    }
    contents.push({ role: 'user', parts: responseParts });
  }
  args.log?.({ kind: 'result', phase: 'error', summary: `gemini orchestration hit the ${args.maxTurns ?? 14}-turn cap`, level: 'warn' });
  return lastText || ORCH_EMPTY_TURN; // exhausted with no channel text → stand down
}

// ANTHROPIC: the Agent SDK (query) with the tools as an in-process MCP server.
export async function anthropicOrchestratorTurn(args: OrchTransportArgs): Promise<string> {
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
        ...claudePathOption(),
        env: providerEnv('anthropic', args.token),
        model: args.model,
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
        tools: ['ToolSearch', 'Read', 'Write', 'Edit', 'Glob', 'Grep'],
        allowedTools: args.tools.map((t) => `mcp__nm__${t.name}`),
        permissionMode: 'bypassPermissions',
        cwd: args.cwd ?? os.tmpdir(),
        systemPrompt: args.systemPrompt,
      },
    }) as AsyncIterable<any>,
    ORCH_EMPTY_TURN, // empty stream → stand down, never a posted placeholder
    args.log,
    args.onDelta,
  );
}

// GOOGLE (agy / OAuth): the @google/genai SDK can't use the user's Google login, so when an `agy`
// login is present we drive the Antigravity CLI headless instead — it calls the SAME orchestrator
// tools over MCP via a loopback bridge (orchmcp.ts), so the orchestrator runs on the user's Google
// plan with NO API key. agy can't see our in-process tool closures (it spawns its MCP server as a
// separate process), so the bridge exposes them on 127.0.0.1 behind a per-turn secret and a tiny
// shim agy spawns proxies to it; per-turn context rides in the env we pass agy (it forwards env to
// the shim, verified). stdin is closed — `agy --print` hangs on an open stdin pipe (see gemini.ts).
// zod shape → MCP JSON-Schema BridgeTool[] (string/number/boolean/array/enum/optional subset) —
// shared by the agy + codex orchestrators, which both drive the same nm tools over the orchmcp bridge.
export function orchToolsToBridge(tools: OrchTransportArgs['tools']) {
  const jsonType = (t: any): any => {
    const tn = t?._def?.typeName;
    if (tn === 'ZodNumber') return { type: 'number' };
    if (tn === 'ZodBoolean') return { type: 'boolean' };
    if (tn === 'ZodArray') return { type: 'array', items: jsonType(t._def.type) };
    if (tn === 'ZodEnum') return { type: 'string', enum: t._def.values };
    return { type: 'string' };
  };
  const inputSchemaOf = (shape: Record<string, any>): any => {
    const properties: Record<string, any> = {}; const required: string[] = [];
    for (const [key, zt] of Object.entries(shape)) {
      let inner: any = zt; let optional = false;
      while (['ZodOptional', 'ZodNullable', 'ZodDefault'].includes(inner?._def?.typeName)) { optional = true; inner = inner._def.innerType; }
      const description = (zt as any).description as string | undefined;
      properties[key] = { ...jsonType(inner), ...(description ? { description } : {}) };
      if (!optional) required.push(key);
    }
    return { type: 'object', properties, required, additionalProperties: false };
  };
  return tools.map((t) => ({ name: t.name, description: t.description, inputSchema: inputSchemaOf(t.schema), run: (i: unknown) => t.run(i) }));
}

export async function agyOrchestratorTurn(args: OrchTransportArgs): Promise<string> {
  const { randomUUID } = await import('node:crypto');
  const { spawn } = await import('node:child_process');
  const { app } = await import('electron');
  const orchmcp = await import('../runtime/orchmcp');
  const { ensureCli } = await import('../runtime/cli');

  const port = await orchmcp.ensureBridge();
  const shim = orchmcp.ensureShim(app.getPath('userData'));
  orchmcp.ensureAgyMcpConfig(shim);
  const bin = await ensureCli('gemini', args.log); // resolves the `agy` binary (or throws install steps)

  const turnId = randomUUID();
  const secret = randomUUID();
  orchmcp.registerTurn(turnId, secret, orchToolsToBridge(args.tools));

  // agy is the Antigravity coding agent — in headless `--print` it AUTO-DENIES any of its native
  // tools that need an interactive permission (shell/command/file), and when the model reaches for
  // one it produces EMPTY output (exit 0, nothing on stdout). So steer it to answer a human
  // directly in text and reserve tools for real board actions (the nm MCP tools over the bridge),
  // never a native tool. It narrates tool steps, so fence the reply in markers and post only that.
  // (An empty native-tool turn is exactly why a gemini-3.5-flash orchestrator posted "(no digest)"
  // on a plain research question, 2026-07-19 — reproduced via `agy --print`.)
  const env = { ...process.env, NM_ORCH_URL: `http://127.0.0.1:${port}`, NM_ORCH_TURN: turnId, NM_ORCH_SECRET: secret };
  const runAgy = (promptText: string) => new Promise<string>((resolve, reject) => {
    const child = spawn(bin, ['--print', promptText], { stdio: ['ignore', 'pipe', 'pipe'], env });
    let out = ''; let errTail = '';
    child.stdout.on('data', (d) => { out += String(d); });
    child.stderr.on('data', (d) => { errTail = (errTail + String(d)).slice(-400); });
    child.on('error', (e) => reject(new Error(`agy failed to start: ${e.message}`)));
    child.on('close', (code) => {
      if (code !== 0) { reject(new Error(`agy orchestrator exited ${code}: ${errTail.replace(/\s+/g, ' ').slice(-200) || 'is agy signed in? run `agy` to sign in'}`)); return; }
      const m = /NMREPLYSTART\s*([\s\S]*?)\s*NMREPLYEND/.exec(out); // strip agy's step narration
      resolve((m?.[1] ?? out).trim());
    });
  });
  const answerSuffix = `Answer the human directly. For a question, opinion, or research / general-knowledge ask, reply from your OWN knowledge in plain text — do NOT reach for a tool, and NEVER run a shell / command / file / other native tool (headless mode can't grant it and the turn will come back empty). Use a NeuraMesh tool ONLY when the request needs a concrete board action (create / route / check a task, backlog, hire). A direct human message ALWAYS gets a real reply — never answer a person with NO_REPLY. Do NOT narrate your steps: your entire output must be ONLY the final channel message, wrapped between the marker lines NMREPLYSTART and NMREPLYEND on their own lines.`;
  try {
    let reply = await runAgy(`${args.systemPrompt}\n\n${args.transcript}\n\n${answerSuffix}`);
    if (!reply) {
      // agy came back empty — almost always a native tool it auto-denied headless. A human is
      // waiting (the whole point of a wake), so retry ONCE forcing a plain-text answer, no tools.
      args.log?.({ kind: 'result', phase: 'retry', summary: 'agy returned empty — retrying plain-text (no tools)', level: 'warn' });
      reply = await runAgy(`${args.systemPrompt}\n\n${args.transcript}\n\nAnswer the human NOW in plain text from your own knowledge. Do NOT call any tool. Output ONLY the reply, wrapped between the marker lines NMREPLYSTART and NMREPLYEND on their own lines.`);
    }
    args.log?.({ kind: 'result', phase: 'success', summary: 'replied · agy (Google OAuth)' });
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
  const { randomUUID } = await import('node:crypto');
  const os = await import('node:os');
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { app } = await import('electron');
  const orchmcp = await import('../runtime/orchmcp');
  const { ensureCli } = await import('../runtime/cli');
  const { Codex } = (await import('@openai/codex-sdk')) as unknown as { Codex: new (o?: unknown) => { startThread(o?: unknown): { run(i: string): Promise<{ finalResponse: string }> } } };

  const port = await orchmcp.ensureBridge();
  const shim = orchmcp.ensureShim(app.getPath('userData'));
  const bin = await ensureCli('codex', args.log);
  const turnId = randomUUID(); const secret = randomUUID();
  orchmcp.registerTurn(turnId, secret, orchToolsToBridge(args.tools));

  const raw = providerEnv('openai', args.token);
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) if (typeof v === 'string') env[k] = v;
  const dir = mkdtempSync(join(os.tmpdir(), 'nm-codexorch-'));
  const config = { mcp_servers: { nm: orchmcp.codexNmServer('node', shim, { NM_ORCH_URL: `http://127.0.0.1:${port}`, NM_ORCH_TURN: turnId, NM_ORCH_SECRET: secret }) } };
  const codex = new Codex({ codexPathOverride: bin, apiKey: args.token || undefined, env, config });
  const opts = { sandboxMode: 'read-only', workingDirectory: dir, skipGitRepoCheck: true, approvalPolicy: 'never' };
  const prompt = `${args.systemPrompt}\n\n${args.transcript}`;
  try {
    let turn: { finalResponse: string };
    try { turn = await codex.startThread({ ...opts, model: args.model }).run(prompt); }
    catch (e) {
      if (args.model && /not supported|unsupported|not available|invalid model|model .*not/i.test(String((e as Error)?.message))) {
        turn = await codex.startThread({ ...opts, model: undefined }).run(prompt); // model not on this plan → account default
      } else throw e;
    }
    args.log?.({ kind: 'result', phase: 'success', summary: 'replied · codex (ChatGPT login)' });
    return (turn.finalResponse || '').trim() || ORCH_EMPTY_TURN; // empty text → stand down, never a posted placeholder
  } finally {
    orchmcp.unregisterTurn(turnId);
    rmSync(dir, { recursive: true, force: true });
  }
}

