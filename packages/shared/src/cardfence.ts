// CARD FENCES A MODEL BENT (George, 2026-10-02: "why is the interface still sometimes not rendering nmq
// … and posting it as json?"). A card is a fenced ```nm<kind> block of JSON that a model writes by hand,
// and a small model bends it: the opening brace rides the fence line ("```nmq {"), or never comes, a
// trailing comma ends a list, or the closing fence sits on the last JSON line. Every parser then misses
// the card: the block prints as code, and the server mints no decision row, so the question the agent
// stopped to ask reaches nobody. This puts the block back in its shape. The server runs it on every agent
// message before it stores one, and the clients run it on the messages stored before that.
//
// Pure. A block that is already valid JSON in a clean fence stays byte for byte. A block that no repair
// can parse stays as it was, so the nmq parser's YAML reading (cards.ts parseQuestionBlock) still gets
// its turn.

/**
 * Each ```nm<kind> opener of `body`, in order, as the regex /```(nm[a-z]+)([^\n]*)\n/g matched them:
 * where it starts, its kind, the rest of its line, and its length up to the line end. A hand scan,
 * because the regex backtracked in quadratic time on a long line with no line end (CodeQL
 * js/polynomial-redos, 2026-10-04): the kind and the rest of the line both take letters.
 */
function* openers(body: string): Generator<{ index: number; lang: string; rest: string; length: number }> {
  let at = body.indexOf('```nm');
  while (at !== -1) {
    let k = at + 5;
    while (k < body.length && body.charCodeAt(k) >= 97 && body.charCodeAt(k) <= 122) k++; // [a-z]
    if (k === at + 5) { at = body.indexOf('```nm', at + 1); continue; } // no kind after nm
    const nl = body.indexOf('\n', k);
    if (nl === -1) return; // no line end after it, so no opener after it either
    yield { index: at, lang: body.slice(at + 3, k), rest: body.slice(k, nl), length: nl + 1 - at };
    at = body.indexOf('```nm', nl + 1);
  }
}

const parses = (s: string): boolean => {
  try { const v: unknown = JSON.parse(s); return !!v && typeof v === 'object'; } catch { return false; }
};

/** the JSON a model meant, pretty-printed, or null: a trailing comma, a missing outer brace, both braces */
export function repairCardJson(inner: string): string | null {
  const t = inner.trim().replace(/,(\s*[}\]])/g, '$1');
  const tries = t.startsWith('"') ? [t, `{${t}`, `{${t}}`] : [t];
  for (const s of tries) if (parses(s)) return JSON.stringify(JSON.parse(s), null, 2);
  return null;
}

/** every ```nm<kind> block of `body` in a clean fence with JSON a parser reads, where a repair can get it there */
export function repairCardFences(body: string): string {
  if (!body.includes('```nm')) return body;
  let out = '';
  let from = 0;
  for (const m of openers(body)) {
    const start = m.index;
    if (start < from) continue;
    const lang = m.lang;
    const rest = m.rest.trim();
    if (rest && !rest.startsWith('{') && !rest.startsWith('[')) continue; // an info string, never JSON
    const innerStart = start + m.length;
    const close = body.indexOf('```', innerStart);
    if (close === -1) break; // a block still streaming: nothing to repair yet
    const inner = `${rest ? `${rest}\n` : ''}${body.slice(innerStart, close)}`.replace(/\n$/, '');
    const clean = !rest && m.rest === '' && body[close - 1] === '\n' && parses(inner);
    const fixed = clean ? null : parses(inner) ? inner : repairCardJson(inner);
    if (fixed !== null) {
      out += `${body.slice(from, start)}\`\`\`${lang}\n${fixed}\n\`\`\``;
      from = close + 3;
    }
  }
  return from ? out + body.slice(from) : body;
}

/** the words of `body` with every ```nm<kind> block removed, a block still streaming too: a one-line preview never prints a card */
export function stripCardFences(body: string): string {
  if (!body.includes('```nm')) return body;
  let out = '';
  let from = 0;
  for (let at = body.indexOf('```nm'); at !== -1; at = body.indexOf('```nm', from)) {
    out += body.slice(from, at);
    const close = body.indexOf('```', at + 5);
    if (close === -1) return out.trim();
    from = close + 3;
  }
  return (out + body.slice(from)).trim();
}
