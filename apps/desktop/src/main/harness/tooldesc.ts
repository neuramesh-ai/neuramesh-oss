// Whiteboard tool descriptions (docs/38) — the text an agent reads to decide whether to draw.
// A description IS behaviour here, so these live apart from the bus that dispatches them.
// Split out of harness/toolbus.ts.
import type { z as Zod } from 'zod';




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

// The repository reads (docs/design/github-connector-2026-09): three registries speak them (the
// orchestrator's, the conversation's, the worker bus + its Claude clones), one implementation
// answers (host/reporead.ts), so the words live here once.
export const REPO_CHANGES_DESC =
  'What shipped in this room\'s project repository: the releases (newest first, with their notes), the pull requests merged since a date, the tags when nothing is released, the commits on the default branch. Use it for any question about what shipped or what a release contains, and for release drafts when the thread carries no digest. It reads through the room\'s GitHub connection or this machine\'s gh login, and answers facts or an honest refusal that names the fix. Never invent a release, a version or a pull request.';

export const REPO_FILE_DESC =
  'Read ONE file of this room\'s project repository as text (the README, CHANGELOG.md, a doc, a source file), by its path from the root; `ref` picks a branch, tag or commit. Cut at 60,000 characters, and says so; binaries are refused. Use list_repo_files first when the path is unknown. Read only.';

export const REPO_TREE_DESC =
  'List the files of this room\'s project repository: the whole tree (capped at 500 entries) or the entries under a path. Use it to find what to read. Read only.';

// search_x (George, 2026-10-02: the search returned low-engagement posts). ONE wording and ONE schema for the
// three registries that offer it (the orchestrator, the chat turn, the harness bus), so a copy cannot drift
// into the old newest-first read. control-api connectors-x.ts XSearchOpts is what order and hours do.
export const SEARCH_X_DESC =
  'Search X (Twitter): public posts from the last 7 days, with real handles and real numbers (impressions, likes, reposts, replies). Use it for ANY question about what is on X. WebSearch and WebFetch only guess at X: this gives facts or an honest failure, never filled with guesses. order top (default) is X\'s engagement ranking, returned by impressions. latest is newest first. The query takes min_likes:N, min_reposts:N, min_replies:N (min_faves and min_retweets fail), -is:reply, -is:retweet, lang:en, is:verified. No operator filters impressions: put a min_likes floor in the query, then keep the posts over the impressions bar. Each post read costs money.';

export const searchXParams = (z: typeof Zod) => ({
  query: z.string().min(2).max(400).describe('e.g. `"ai agents" min_likes:50 -is:reply -is:retweet lang:en` or `from:handle`'),
  order: z.enum(['top', 'latest']).optional(),
  hours: z.number().int().min(1).max(167).optional().describe('the window, e.g. 24 for a daily run'),
  max: z.number().int().min(10).max(100).optional().describe('posts to read (default 25)'),
});

// the agents' browser (models-and-replies round, board C3): the orchestrator, the conversation and
// the worker bus (with its Claude clones) offer these five, on a cloud machine with Chromium only,
// and one implementation answers them (browser/agent-tools.ts). so the words live here once.
export const WEB_OPEN_DESC =
  'Open a web page in the agents\' browser on this cloud machine and read it: the title, the final address and the text, cut at 12,000 characters. A real browser runs the page\'s JavaScript, so it reads pages a plain fetch cannot. It has no sign-ins. Only public http and https addresses open: a private or local address is refused, and a site can block the visit. The answer says which. Do not retry either.';
export const WEB_READ_DESC = 'Read the open page\'s text again, for example after a click. Pass `from` to start at a later character.';
export const WEB_CLICK_DESC = 'Click a link, a button or a tab on the open page, found by its visible text or by a CSS selector. When the click opens a page, it waits for the load.';
export const WEB_TYPE_DESC = 'Type into a field on the open page, found by a CSS selector. The text replaces what the field holds, and submit:true presses Enter. Never type a password.';
export const WEB_SCREENSHOT_DESC = 'Save a picture of the open page where the person sees it: in this thread, or with the task\'s evidence. Returns the saved name.';

export const webOpenParams = (z: typeof Zod) => ({ url: z.string().min(1).max(2048).describe('a public web address') });
export const webReadParams = (z: typeof Zod) => ({ from: z.number().int().min(0).max(5_000_000).optional().describe('the character to start at') });
export const webClickParams = (z: typeof Zod) => ({
  text: z.string().min(1).max(200).optional().describe('its visible text'),
  selector: z.string().min(1).max(500).optional().describe('a CSS selector'),
});
export const webTypeParams = (z: typeof Zod) => ({
  selector: z.string().min(1).max(500).describe('a CSS selector, e.g. input[name=q]'),
  text: z.string().max(2000),
  submit: z.boolean().optional(),
});
export const webScreenshotParams = (z: typeof Zod) => ({ name: z.string().max(80).optional().describe('a short file name') });
