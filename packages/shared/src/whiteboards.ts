// Whiteboards (docs/38) — the pure, shared half.
//
// One vocabulary for every surface that touches a board: the size caps the server enforces and
// the client pre-checks (one number, two readers — a cap that drifts is a save that 400s only
// in prod), the `source` envelope an agent's pending mermaid/element-skeleton rides in until a
// desktop materializes it, and the share-marker a thread message carries so the renderer can
// swap it for a snapshot card. No I/O, no Excalidraw import — the heavy library stays a lazy
// renderer chunk; this is just the contract.

export const WB_TITLE_MAX = 200;
export const WB_MERMAID_MAX = 100_000;
/** the scene JSON text cap — a typical diagram is 5–50KB; embedded images are the thing this excludes */
export const WB_SCENE_MAX = 524_288;
/** the exported SVG still — every card/tile renders this, so it stays small enough to sync freely */
export const WB_SNAPSHOT_MAX = 153_600;

export type WhiteboardSourceKind = 'mermaid' | 'elements';

/** A pending generation source: mermaid text, or an element-skeleton JSON string. */
export interface WhiteboardSource {
  kind: WhiteboardSourceKind;
  value: string;
}

/** Canonical JSON for the `source` column. */
export function whiteboardSource(kind: WhiteboardSourceKind, value: string): string {
  return JSON.stringify({ kind, value });
}

export function parseWhiteboardSource(text: string | null | undefined): WhiteboardSource | null {
  if (!text) return null;
  try {
    const v = JSON.parse(text) as { kind?: unknown; value?: unknown };
    if ((v.kind === 'mermaid' || v.kind === 'elements') && typeof v.value === 'string' && v.value.length > 0) {
      return { kind: v.kind, value: v.value };
    }
  } catch {
    /* a malformed source renders as "needs the desktop to draw it" — never a throw */
  }
  return null;
}

/** The scene shape every reader relies on. Lenient: a board with an unreadable scene is empty, not fatal. */
export interface WhiteboardScene {
  elements: unknown[];
  appState?: Record<string, unknown>;
}

export function parseWhiteboardScene(text: string | null | undefined): WhiteboardScene | null {
  if (!text) return null;
  try {
    const v = JSON.parse(text) as { elements?: unknown; appState?: unknown };
    if (!Array.isArray(v.elements)) return null;
    const appState = v.appState && typeof v.appState === 'object' ? (v.appState as Record<string, unknown>) : undefined;
    return { elements: v.elements, appState };
  } catch {
    return null;
  }
}

// ── The share marker ──────────────────────────────────────────────────────────────────────────
// A shared board rides a normal message: a plain-text label line (so mobile and any surface
// without the card renders something readable), then an invisible-idiom guillemet marker naming
// the board id (the ‹cards:…› family). The card renderer swaps the marker for the snapshot card
// and keeps whatever prose surrounds it.

const WB_REF_RE = /‹wb:([0-9a-fA-F-]{36})›/;

/** The message body Share-to-chat posts. `note` rides above the label when the sharer adds one. */
export function whiteboardShareBody(title: string, id: string, note?: string): string {
  const label = `⊞ **${title.slice(0, WB_TITLE_MAX)}** — whiteboard`;
  const head = note?.trim() ? `${note.trim()}\n\n${label}` : label;
  return `${head}\n‹wb:${id}›`;
}

export interface WhiteboardRef {
  id: string;
  /** the body with the marker removed, label line KEPT — the fallback for surfaces without the card */
  body: string;
  /** the body with the marker AND the label line removed — what renders beside the card */
  prose: string;
}

const WB_LABEL_RE = /^⊞ \*\*.{0,220}\*\* — whiteboard[ \t]*$\n?/m;

/** First whiteboard marker in a body, or null. */
export function parseWhiteboardRef(body: string | null | undefined): WhiteboardRef | null {
  if (!body) return null;
  const m = WB_REF_RE.exec(body);
  if (!m) return null;
  const tidy = (s: string): string => s.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
  const stripped = tidy(body.replace(WB_REF_RE, ''));
  return { id: m[1]!.toLowerCase(), body: stripped, prose: tidy(stripped.replace(WB_LABEL_RE, '')) };
}
