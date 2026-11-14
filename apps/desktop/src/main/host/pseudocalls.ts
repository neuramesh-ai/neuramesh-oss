// A PSEUDO TOOL CALL is a tool invocation the model WROTE as text instead of calling — a fenced
// `set_thread_title(title="…")` above the answer. Seen live on the Starter lane (2026-09-17, the
// house model on a routine's first reply): the function declarations were sent, the model still
// narrated the call, and the narration reached the room as the reply's first paragraph. The call
// never ran, so it is noise twice over. Enforced here rather than prompted: the text a human reads
// is filtered against the names of the tools that WERE offered, and the drop is logged.
//
// THE SHAPES (2026-10-27, rex's first reply on the sandbox, gemini on the NeuraMesh brain): the
// model wrote the arguments as a ```json fence and the call as a markdown link glued to the fence's
// closing backticks — "```json\n{…}\n```[set_thread_title](title=\"…\", description=\"…\")". Neither
// half matched the one shape this file knew, so both reached the room, and the title never changed.
// So the parser reads the shapes models produce, not the one we saw first:
//   · a call on its own line, `name(args)`, with the bridges' prefixes (nm., mcp__nm__,
//     default_api.) and the tool_code wrapper `print(…)`; args as kwargs (title="…"), as one JSON
//     object, or positional in the tool's parameter order;
//   · the markdown-link form `[name](args)`, also straight after a fence's closing backticks;
//   · a call that opens a line, then a new sentence: the call goes, the words stay;
//   · a fence whose lines are all calls (```tool_code, ```python, a bare ```), or one call spread
//     over its lines;
//   · a JSON fence that names its tool, {"name": …, "args": …} and its cousins;
//   · a JSON fence of bare arguments, but ONLY beside a narrated call whose tool takes those keys,
//     because a JSON block on its own may be the answer a person asked for;
//   · ONE exception to that (2026-10-30, the Cloud Run feature suite, rex's first reply in a new
//     session): a ```json fence of set_thread_title's full arguments, {"title": …, "description": …},
//     that OPENS the reply and has the answer after it (a lone {"title": …} stays an answer). The model narrated the title with no call
//     beside it, and the room saw the JSON above the answer. Only a tool that may run from text
//     (RUN_NARRATED) gets this, only as the reply's first block, and only with words after it.
// Prose that merely mentions a tool name stays, as does any fence with real content in it.
//
// Pure. The turn decides what to RUN (RUN_NARRATED): the model never sees a narrated call's result,
// so only a call whose result the reply does not depend on may run from text.

/** a tool the model was offered: its name, and its parameter names in schema order */
export interface PseudoTool { name: string; params?: readonly string[] }

/** a narrated call. `args` null = the call's shape was clear but its arguments did not parse:
 *  still noise to drop, never something to run */
export interface PseudoCall { name: string; args: Record<string, unknown> | null }

/** Narrated calls the turn may run, because nothing in the reply waits on their result: naming the
 *  thread is metadata, and the server keeps a human's rename. A narrated create_task or offer_task
 *  stays dropped and unrun: a card or a refusal the model never saw would go unexplained. */
export const RUN_NARRATED: ReadonlySet<string> = new Set(['set_thread_title']);

const PREFIX = /^(?:nm\.|mcp__nm__|default_api\.|functions\.)/;
const FENCE = /```([^\n`]*)\n([\s\S]*?)```/g;
/** the fence labels a narrated call wears: only these are read as JSON calls or arguments, and an
 *  unclosed one is held back from a live bubble */
const CALL_FENCES = new Set(['', 'json', 'tool_code', 'tool_call', 'function_call', 'python', 'py']);
const NAME_KEYS = ['name', 'tool', 'tool_name', 'function', 'functionName'];
const ARG_KEYS = ['args', 'arguments', 'parameters', 'input'];

import { closeOf, parseArgs, isObject } from './pseudocall-args';

function toolMap(tools: Iterable<string | PseudoTool>): Map<string, PseudoTool> {
  const out = new Map<string, PseudoTool>();
  for (const t of tools) {
    const tool = typeof t === 'string' ? { name: t } : t;
    out.set(tool.name, tool);
  }
  return out;
}

/** where the bracket or quote that opens at `i` closes, skipping over quoted text; -1 if it never does */
/** a line without its wrappers: single backticks, a trailing semicolon, tool_code's `print(…)` */
function unwrap(src: string): string {
  let s = src.trim().replace(/;$/, '').trim();
  const ticked = /^`([^`]+)`$/.exec(s);
  if (ticked) s = ticked[1]!.trim();
  const printed = /^print\(([\s\S]*)\)$/.exec(s);
  return printed ? printed[1]!.trim() : s;
}

/** one call expression, `name(args)` or `[name](args)`, to an offered tool; null for anything else */
function callExpr(src: string, tools: Map<string, PseudoTool>): PseudoCall | null {
  const s = unwrap(src);
  const m = /^\[\s*([A-Za-z_][\w.]*)\s*\]\s*\(([\s\S]*)\)$/.exec(s) ?? /^([A-Za-z_][\w.]*)\s*\(([\s\S]*)\)$/.exec(s);
  if (!m) return null;
  const tool = tools.get(m[1]!.replace(PREFIX, ''));
  if (!tool) return null;
  // the closing paren must be the call's own, or "f(a) and g(b)" would read as one call
  const open = s.indexOf('(', s.indexOf(m[1]!) + m[1]!.length);
  if (closeOf(s, open) !== s.length - 1) return null;
  return { name: tool.name, args: parseArgs(m[2]!, tool) };
}

/** a call that opens a line, then a new sentence: the call and the words after it, or null. Only a
 *  new sentence: "set_thread_title(…) and create_task(…) are the two tools" is prose about tools */
function leadingCall(line: string, tools: Map<string, PseudoTool>): { call: PseudoCall; rest: string } | null {
  const m = /^\s*(?:\[\s*([A-Za-z_][\w.]*)\s*\]|([A-Za-z_][\w.]*))\s*\(/.exec(line);
  if (!m) return null;
  const end = closeOf(line, m[0].length - 1);
  if (end < 0) return null;
  const call = callExpr(line.slice(0, end + 1), tools);
  const rest = line.slice(end + 1);
  return call && /^\s*[.:;]?\s+[A-Z]/.test(rest) ? { call, rest: rest.replace(/^\s*[.:;]?\s+/, '') } : null;
}

/** a JSON object that names its tool: {"name"|"tool"|"function": …, "args"|"arguments"|"parameters"|"input": …}
 *  (flat arguments beside the name count too), the REST shapes {"functionCall": {…}}, or {"<tool>": {…}} */
function envelope(v: Record<string, unknown>, tools: Map<string, PseudoTool>): PseudoCall | null {
  for (const nest of ['functionCall', 'function_call', 'tool_call', 'toolCall']) {
    if (isObject(v[nest])) return envelope(v[nest] as Record<string, unknown>, tools);
  }
  const keys = Object.keys(v);
  if (keys.length === 1 && tools.has(keys[0]!) && isObject(v[keys[0]!])) return { name: keys[0]!, args: v[keys[0]!] as Record<string, unknown> };
  const nameKey = NAME_KEYS.find((k) => typeof v[k] === 'string' && tools.has((v[k] as string).replace(PREFIX, '')));
  if (!nameKey) return null;
  const tool = tools.get((v[nameKey] as string).replace(PREFIX, ''))!;
  const argKey = ARG_KEYS.find((k) => v[k] !== undefined);
  let args: unknown = argKey ? v[argKey] : Object.fromEntries(Object.entries(v).filter(([k]) => k !== nameKey));
  if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = null; } }
  return { name: tool.name, args: isObject(args) ? args : null };
}

type Block =
  | { kind: 'fence'; info: string; body: string; raw: string; json?: Record<string, unknown>; call?: PseudoCall; drop?: boolean }
  | { kind: 'line'; raw: string; call?: PseudoCall; drop?: boolean };

/** the text as fences and lines. A fence's closing backticks end it mid-line, and the rest of that
 *  line is a line of its own: the live reply glued its call to the closing backticks */
function blocksOf(text: string): Block[] {
  const out: Block[] = [];
  const lines = (chunk: string): void => {
    const parts = chunk.split('\n');
    parts.forEach((p, k) => { const raw = k < parts.length - 1 ? `${p}\n` : p; if (raw) out.push({ kind: 'line', raw }); });
  };
  let at = 0;
  for (const m of text.matchAll(FENCE)) {
    lines(text.slice(at, m.index));
    out.push({ kind: 'fence', info: m[1]!.trim().toLowerCase(), body: m[2]!, raw: m[0] });
    at = m.index! + m[0].length;
  }
  lines(text.slice(at));
  return out;
}

/** a fence's body: every non-empty line a call, a JSON object that names its tool, or a JSON object
 *  of bare arguments (kept on the block for the neighbour rule) */
function readFence(b: Extract<Block, { kind: 'fence' }>, tools: Map<string, PseudoTool>, calls: PseudoCall[]): void {
  const lines = b.body.split('\n').filter((l) => l.trim().length);
  if (!lines.length) return;
  const each = lines.map((l) => callExpr(l, tools));
  if (each.every((c) => c !== null)) { b.drop = true; calls.push(...(each as PseudoCall[])); return; }
  // one call spread over the fence's lines: `set_thread_title(\n  title="…",\n)`
  const one = callExpr(lines.map((l) => l.trim()).join(' '), tools);
  if (one) { b.drop = true; calls.push(one); return; }
  // JSON only under the labels a call wears: an ```nmq card is a card, whatever its keys
  if (!CALL_FENCES.has(b.info) || !b.body.trim().startsWith('{')) return;
  let v: unknown;
  try { v = JSON.parse(b.body); } catch { return; }
  if (!isObject(v)) return;
  const env = envelope(v, tools);
  if (env) { b.drop = true; b.call = env; calls.push(env); return; }
  b.json = v;
}

/** the keys a tool takes: its schema when known, else the keys the narrated call itself named */
function paramsOf(name: string, tools: Map<string, PseudoTool>, call?: PseudoCall): readonly string[] {
  return tools.get(name)?.params ?? (call?.args ? Object.keys(call.args) : []);
}

/** bare arguments belong to a call only when the tool takes every key */
function argsFit(json: Record<string, unknown>, params: readonly string[]): boolean {
  const keys = Object.keys(json);
  return keys.length > 0 && params.length > 0 && keys.every((k) => params.includes(k));
}

/** the reply with narrated tool calls removed, the calls, and how many calls went */
export function parsePseudoToolCalls(text: string, toolList: Iterable<string | PseudoTool>, opts: { streaming?: boolean } = {}): { text: string; calls: PseudoCall[]; stripped: number } {
  const tools = toolMap(toolList);
  if (!tools.size || !text) return { text, calls: [], stripped: 0 };
  const blocks = blocksOf(text);
  const calls: PseudoCall[] = [];
  for (const b of blocks) {
    if (b.kind === 'fence') { readFence(b, tools, calls); continue; }
    const whole = callExpr(b.raw, tools);
    if (whole) { b.drop = true; b.call = whole; calls.push(whole); continue; }
    const lead = leadingCall(b.raw, tools);
    if (lead) { b.raw = lead.rest; b.call = lead.call; calls.push(lead.call); }
  }
  // bare JSON arguments go with the narrated call beside them, blank lines between allowed
  const blank = (b: Block | undefined): boolean => !!b && b.kind === 'line' && !b.drop && !b.raw.trim();
  blocks.forEach((b, k) => {
    if (b.kind !== 'fence' || !b.json || b.drop) return;
    const json = b.json;
    for (const dir of [1, -1]) {
      let j = k + dir;
      while (blank(blocks[j])) j += dir;
      const call = blocks[j]?.call;
      if (call && argsFit(json, paramsOf(call.name, tools, call))) {
        call.args = { ...json, ...(call.args ?? {}) };
        b.drop = true;
        return;
      }
    }
  });
  // the leading bare-arguments fence of a tool that may run from text (the exception above)
  const first = blocks.findIndex((b) => !blank(b));
  const lead = blocks[first];
  if (lead?.kind === 'fence' && lead.json && !lead.drop && blocks.slice(first + 1).some((b) => !b.drop && b.raw.trim())) {
    // the tool's FULL argument set, both strings: a lone {"title": …} beside prose stays somebody's
    // answer (the round 4 ruling, pseudocalls.test.ts), while {"title", "description"} as the reply's
    // head is the narrated call the starter brain writes
    const j = lead.json;
    const full = Object.keys(j).length === 2 && typeof j['title'] === 'string' && typeof j['description'] === 'string';
    const fits = full ? [...RUN_NARRATED].find((name) => tools.has(name) && argsFit(j, paramsOf(name, tools))) : undefined;
    if (fits) { lead.drop = true; calls.push({ name: fits, args: lead.json }); }
  }
  let kept = blocks.filter((b) => !b.drop);
  if (opts.streaming) kept = holdBack(kept, tools);
  const joined = kept.map((b) => b.raw).join('');
  if (joined === text) return { text, calls, stripped: calls.length };
  return { text: joined.replace(/\n{3,}/g, '\n\n').trim(), calls, stripped: calls.length };
}

/** A LIVE BUBBLE types the reply as it arrives, so a narrated call is half written at some update.
 *  Display only: the tail that may still become a call waits for the next words. That is an
 *  unclosed fence that opens like one, a last line that already reads as the start of one, and
 *  bare JSON arguments that a call may follow. The posted reply never passes through here. */
function holdBack(kept: Block[], tools: Map<string, PseudoTool>): Block[] {
  let out = kept;
  const text = out.map((b) => b.raw).join('');
  const open = text.lastIndexOf('```');
  if (open >= 0 && (text.slice(0, open).match(/```/g)?.length ?? 0) % 2 === 0) {
    const head = /^```([^\n`]*)(?:\n([\s\S]*))?$/.exec(text.slice(open));
    const label = head ? head[1]!.trim().toLowerCase() : '';
    // before its line ends, the label may still be on its way: ```j becomes ```json
    const callish = head?.[2] === undefined ? [...CALL_FENCES].some((l) => l.startsWith(label)) : CALL_FENCES.has(label);
    const body = (head?.[2] ?? '').trim();
    if (head && callish && (!body || body.startsWith('{') || mayBecomeCall(body.split('\n')[0]!, tools))) {
      out = cutAt(out, open);
    }
  }
  const tail = out[out.length - 1];
  if (tail?.kind === 'line' && !tail.raw.endsWith('\n') && mayBecomeCall(tail.raw, tools)) out = out.slice(0, -1);
  let end = out.length - 1;
  while (end >= 0 && out[end]!.kind === 'line' && !out[end]!.raw.trim()) end--;
  const last = out[end];
  if (last?.kind === 'fence' && last.json && Object.keys(last.json).every((k) => [...tools.values()].some((t) => t.params?.includes(k)))) {
    out = out.slice(0, end);
  }
  return out;
}

/** the blocks up to a character offset into their joined text */
function cutAt(blocks: Block[], offset: number): Block[] {
  const out: Block[] = [];
  let at = 0;
  for (const b of blocks) {
    if (at + b.raw.length <= offset) { out.push(b); at += b.raw.length; continue; }
    const cut = b.raw.slice(0, offset - at);
    if (cut) out.push({ kind: 'line', raw: cut });
    break;
  }
  return out;
}

/** could this unfinished line still become a call? A fence's first backticks, an offered tool's
 *  name with its paren or link open, a link's bracket with the start of a tool's name, or four or
 *  more letters of an offered tool's name on a line of their own */
function mayBecomeCall(line: string, tools: Map<string, PseudoTool>): boolean {
  let s = line.trim();
  if (/^`{1,2}$/.test(s)) return true;
  if (s.startsWith('`')) s = s.slice(1);
  if (s.startsWith('print(')) s = s.slice('print('.length);
  const linked = s.startsWith('[');
  if (linked) s = s.slice(1).trimStart();
  s = s.replace(PREFIX, '');
  const name = /^[A-Za-z_]\w*/.exec(s)?.[0] ?? '';
  const rest = s.slice(name.length);
  if (!name) return linked && !rest.trim();
  if (tools.has(name)) return /^\s*(?:\]\s*)?(?:\(|$)/.test(rest);
  return !rest && (linked || name.length >= 4) && [...tools.keys()].some((t) => t.startsWith(name));
}

/** the reply with narrated tool calls removed, and how many were removed */
export function stripPseudoToolCalls(text: string, toolNames: Iterable<string | PseudoTool>): { text: string; stripped: number } {
  const r = parsePseudoToolCalls(text, toolNames);
  return { text: r.text, stripped: r.stripped };
}

/** the narrated call's arguments as the tool's own schema reads them (zod fields, read duck-typed so
 *  this file stays free of zod), or null when they do not satisfy it: a narrated call runs only with
 *  arguments a real call could have carried */
export function schemaArgs(schema: Record<string, unknown>, args: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!args) return null;
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(schema)) {
    const check = (field as { safeParse?: (v: unknown) => { success: boolean; data?: unknown } } | null)?.safeParse;
    if (typeof check !== 'function') return null;
    const r = check.call(field, args[key]);
    if (!r.success) return null;
    if (r.data !== undefined) out[key] = r.data;
  }
  return out;
}

/** SUGGESTION PILLS WRITTEN UNDER THE WRONG LABEL (2026-10-30, the Cloud Run feature suite): the
 *  starter brain ended rex's reply with its follow-ups as a ```json array instead of the ```nms
 *  fence the prompt asks for (packages/shared cards.ts), so the room saw a JSON block where the pills
 *  belong. A reply whose LAST block is a ```json (or bare) fence holding 2 to 4 short strings, with
 *  words before it and no ```nms of its own, gets that fence relabelled ```nms. Anything else stays:
 *  a longer list, other values, or a list that IS the whole answer is what a person asked for. */
export function relabelPillFence(text: string): string {
  if (!text || /```nms[ \t]*\n/.test(text)) return text;
  const m = /```(json|)[ \t]*\n([\s\S]*?)```\s*$/.exec(text);
  if (!m || !text.slice(0, m.index).trim()) return text;
  let v: unknown;
  try { v = JSON.parse(m[2]!); } catch { return text; }
  if (!Array.isArray(v) || v.length < 2 || v.length > 4) return text;
  if (!v.every((x) => typeof x === 'string' && x.trim().length >= 2 && x.trim().length <= 48)) return text;
  return `${text.slice(0, m.index)}\`\`\`nms\n${JSON.stringify(v)}\n\`\`\``;
}

/** A REPLY THAT IS ONLY A TOOL'S ARGUMENTS (2026-11-02, the Cloud Run feature suite): asked to file a
 *  task or draw a whiteboard, the starter brain answered with nothing but a ```json fence of the
 *  tool's arguments ({"title", "description", "kind", "legs", "approach"}, {"title", "mermaid"}) and
 *  never made the call, so nothing was filed and the room saw the JSON. When the whole reply is one
 *  JSON object that shares at least two keys with an offered tool, this names the tool that shares
 *  the most, so the turn can ask the model once to make the call. A reply with any words around the
 *  fence is an answer, and stays one. */
export function argumentsOnlyReply(text: string, toolList: Iterable<string | PseudoTool>): string | null {
  const m = /^```(json|)[ \t]*\n([\s\S]*?)```$/.exec(text.trim());
  if (!m) return null;
  let v: unknown;
  try { v = JSON.parse(m[2]!); } catch { return null; }
  if (!isObject(v)) return null;
  const keys = Object.keys(v);
  let best: { name: string; shared: number } | null = null;
  for (const tool of toolMap(toolList).values()) {
    const shared = keys.filter((k) => tool.params?.includes(k)).length;
    if (shared >= 2 && (!best || shared > best.shared)) best = { name: tool.name, shared };
  }
  return best?.name ?? null;
}
