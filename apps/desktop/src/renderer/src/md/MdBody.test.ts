// THE BLOCKS RENDER THE SAME DOM AS ONE PARSE — the contract md/blocks.ts and md/MdBody.tsx exist under.
//
// Md used to hand react-markdown the whole text on every render. It now renders the same text as
// top-level blocks, each parsed once and cached (the render round, 2026-09-24), so a streaming
// reply re-parses only the block still growing. That is only safe if nobody can tell: a finished
// reply, and every prefix of it along the way, must produce exactly the markup a single
// react-markdown pass produces. This file holds a corpus to that, prefix by prefix.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown from 'react-markdown';
import { splitBlocks } from './blocks';
import { MD_COMPONENTS, Md } from './Md';
import { REMARK_PLUGINS, mdUrlTransform, MdBody } from './MdBody';

/** the reference: one react-markdown pass over the whole text, exactly what Md did before blocks */
const single = (text: string) => renderToStaticMarkup(h('div', { className: 'md' }, h(Markdown, { remarkPlugins: REMARK_PLUGINS, urlTransform: mdUrlTransform, components: MD_COMPONENTS }, text)));
const blocks = (text: string, caret = false) => renderToStaticMarkup(h('div', { className: 'md' }, h(MdBody, { text, components: MD_COMPONENTS, caret })));

const fence = (lang: string, lines: number) => '```' + lang + '\n' + Array.from({ length: lines }, (_, i) => `const line${i} = compute(${i}); // step ${i}`).join('\n') + '\n```';
const CORPUS: Record<string, string> = {
  prose: 'The sync layer replays the queue in order.\n\nA write made offline lands **exactly once** when the socket returns, and `watchConvo` re-queries on change.\n\nThat is the whole change.',
  headings: '# Title\n\nIntro line.\n\n## Section\n\nBody with a [link](https://example.com) and *emphasis*.\n\n### Deeper\n\nSetext below\n===\n\nand a rule\n\n---\n\nafter the rule.',
  fenceWithBlankLines: 'Before the code.\n\n```ts\nconst a = 1;\n\n\nconst b = 2;\n\n// a comment after two blank lines\n```\n\nAfter the code.',
  tildeFence: 'Text.\n\n~~~bash\nnpm i\n\n```\nnot a close\n```\n\nstill inside\n~~~\n\nOut.',
  longFence: `Here is the patch.\n\n${fence('ts', 40)}\n\nIt compiles.`,
  looseList: '- first item\n\n- second item, loose\n\n- third item\n\nA paragraph that ends the list.',
  orderedLoose: '1. one\n\n2. two\n\n3. three\n\nDone.',
  listContinuation: '- item with a continuation\n\n  continued paragraph inside the item\n\n- next item\n\nOutside.',
  nestedList: '- a\n  - a.1\n  - a.2\n\n- b\n\nAfter.',
  paragraphThenList: 'Steps:\n\n1. install\n2. run\n\nThen:\n\n- check\n- ship',
  table: 'Numbers:\n\n| Surface | p50 | p95 | Notes |\n|---|---|---|---|\n| send | 38 ms | 61 ms | local |\n| recall | 67 ms | 113 ms | warm |\n\nThat is all.',
  tableWithHex: '| token | value |\n|---|---|\n| --accent | #834a2b |\n| --link | #9c5730 |\n\nInline `#fff7ee` swatch.',
  blockquote: '> quoted line one\n> quoted line two\n\n> second quote\n\nNormal.',
  indentedCode: 'Paragraph.\n\n    indented code line\n\n    more indented code\n\nBack to prose.',
  taskList: '- [x] done thing\n- [ ] open thing\n\nNext.',
  strikeAndAutolink: 'Old ~~plan~~ new plan at www.example.com and https://neuramesh.app/x.\n\nEnd.',
  definitions: 'See [the doc][doc] for details.\n\nMore text.\n\n[doc]: https://example.com/doc',
  footnotes: 'A claim with a note.[^1]\n\nMore.\n\n[^1]: The note itself.',
  html: 'Before.\n\n<div>\n\nraw html block\n\n</div>\n\nAfter.',
  hardBreaks: 'line one  \nline two\\\nline three\n\nnext para',
  unicode: 'Arrows → and quotes “like this” and emoji 🦭.\n\n日本語の段落。\n\nDone.',
  trailingBlanks: 'Ends with blank lines.\n\n\n\n',
  leadingBlanks: '\n\n\nStarts after blank lines.\n\nSecond.',
  mixed: [
    'I measured the cold path twice.', '### What changed', '- **Tables and code**: the parser sees the whole block.\n- The fix is small.\n- We keep the gate human-only.',
    fence('sql', 7), 'Then the table:', '| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |', '1. first\n2. second', '> a quote to end', 'Closing line.',
  ].join('\n\n'),
};

describe('splitBlocks — split only where nothing can reach across', () => {
  test('prose splits at blank lines', () => {
    assert.deepEqual(splitBlocks('a\n\nb\n\nc'), ['a', 'b', 'c']);
  });
  test('a code fence with blank lines inside stays one block', () => {
    assert.equal(splitBlocks(CORPUS.fenceWithBlankLines!).length, 3);
    assert.ok(splitBlocks(CORPUS.fenceWithBlankLines!)[1]!.includes('const b = 2;'));
  });
  test('a fence that is still open (streaming) keeps the rest of the text', () => {
    assert.deepEqual(splitBlocks('para\n\n```ts\nconst a = 1;\n\nconst b'), ['para', '```ts\nconst a = 1;\n\nconst b']);
  });
  test('a loose list is one block, the paragraph after it is not', () => {
    const b = splitBlocks(CORPUS.looseList!);
    assert.equal(b.length, 2);
    assert.ok(b[0]!.includes('third item'));
  });
  test('an indented continuation never starts a block', () => {
    assert.equal(splitBlocks(CORPUS.listContinuation!).length, 2);
    assert.equal(splitBlocks(CORPUS.indentedCode!).length, 2); // the indented lines ride the paragraph's block
  });
  test('definitions, footnotes and raw HTML make the whole text one block', () => {
    for (const k of ['definitions', 'footnotes', 'html'] as const) assert.equal(splitBlocks(CORPUS[k]!).length, 1, k);
  });
});

describe('the block render equals one react-markdown pass', () => {
  for (const [name, text] of Object.entries(CORPUS)) {
    test(`${name}: the finished text`, () => {
      assert.equal(blocks(text), single(text));
    });
  }
  test('every prefix of every corpus text renders the same, as a stream would show it', () => {
    let checked = 0;
    for (const [name, text] of Object.entries(CORPUS)) {
      for (let n = 1; n <= text.length; n += 7) {
        const p = text.slice(0, n);
        assert.equal(blocks(p), single(p), `${name} @${n}: ${JSON.stringify(p.slice(-40))}`);
        checked++;
      }
    }
    assert.ok(checked > 400, `checked ${checked} prefixes`);
  });
});

// seeded random documents: every block kind, joined by one to three blank lines, so the split rule
// meets combinations nobody wrote down (lists after fences, quotes after tables, loose lists…)
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let x = a; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
}
const PIECES: Array<(r: () => number) => string> = [
  () => 'A plain sentence with **bold**, _em_ and `code`.',
  () => '- one\n- two\n- three',
  () => '- loose one\n\n- loose two',
  () => '1. first\n2. second',
  () => '  indented continuation line',
  (r) => fence(r() < 0.5 ? 'ts' : 'sql', 2 + Math.floor(r() * 6)),
  () => '```\nunlabelled fence\n\nwith a gap\n```',
  () => '| h1 | h2 |\n|---|---|\n| a | b |',
  () => '> a quote\n> continued',
  () => '### A heading',
  () => '---',
  () => '    indented code',
  () => 'Swatch #834a2b in prose.',
];
const doc = (seed: number) => {
  const r = rng(seed); const n = 3 + Math.floor(r() * 7);
  return Array.from({ length: n }, () => PIECES[Math.floor(r() * PIECES.length)]!(r)).join('\n'.repeat(2 + Math.floor(r() * 2)));
};

describe('seeded documents', () => {
  test('80 random documents and their prefixes render the same as one pass', () => {
    for (let seed = 1; seed <= 80; seed++) {
      const text = doc(seed);
      assert.equal(blocks(text), single(text), `seed ${seed}`);
      for (let n = 1; n < text.length; n += 11) assert.equal(blocks(text.slice(0, n)), single(text.slice(0, n)), `seed ${seed} @${n}`);
    }
  });
});

describe('Md end to end', () => {
  test('Md renders the body through blocks and still lifts the cards out', () => {
    const text = `${CORPUS.mixed}\n\n\`\`\`nmq\n{"question":"Ship it?","options":[{"label":"Yes"},{"label":"No"}]}\n\`\`\``;
    const out = renderToStaticMarkup(h(Md, { text }));
    assert.ok(out.startsWith(single(CORPUS.mixed!).slice(0, -'</div>'.length)), 'the markdown body is the single-pass markup');
    assert.ok(out.includes('Ship it?'), 'the question card renders after the body');
    assert.ok(!out.includes('```nmq') && !out.includes('language-nmq'), 'the transport fence never renders as code');
  });
});

describe('the streaming caret', () => {
  test('rides inside the last line of text, never on a line of its own', () => {
    const para = blocks('First para.\n\nSecond para grows', true);
    assert.match(para, /<p>Second para grows<span class="streamcaret" aria-hidden="true"><\/span><\/p><\/div>$/);
    const list = blocks('- a\n- b grows', true);
    assert.match(list, /<li>b grows<span class="streamcaret" aria-hidden="true"><\/span><\/li>/);
    const code = blocks('```ts\nconst a = 1;\nconst b', true);
    assert.match(code, /const b<span class="streamcaret" aria-hidden="true"><\/span>\n<\/code>/);
  });
  test('removing it leaves exactly the markup without it', () => {
    for (const text of Object.values(CORPUS)) {
      assert.equal(blocks(text, true).replace('<span class="streamcaret" aria-hidden="true"></span>', ''), blocks(text));
    }
  });
});
