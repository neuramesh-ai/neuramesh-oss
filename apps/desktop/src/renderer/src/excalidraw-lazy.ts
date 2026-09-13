// The ONE door to the Excalidraw bundle (docs/38). Everything whiteboard-shaped lazy-imports
// THIS module, so the ~MB of canvas code is a chunk the app pays for on first board open —
// never at boot (the <2s cold-start budget stays untouched; verify with the bundle report).
//
// Two side effects belong here and nowhere else:
//  - EXCALIDRAW_ASSET_PATH points the font loader at our bundled copy (vite-plugin-static-copy
//    ships dist/prod/fonts → excalidraw-assets/). Resolved against location.href so the same
//    relative layout works from the dev server and a packaged file:// load. Without this the
//    library falls back to a CDN, which the no-egress doctrine forbids.
//  - the library stylesheet rides this chunk, not the boot CSS.
import '@excalidraw/excalidraw/index.css';

(window as unknown as { EXCALIDRAW_ASSET_PATH?: string }).EXCALIDRAW_ASSET_PATH = new URL(
  'excalidraw-assets/',
  window.location.href,
).toString();

export {
  Excalidraw,
  convertToExcalidrawElements,
  exportToSvg,
  getSceneVersion,
  serializeAsJSON,
} from '@excalidraw/excalidraw';

/** A conversion that produced ONE image element is the library's fallback, not a drawing: it
 *  renders the diagram to SVG and hands back a picture whenever its own parser throws. */
const isFlatPicture = (out: { elements: readonly unknown[] }): boolean =>
  out.elements.length === 1 && (out.elements[0] as { type?: string } | undefined)?.type === 'image';

/**
 * Drop `subgraph` grouping while keeping everything inside it.
 *
 * mermaid-to-excalidraw 2.2.2 throws on subgraphs and falls back to a flat picture — measured, not
 * assumed: the same `flowchart TB` converts to 11 editable shapes without them and to 1 image with
 * them. An architecture map is the single most common whiteboard ask and subgraphs are how anyone
 * naturally writes one, so the grouping boxes are the cheapest thing to give up: what a human
 * actually wanted was boxes they can drag, and the layers survive in the node labels.
 */
function stripSubgraphs(src: string): string {
  let depth = 0;
  return src.split('\n').filter((line) => {
    if (/^\s*subgraph\b/.test(line)) { depth += 1; return false; }
    if (depth > 0 && /^\s*end\s*$/.test(line)) { depth -= 1; return false; }
    // `direction` is only legal inside a subgraph — it becomes a parse error once the block is gone
    return !(depth > 0 && /^\s*direction\s+\w+/.test(line));
  }).join('\n');
}

/** the mermaid converter is its own heavy chunk (bundles mermaid 11) — loaded only when a
 *  board actually carries a mermaid source */
export async function parseMermaid(value: string): Promise<{ elements: unknown[]; files?: Record<string, unknown> }> {
  const m = await import('@excalidraw/mermaid-to-excalidraw');
  const out = await m.parseMermaidToExcalidraw(value);
  // Retry WITHOUT the grouping boxes rather than shipping a picture onto an editable surface. Only
  // when the first pass already failed, so nothing that converts today converts differently.
  if (isFlatPicture(out) && /^\s*subgraph\b/m.test(value)) {
    const retry = await m.parseMermaidToExcalidraw(stripSubgraphs(value)).catch(() => null);
    if (retry && !isFlatPicture(retry)) {
      return { elements: retry.elements as unknown[], files: (retry.files ?? undefined) as Record<string, unknown> | undefined };
    }
  }
  return { elements: out.elements as unknown[], files: (out.files ?? undefined) as Record<string, unknown> | undefined };
}
