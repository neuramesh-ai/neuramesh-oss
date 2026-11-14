// Parse narrated tool argument values without evaluation.
import type { PseudoTool } from './pseudocalls';

export const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export function closeOf(s: string, i: number): number {
  const open = s[i];
  if (open === '"' || open === "'") {
    for (let j = i + 1; j < s.length; j++) {
      if (s[j] === '\\') j++;
      else if (s[j] === open) return j;
    }
    return -1;
  }
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    const ch = s[j]!;
    if (ch === '"' || ch === "'") {
      const end = closeOf(s, j);
      if (end < 0) return -1;
      j = end;
    } else if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if ((ch === ')' || ch === ']' || ch === '}') && --depth === 0) return j;
  }
  return -1;
}

/** one quoted string's contents, with the usual backslash escapes */
function unquote(raw: string): string {
  let out = '';
  for (let j = 1; j < raw.length - 1; j++) {
    const ch = raw[j]!;
    if (ch !== '\\') { out += ch; continue; }
    const nx = raw[++j] ?? '';
    if (nx === 'n') out += '\n';
    else if (nx === 't') out += '\t';
    else if (nx === 'r') out += '\r';
    else if (nx === 'u' && /^[0-9a-fA-F]{4}$/.test(raw.slice(j + 1, j + 5))) { out += String.fromCharCode(parseInt(raw.slice(j + 1, j + 5), 16)); j += 4; }
    else out += nx;
  }
  return out;
}

/** one value of a kwargs list at `i`: a quoted string, JSON, a number or a literal */
function readValue(s: string, i: number): { value: unknown; end: number } | null {
  const c = s[i];
  if (c === '"' || c === "'" || c === '{' || c === '[') {
    const close = closeOf(s, i);
    if (close < 0) return null;
    const raw = s.slice(i, close + 1);
    if (c === '"' || c === "'") return { value: unquote(raw), end: close + 1 };
    try { return { value: JSON.parse(raw), end: close + 1 }; } catch { return null; }
  }
  const lit = /^(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|True|False|null|None)\b/.exec(s.slice(i));
  if (!lit) return null;
  const word = lit[1]!;
  const value = word === 'true' || word === 'True' ? true : word === 'false' || word === 'False' ? false : word === 'null' || word === 'None' ? null : Number(word);
  return { value, end: i + word.length };
}

/** `title="x", description='y'`, `title: "x"`, or positional values in the tool's parameter order */
function parseKwargs(s: string, tool: PseudoTool): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  let i = 0;
  let pos = 0;
  const space = (): void => { while (i < s.length && /\s/.test(s[i]!)) i++; };
  for (;;) {
    space();
    if (i >= s.length) return out;
    const key = /^([A-Za-z_]\w*)\s*[=:]\s*/.exec(s.slice(i));
    if (key) i += key[0].length;
    const v = readValue(s, i);
    if (!v) return null;
    i = v.end;
    const name = key ? key[1]! : tool.params?.[pos];
    if (!name) return null;
    out[name] = v.value;
    pos++;
    space();
    if (i >= s.length) return out;
    if (s[i] !== ',') return null;
    i++;
  }
}

export function parseArgs(inner: string, tool: PseudoTool): Record<string, unknown> | null {
  const s = inner.trim();
  if (!s) return {};
  if (s.startsWith('{')) {
    try {
      const v: unknown = JSON.parse(s);
      if (isObject(v)) return v;
    } catch { /* not one JSON object: it may still be a kwargs list */ }
  }
  return parseKwargs(s, tool);
}
