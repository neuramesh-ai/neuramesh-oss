// Text helpers that cost the input once. A regex with a repetition that can split a run of the
// same character two ways (`[ \t]+$`, `-+$`, a lazy body between an opener that recurs and a closer
// that may be absent) backtracks in the square of the input, and CodeQL's js/polynomial-redos
// names every one (the 2026-09-18 sweep of the public repository: 48 of them). /v1/messages caps
// no body, and these parsers run on every agent body, server side and on the host. Each helper
// here does what its regex did, by index, in one pass, and the test pins the equivalence against
// the regex it replaced.

/** `s` without its trailing characters from `set`: what `s.replace(/[set]+$/, '')` returns. */
export function trimEndChars(s: string, set: string): string {
  let e = s.length;
  while (e > 0 && set.includes(s[e - 1]!)) e--;
  return e === s.length ? s : s.slice(0, e);
}

/** `s` without its leading characters from `set`: what `s.replace(/^[set]+/, '')` returns. */
export function trimStartChars(s: string, set: string): string {
  let b = 0;
  while (b < s.length && set.includes(s[b]!)) b++;
  return b === 0 ? s : s.slice(b);
}

/** every line's trailing spaces and tabs removed: what `body.replace(/[ \t]+$/gm, '')` returns.
 *  A multiline `$` stands before \n, \r, \u2028 and \u2029, and at the end. */
export function trimLineEnds(body: string): string {
  const parts: string[] = [];
  let keepFrom = 0;
  let run = -1; // where the current run of blanks began
  for (let i = 0; i < body.length; i++) {
    const c = body.charCodeAt(i);
    if (c === 0x20 || c === 0x09) { if (run === -1) run = i; continue; }
    if (run !== -1) {
      if (c === 0x0a || c === 0x0d || c === 0x2028 || c === 0x2029) { parts.push(body.slice(keepFrom, run)); keepFrom = i; }
      run = -1;
    }
  }
  if (run !== -1) { parts.push(body.slice(keepFrom, run)); keepFrom = body.length; }
  if (keepFrom === 0) return body;
  parts.push(body.slice(keepFrom));
  return parts.join('');
}

/** The first ```` ```<lang>\n … \n``` ```` block: what `/```<lang>\n([\s\S]*?)\n```/.exec(body)` finds.
 *  The first opener and the first closer after it, because a closer after a later opener is a
 *  closer after the first one too. */
export function fencedBlock(body: string, lang: string): { inner: string; start: number; end: number } | null {
  const open = '```' + lang + '\n';
  const start = body.indexOf(open);
  if (start === -1) return null;
  const innerStart = start + open.length;
  const close = body.indexOf('\n```', innerStart);
  if (close === -1) return null;
  return { inner: body.slice(innerStart, close), start, end: close + 4 };
}

/** every such block removed: what `body.replace(/```<lang>\n[\s\S]*?\n```/g, '')` returns. */
export function stripFenced(body: string, lang: string): string {
  let out = '';
  let rest = body;
  for (;;) {
    const b = fencedBlock(rest, lang);
    if (!b) return out + rest;
    out += rest.slice(0, b.start);
    rest = rest.slice(b.end);
  }
}

/** the line terminators `.` never crosses */
const LINE_END = /\r\n|[\n\r\u2028\u2029]/;

/** `text` split into the lines a regex `.` sees. */
export function dotLines(text: string): string[] {
  return text.split(LINE_END);
}

/** whether a line of `text` holds `first` and, after it, `then`: what `/first.*then/` finds, by
 *  index, so a text of many `first` is scanned once. Lowercase both sides for a case-blind test. */
export function lineHas(text: string, first: string, then: string): boolean {
  return dotLines(text).some((line) => {
    const at = line.indexOf(first);
    return at !== -1 && line.indexOf(then, at + first.length) !== -1;
  });
}

/** the first `[.!?]` in `text` and everything after it removed: the first sentence of a prompt. */
export function firstSentence(text: string): string {
  const m = /[.!?]/.exec(text);
  return m ? text.slice(0, m.index) : text;
}
