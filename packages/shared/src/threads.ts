// Conversation-thread naming: a thread is born the instant its first message lands, so
// its title comes from a deterministic heuristic over that message — instant, offline-
// consistent, and good enough to file by. The orchestrator (or a human) may refine
// title + description later via thread.update; this is the floor, not the ceiling.
const MAX_TITLE = 60;

/**
 * docs/34 — what a conversation IS, decided by the composer's Tasks toggle and frozen at the
 * thread's birth.
 *
 * `tasks` — the room's process: the orchestrator triages the exchange into board work.
 * `chat`  — the agent itself: it answers in the thread with real tools, and nothing reaches
 *           the board. Enforced by a different tool registry AND a server floor, never by
 *           prompt etiquette.
 *
 * It lives on the THREAD (not the message, not the channel) because every wake in the thread
 * reads it, not just the first — a conversation has to stay what it was.
 */
export const THREAD_MODES = ['tasks', 'chat'] as const;
export type ThreadMode = (typeof THREAD_MODES)[number];

/** The default every legacy row, absent column and older client resolves to. */
export const DEFAULT_THREAD_MODE: ThreadMode = 'tasks';

/**
 * Read a mode off anything that might carry one — a synced row, an API payload, a replica
 * column that predates 0099. Unknown/absent is `tasks`, so a thread can never become a chat by
 * accident: the mode that skips the board is the one you have to ask for explicitly.
 */
export function threadModeOf(value: unknown): ThreadMode {
  return value === 'chat' ? 'chat' : DEFAULT_THREAD_MODE;
}

/** True when this thread's replies must skip the board entirely. */
export function isChatThread(value: unknown): boolean {
  return threadModeOf(value) === 'chat';
}

/**
 * The mode flip, written into the transcript.
 *
 * A conversation that becomes work should SHOW where that happened — scroll back a week later
 * and "we were chatting, then we built it" has to be legible. So the flip posts one marker
 * message, which the thread renders as a divider line rather than a bubble.
 *
 * It is deliberately a message and not a new table: the transcript is already the record, and
 * ordering against the surrounding messages is free. The two rules that keep it from being
 * noise live at the seams — the daemon does NOT wake on it (it is not a question), and both
 * transcript builders strip it (a model reading "human: ‹mode:tasks›" learns nothing).
 */
const MODE_MARKER_RE = /^‹mode:(tasks|chat)›$/;

export function modeMarker(mode: ThreadMode): string {
  return `‹mode:${mode}›`;
}

/** The mode a marker announces, or null when the body is an ordinary message. */
export function parseModeMarker(body: string): ThreadMode | null {
  const m = MODE_MARKER_RE.exec(body.trim());
  return m ? (m[1] as ThreadMode) : null;
}

/**
 * Inline markdown, removed (the nav-recents round, 2026-09-12; George: routine rows read
 * `**Routine — …` in the rail). A title is plain text: the rail, the ledger, the bell and the thread
 * head all set it as text, so emphasis markers, code ticks and heading hashes are noise there. It
 * strips UNBALANCED markers too, because a title is cut at 60 characters and the closing `**` is
 * exactly what the cut removes. One definition, shared by the birth heuristic below and by
 * `plainTitle` on the display side.
 */
export function stripMarkdownInline(t: string): string {
  return t
    .replace(/^\s*#{1,6}\s+/, '') // a heading is a title already
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*|__|~~/g, '')
    .replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s).,!?:;]|$)/g, '$1$2') // *emphasis* and _emphasis_, never snake_case
    .replace(/`/g, '');
}

export function threadTitle(body: string): string {
  let src = body.replace(/```[\s\S]*?```/g, ' '); // fenced blocks carry no title signal
  // a short first paragraph with more below it IS the title (a routine's plain first line, a
  // human's own heading): the sentence rule below would run it into the prose that follows
  const paras = src.split(/\n[ \t]*\n/);
  const head = paras[0]?.trim() ?? '';
  if (paras.length > 1 && head && head.length <= MAX_TITLE && !head.includes('\n')) src = head;
  let stripped = stripMarkdownInline(src)
    .replace(/https?:\/\/\S+/g, ' ') // bare links read poorly in a title
    .replace(/\s+/g, ' ')
    .trim();
  // conversational on-ramps and addressing carry no subject — peel them in turns until
  // the head is substance ("hey @rex please fix …" → "fix …"). The greeting must be
  // followed by a real separator so "Hi-priority bug" style compounds survive.
  for (let i = 0; i < 3; i++) {
    const before = stripped;
    stripped = stripped
      .replace(/^(?:(?:hey there|hey|hi|hello|hiya|yo|ok|okay|please|pls)\b[,!.:\s]+)+/i, '')
      .replace(/^\s*(@[\w-]+[,:]?\s*)+/, '')
      .replace(/^[\s\-–—:;,]+/, '') // separator residue the peels expose ("hey — so …")
      .trim();
    if (stripped === before) break;
  }
  // a mid-sentence @handle reads as a name in a title
  stripped = stripped.replace(/(^|\s)@([\w-]+)/g, '$1$2');
  if (!stripped) return 'New thread';
  // first sentence-ish chunk (a ? or ! stays — questions title better with them),
  // then a hard cap on a word boundary
  const firstStop = stripped.search(/[.!?\n]/);
  const keepStop = firstStop >= 0 && /[!?]/.test(stripped[firstStop]!) ? 1 : 0;
  let t = (firstStop > 8 ? stripped.slice(0, firstStop + keepStop) : stripped).trim();
  t = t.replace(/[\s\-–—:;,]+$/, '');
  if (t.length > MAX_TITLE) {
    const cut = t.slice(0, MAX_TITLE);
    const lastSpace = cut.lastIndexOf(' ');
    t = (lastSpace > MAX_TITLE * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd() + '…';
  }
  return t.charAt(0).toUpperCase() + t.slice(1);
}
