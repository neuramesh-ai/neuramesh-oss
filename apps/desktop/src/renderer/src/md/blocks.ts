// SPLIT MARKDOWN INTO TOP-LEVEL BLOCKS THAT PARSE THE SAME APART AS TOGETHER (render round, 2026-09-24).
//
// Why: react-markdown parses the WHOLE text on every render. A streaming reply grows a few words at
// a time, so every frame re-parsed and re-diffed everything already on screen: O(length) work per
// token, O(length²) per reply. Split into blocks, only the block still growing (the tail) changes;
// every finished block is a cache hit (md/MdBody.tsx).
//
// The rule is conservative on purpose: a split is taken ONLY where the markdown before it cannot
// reach past it. Anything that could — a definition or footnote that other blocks refer to, raw
// HTML — makes the whole text one block, which is exactly the old single parse. The equivalence
// test (md/MdBody.test.ts) holds a corpus to "the blocks render the same DOM as one parse".
//
// A split point is a run of blank lines, outside a code fence, followed by a line that:
//   · is not indented (indented = a continuation, or indented code);
//   · is not a list item when the text before it holds a list (a blank line between items keeps
//     one loose list, and splitting it would render two lists).

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const LIST_ITEM = /^ {0,3}(?:[-+*]|\d{1,9}[.)])(?:[ \t]|$)/;
// constructs whose effect crosses blocks: link/footnote definitions, footnote references, raw HTML
const DEFINITION = /^ {0,3}\[[^\]]+\]:/;
const FOOTNOTE_REF = /\[\^[^\]\s]+\]/;
const HTML_START = /^ {0,3}<[A-Za-z!?/]/;

/** the top-level blocks of `text`; `blocks.join('\n\n')` never needs to equal `text` — each block is
 *  the exact source slice between split points, and the renderer joins them with a line feed */
export function splitBlocks(text: string): string[] {
  if (FOOTNOTE_REF.test(text)) return [text];
  const out: string[] = [];
  let fence: { ch: string; len: number } | null = null;
  let blockStart = 0;
  let blockHasList = false;
  let pos = 0;
  let blank = false; // the previous line was blank (outside a fence)
  let blankFrom = -1; // where the current run of blank lines began
  while (pos <= text.length) {
    let end = text.indexOf('\n', pos);
    if (end === -1) end = text.length;
    const line = text.slice(pos, end);
    if (fence) {
      const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
      if (close && close[1]![0] === fence.ch && close[1]!.length >= fence.len) fence = null;
      blank = false;
    } else if (!line.trim()) {
      if (!blank) blankFrom = pos;
      blank = true;
    } else {
      if (DEFINITION.test(line) || HTML_START.test(line)) return [text];
      if (blank && pos > 0 && blankFrom > blockStart) {
        const indented = line[0] === ' ' || line[0] === '\t';
        const listy = LIST_ITEM.test(line);
        if (!indented && !(listy && blockHasList)) {
          out.push(text.slice(blockStart, blankFrom - 1));
          blockStart = pos;
          blockHasList = false;
        }
      }
      blank = false;
      if (LIST_ITEM.test(line)) blockHasList = true;
      const open = FENCE_OPEN.exec(line);
      if (open && !(open[1]![0] === '`' && open[2]!.includes('`'))) fence = { ch: open[1]![0]!, len: open[1]!.length };
    }
    if (end >= text.length) break;
    pos = end + 1;
  }
  out.push(text.slice(blockStart));
  return out;
}
