// Whiteboard tool descriptions (docs/38) — the text an agent reads to decide whether to draw.
// A description IS behaviour here, so these live apart from the bus that dispatches them.
// Split out of harness/toolbus.ts.




// Whiteboard descriptions live as consts because two registries speak them (this bus + the Claude
// in-process clones in agents.ts) and the two must never drift.
export const WB_CREATE_DESC =
  'Draw a WHITEBOARD the team can open and edit — filed to this room, its card dropped into this conversation immediately. Provide exactly ONE of `mermaid` or `elements` (an Excalidraw element-skeleton JSON array AS A STRING, for precise layouts).\n\nWITH MERMAID, open with EXACTLY one of `flowchart TB`/`LR`, `sequenceDiagram`, or `classDiagram`, and NEVER use `subgraph` — only those three arrive as real draggable shapes, and one `subgraph` line (or any other kind: `graph`, `mindmap`, `stateDiagram`, `erDiagram`…) collapses the whole board into ONE FLAT PICTURE. A state machine is a `flowchart LR`. Show layers by naming them IN the node (`UI["Surfaces · desktop app"]`) and by connection order; reach for `elements` when grouping boxes genuinely matter.';

export const WB_UPDATE_DESC =
  'Edit an EXISTING whiteboard in place — only when asked to, and only after read_whiteboard in this same turn: pass the rev you read as `baseRev`, and if the board has moved you are refused (WHITEBOARD_STALE) — re-read and reapply. A new `mermaid` or `elements` source REPLACES the whole drawing when a desktop re-renders it, including any hand-drawn edits — so keep a human\'s board intact unless they asked for the change. A `title` alone renames.';

export const WB_LIST_DESC =
  'List the whiteboards this room can see (or the whole workspace with all:true): title, id, rev, who made it, and whether it is still waiting for a desktop to draw it. Use it to find the board someone is talking about before reading or editing it.';

export const WB_READ_DESC =
  'Read one whiteboard by id: its title, current rev (you need this for update_whiteboard), and its content — the Excalidraw scene JSON (elements with type/x/y/text), or the pending mermaid/skeleton source if no desktop has drawn it yet.';
