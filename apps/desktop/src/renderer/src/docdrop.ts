/**
 * The doc-drop card shape: a document posted INTO a thread, worn as a readable card.
 *
 * Two shapes, one parser. A doc "saved to" the library is already on the shelf and the card just
 * reads it. A doc "proposed for" the library is an unpromoted artifact — `promoted` is what the
 * Library view actually shows, so until a human approves, the draft exists only in the thread.
 * That distinction is the whole gate: agents draft, humans keep the library.
 *
 * Extracted from App.tsx so the regex is testable — a parser that silently stops matching would
 * turn every document card back into an endless wall of message text with no visible failure.
 */
export interface DocDrop {
  label: string;
  file: string;
  doc: string;
  /** true when the doc is awaiting the human's Approve rather than already in the library */
  pending: boolean;
}

const SHAPE = /^📄 \*\*(.+?)\*\* — (saved to|proposed for) the library as `(.+?)`\.\n\n([\s\S]+)$/;

export function docDropParts(body: string): DocDrop | null {
  const m = SHAPE.exec(body);
  return m ? { label: m[1]!, file: m[3]!, doc: m[4]!, pending: m[2] === 'proposed for' } : null;
}
