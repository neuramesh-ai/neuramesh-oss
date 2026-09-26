// THE MARKDOWN BODY, block by block (render round, 2026-09-24).
//
// react-markdown parses everything it is handed, every render. This renders the same markdown as
// top-level blocks (md/blocks.ts), each one a memo whose parsed elements also sit in one shared LRU
// cache keyed by the block's source. So:
//   · a streaming reply re-parses only its tail block per step, never what is already on screen;
//   · the synced message that replaces the bubble finds every block already parsed (the bubble
//     parsed them a moment ago), so landing costs DOM, not markdown;
//   · re-opening a thread, or re-rendering a row for an unrelated prop, parses nothing.
//
// The cache can be shared across instances only because the elements do not close over any one
// Md's props: the link handlers are read from context at render time (MdLinks in md/Md.tsx), so a
// cached element renders the same wherever it lands. The output is the single parse's DOM exactly —
// blocks joined by the line feed react-markdown itself puts between top-level nodes (md/MdBody.test.ts).
import { memo, useMemo, type ReactNode } from 'react';
import Markdown, { defaultUrlTransform, type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { splitBlocks } from './blocks';

export const REMARK_PLUGINS = [remarkGfm];
/** react-markdown sanitizes unknown URL protocols to '' — keep our internal nm: deep-links alive */
export const mdUrlTransform = (url: string): string => (url.startsWith('nm:') ? url : defaultUrlTransform(url));

type HastNode = { type: string; tagName?: string; value?: string; children?: HastNode[]; properties?: Record<string, unknown> };
/** the streaming caret, INSIDE the last line of text (not on a line of its own below it), so
 *  removing it when the reply finishes moves nothing */
const BLOCKY = new Set(['ul', 'ol', 'li', 'blockquote', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'pre', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
function rehypeCaret() {
  return (tree: HastNode) => {
    // descend through the LAST block-level element (and a code block's <code>), never into inline
    // marks, so the caret sits after the last character in the text's own flow
    let node = tree;
    for (;;) {
      const kids = (node.children ?? []).filter((k) => !(k.type === 'text' && !k.value?.trim()));
      const last = kids[kids.length - 1];
      if (!last || last.type !== 'element') break;
      if (!BLOCKY.has(last.tagName!) && !(node.tagName === 'pre' && last.tagName === 'code')) break;
      node = last;
    }
    const caret: HastNode = { type: 'element', tagName: 'span', properties: { className: ['streamcaret'], ariaHidden: 'true' }, children: [] };
    const kids = (node.children ??= []);
    const tail = kids[kids.length - 1];
    // a code block's text ends in a line feed: the caret goes before it, on the last code line
    if (tail?.type === 'text' && tail.value?.endsWith('\n')) {
      tail.value = tail.value.slice(0, -1);
      kids.push(caret, { type: 'text', value: '\n' });
    } else kids.push(caret);
  };
}
const CARET_PLUGINS = [rehypeCaret];

// one LRU per component set (in practice one: md/Md.tsx's), keyed by the block's source
const caches = new WeakMap<Components, Map<string, ReactNode>>();
const CACHE_MAX = 1200;

/** one block's elements: parsed once per source text, shared by every Md that shows it */
export function parseBlock(text: string, components: Components, caret = false): ReactNode {
  if (caret) return Markdown({ children: text, remarkPlugins: REMARK_PLUGINS, rehypePlugins: CARET_PLUGINS, urlTransform: mdUrlTransform, components });
  let cache = caches.get(components);
  if (!cache) caches.set(components, (cache = new Map()));
  const hit = cache.get(text);
  if (hit !== undefined) { cache.delete(text); cache.set(text, hit); return hit; }
  const out = Markdown({ children: text, remarkPlugins: REMARK_PLUGINS, urlTransform: mdUrlTransform, components });
  cache.set(text, out);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
  return out;
}

const MdBlock = memo(function MdBlock({ text, components, caret }: { text: string; components: Components; caret: boolean }) {
  return <>{parseBlock(text, components, caret)}</>;
});

/** markdown → the same DOM as one react-markdown pass, parsed and memoized per top-level block */
export function MdBody({ text, components, caret = false }: { text: string; components: Components; caret?: boolean }) {
  const blocks = useMemo(() => splitBlocks(text), [text]);
  const out: ReactNode[] = [];
  blocks.forEach((b, i) => {
    if (i) out.push('\n');
    out.push(<MdBlock key={i} text={b} components={components} caret={caret && i === blocks.length - 1} />);
  });
  return <>{out}</>;
}
