// Gemini orchestration transport and its streaming tool loop.
import { zodShapeToGemini } from './gemini-tool-schema';




import { starterGenerate, starterStream } from './starterproxy';
import { replyText, starterThoughts } from './starterthoughts';
import { keyEnvFor } from '../runtime/adapter';

import { ORCH_EMPTY_TURN } from '../replypolicy';
import { firstRoundThinking, geminiThinking } from '../runtime/thinking';
import { addProgressLine, type ThinkingLevel } from '@neuramesh/shared';
import { narrationStats } from './narration-stats';
import { argumentsOnlyReply, parsePseudoToolCalls, relabelPillFence, type PseudoTool } from './pseudocalls';
import type { LogFn } from '../agentlog';
import type { OrchTool } from './orchtools';


import { conversationInput, recordRuntimeEvent, recordedTools } from '../runtime/brain-recording';
import { recordConversationEvent } from '../harness/brain-sync';
import { runNarratedCalls } from './orch-narrated';


export async function geminiOrchestratorTurn(args: {
  model: string; token: string; systemPrompt: string; transcript: string; tools: OrchTool[]; log?: LogFn; thinking?: ThinkingLevel | null;
  /** the platform pays: route through control-api's metered proxy, never a local key */
  starter?: boolean; apiUrl?: string; workspace?: string; actorId?: string;
  /** a WORKER on the lane (runtime/starter.ts) takes more rounds than a routing turn, and a human Stop must end it */
  maxTurns?: number; abort?: AbortSignal;
  /** the live bubble: each round's words, growing, as the model writes them, the turn's thoughts, and the
   *  turn's progress lines (the words of each round that went on to call tools, round 9) */
  onDelta?: (t: string, thinking?: string, progress?: readonly string[]) => void;
  traceKey?: string;
}): Promise<string> {
  args = { ...args, transcript: conversationInput('gemini', args.model, args.systemPrompt, args.transcript, args.token), tools: recordedTools(args.tools) };
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
  // what the narrated-call filter matches against: each offered tool and its parameter names
  const offered: PseudoTool[] = args.tools.map((t) => ({ name: t.name, params: Object.keys(t.schema) }));
  const contents: any[] = [{ role: 'user', parts: [{ text: args.transcript }] }];
  // the person's level rides an API key only: the metered lane's level is fixed, and part of its price.
  // The first round thinks one level lower (round 9), so the first words and tool calls come sooner
  const base = { abortSignal:args.abort, systemInstruction: args.systemPrompt, tools: [{ functionDeclarations }], temperature: 0.4 };
  const levelFor = (turn: number) => geminiThinking({ model: args.model, thinking: turn === 0 ? firstRoundThinking(args.thinking) : args.thinking });
  const configFor = (turn: number) => ({ ...base, ...(viaProxy ? {} : levelFor(turn)) });
  // Both the metered lane and a personal key stream provider reasoning and tool activity.
  const th = args.onDelta ? starterThoughts() : null;
  // LIVE NARRATION (round 9): a round's words that go on to call tools are its progress line. They stay
  // on screen in `progress`, and the bubble's text holds only the round being written now
  let shown = '';
  let progress: readonly string[] = [];
  const stats = narrationStats(viaProxy ? 'starter' : 'gemini', args.traceKey);
  const show = (): void => {
    stats.text(!!shown.trim() || progress.length > 0);
    try { args.onDelta?.(shown, th?.text(), progress); } catch { /* a live bubble is never worth the turn */ }
  };
  try {

  let lastText = '';
  const called = new Set<string>(); // the tools this turn called for real
  let nudged = false; // asked once already to make a call the model wrote out as JSON
  for (let turn = 0; turn < (args.maxTurns ?? 14); turn++) {
    if (args.abort?.aborted) throw new Error('stopped by a human');
    const config = configFor(turn);
    const call = { signal:args.abort, apiUrl: args.apiUrl ?? '', workspace: args.workspace ?? '', actorId: args.actorId ?? '', contents, config, ...(th ? { thoughts: true } : {}) };
    // a watched round streams: the bubble types this round's words, filtered as the posted reply is
    // below (a narrated call never types itself out); the next round's words replace them, as on Claude.
    // every update carries the thoughts so far: the desktop's stream store drops them from an update that lacks them
    const onDelta = args.onDelta;
    let said = '';
    th?.round();
    const r: any = !viaProxy
      ? onDelta ? await (async () => {
        const parts: any[] = [];
        const stream = await ai!.models.generateContentStream({ model: args.model, contents, config: { ...config, thinkingConfig: { ...levelFor(turn).thinkingConfig, includeThoughts: true } } });
        for await (const chunk of stream) for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
          parts.push(part);
          if (part.text && part.thought) { th?.thought(part.text); stats.thought(); }
          else if (part.text) { said += part.text; shown = parsePseudoToolCalls(said, offered, { streaming: true }).text; }
          show();
        }
        return { candidates: [{ content: { role: 'model', parts } }] };
      })() : await ai!.models.generateContent({ model: args.model, contents, config })
      : onDelta ? await starterStream({ ...call, onText: (d) => { said += d; shown = parsePseudoToolCalls(said, offered, { streaming: true }).text; show(); }, onThought: (d) => { th?.thought(d); stats.thought(); show(); } })
        : await starterGenerate(call);
    recordRuntimeEvent('gemini', r);
    // the SDK exposes r.functionCalls; the proxy returns raw REST json, where the same calls
    // live on the candidate's parts. normalize so the loop below cannot tell them apart.
    const calls = (r.functionCalls ?? (r.candidates?.[0]?.content?.parts ?? [])
      .map((p: any) => p?.functionCall).filter(Boolean)) as Array<{ name: string; args?: any; id?: string }>;
    const publicText = parsePseudoToolCalls((r.candidates ? replyText(r) : r.text ?? '').trim(), offered).text;
    if (publicText) recordConversationEvent('assistant.message', { text: publicText, provider: 'gemini', model: args.model });
    if (!calls.length) {
      const raw = (r.candidates ? replyText(r) : r.text ?? '').trim();
      // a call the model NARRATED instead of making never reaches the room (host/pseudocalls.ts),
      // and the narrated thread title still lands: the reply never depended on its result
      const clean = parsePseudoToolCalls(raw, offered);
      // a reply that is only a tool's arguments: the model meant the call. Ask once, then move on
      const meant = !nudged ? argumentsOnlyReply(clean.text, offered) : null;
      if (meant) {
        nudged = true;
        args.log?.({ kind: 'result', phase: 'warn', summary: `the reply was only ${meant}'s arguments: asking for the call`, level: 'warn' });
        contents.push(r.candidates?.[0]?.content ?? { role: 'model', parts: [{ text: raw }] });
        contents.push({ role: 'user', parts: [{ text: `You wrote the arguments of ${meant} as text instead of calling it, so nothing happened. Call the ${meant} tool now with those arguments. If you did not mean to call it, answer the person in words.` }] });
        continue;
      }
      if (clean.stripped) args.log?.({ kind: 'result', phase: 'warn', summary: `dropped ${clean.stripped} narrated tool call${clean.stripped === 1 ? '' : 's'} from the reply`, level: 'warn' });
      // a tool this turn already called for real is not run again from the narration
      await runNarratedCalls(clean.calls.filter((c) => !called.has(c.name)), byName, args.log);
      // follow-ups written as a ```json list become the pills they were meant to be (pseudocalls.ts)
      lastText = relabelPillFence(clean.text);
      // the round's words are recorded above (publicText), once per round
      args.log?.({ kind: 'result', phase: 'success', summary: `replied · gemini (${args.model})` });
      return lastText || ORCH_EMPTY_TURN; // empty text → stand down, never a posted placeholder
    }
    // this round's words introduced its tool calls: they become a progress line, and the next round types fresh
    if (onDelta && shown.trim()) { progress = addProgressLine(progress, shown); stats.progress(progress.length); }
    shown = '';
    stats.batch(calls.length);
    // append the model's function-call turn, then run each call and feed the results back
    contents.push(r.candidates?.[0]?.content ?? { role: 'model', parts: calls.map((c) => ({ functionCall: c })) });
    const responseParts: any[] = [];
    for (const call of calls) {
      const t = byName.get(call.name);
      called.add(call.name);
      if (th) { th.step(call.name, call.args); show(); } // the bubble shows the step before the tool runs
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
  } finally {
    if (args.onDelta) console.log(stats.line(args.abort?.aborted ? 'stopped' : 'end'));
  }
}
