// What a human may see of a turn while it is still being written.
//
// An agent's reply carries two kinds of text: prose, and MACHINE FENCES the daemon consumes and
// strips before the message is ever posted — ```revise (the marketer's targeted draft edits),
// ```cards (which drafts to re-show), ```nmq / ```nms (question cards, suggestion pills).
//
// The final message never shows them. The STREAM did: emitStream ships the growing text straight
// to the typing bubble, so live #1048 watched a JSON array of post bodies type itself out under
// "plume is typing", and only when the turn ended did the fence vanish. The renderer had a guard
// for exactly this — but it matched `nm\w*` only, so `revise` sailed through it.
//
// One matcher, both sides: the daemon filters before emitting (the payload never crosses IPC) and
// the renderer filters what it renders (any other producer is covered too). Two guards that cannot
// disagree about what a machine fence is, because they are the same function.

/**
 * The stand-down contract: wake/sweep prompts tell an agent to reply with EXACTLY NO_REPLY when
 * it has nothing worth posting. Models routinely disobey by wrapping the sentinel in narrative
 * ("Board is empty; … NO_REPLY"), and an exact-equality check let that status chatter post to the
 * channel — where it counted as fresh activity, re-armed the next 15-minute sweep, and looped
 * forever (the every-15-min rex spam, 2026-07-02).
 *
 * A reply stands down when the sentinel is the entire content OR is its own first or last
 * non-empty line (markdown emphasis + trailing punctuation tolerated). A NO_REPLY mentioned
 * mid-sentence does NOT stand down, so a real alert that quotes it still posts.
 *
 * It lives HERE, beside visibleStream, because it is the same job: text addressed to the daemon
 * that a human must never see. It leaked twice on exactly that basis — the turn's raw text is
 * logged as narration, so the activity feed rendered a bare "NO_REPLY" line under the tool calls,
 * and the live bubble streamed it before the turn ended (founder report). The daemon's
 * replypolicy re-exports this rather than keeping a second copy: two definitions of "stood down"
 * is how the renderer and the daemon come to disagree about what the human is looking at.
 */
const SENTINEL = /^[\s*_`>]*NO_REPLY[\s*_`.!]*$/i;

export function isStandDown(reply: string): boolean {
  const lines = reply.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return true;
  return SENTINEL.test(lines[0]!) || SENTINEL.test(lines[lines.length - 1]!);
}

/** Fence tags the daemon consumes. `nm*` covers nmq/nms/nmauth without listing each. */
const MACHINE_TAG = String.raw`(?:nm[a-z]*|revise|cards|posts)`;
/** a complete fence: opening tag, body, closing ``` */
const CLOSED_RE = new RegExp('```' + MACHINE_TAG + '\\b[^\\n]*\\n[\\s\\S]*?```[ \\t]*\\n?', 'gi');
/** a fence still streaming in — opened, no closing ``` yet, so it runs to the end of the text */
const OPEN_RE = new RegExp('```(' + MACHINE_TAG + ')\\b[\\s\\S]*$', 'i');

/** what the agent is doing inside the fence, for the bubble's status line */
export type FenceWork = 'drafts' | 'card';

export function fenceWork(tag: string): FenceWork {
  return /^(revise|cards|posts)$/i.test(tag) ? 'drafts' : 'card';
}

/**
 * Strip machine fences from a partial (or complete) turn.
 *
 * Returns the prose a human should see, plus `forming` when a fence is currently OPEN — the
 * caller turns that into an honest status line ("updating the drafts…") instead of showing the
 * payload. A closed fence leaves nothing behind at all.
 */
export function visibleStream(text: string): { text: string; forming: FenceWork | null } {
  // the sentinel is addressed to the daemon; showing it to a human is showing them the wiring
  if (isStandDown(text)) return { text: '', forming: null };
  const closed = text.replace(CLOSED_RE, '');
  const open = OPEN_RE.exec(closed);
  const visible = (open ? closed.slice(0, open.index) : closed).replace(/\n{3,}/g, '\n\n').trimEnd();
  return { text: visible, forming: open ? fenceWork(open[1] ?? '') : null };
}

/**
 * Carry question/suggestion cards written in EARLIER assistant blocks into the final reply.
 *
 * A turn's posted reply is the model's FINAL text block — the right rule for prose, because the
 * blocks before a tool call are narration ("let me check the board…"). But a model that writes
 * two ```nmq cards, calls a tool, and closes with "Waiting on those two before scoping the task."
 * has ALREADY said the cards — in a block the final-text rule throws away. That shipped exactly
 * that reply to a human, with no cards anywhere (founder screenshot, 2026-08-06): the reply was
 * not hallucinated, the daemon discarded what it referred to.
 *
 * Cards are never narration. Any nmq/nms fence from an earlier block that the final text does not
 * carry (same fence, or a revision asking the same question) is prepended, so the prose that
 * refers to "those two" sits under the two it means.
 */
/** A block the model wrote in a message that carried no tool call, long enough not to be a
 *  "let me check the board" line: substantive words, never narration. */
export const SPOKEN_MIN_CHARS = 120;

export function carryCards(finalText: string, earlierBlocks: string[], spokenBlocks: string[] = []): string {
  const FENCE = /```nm[qs]\n?[\s\S]*?```/g;
  // The mirror case (2026-09-15): the model writes its words, then closes with the pills fence as
  // a block of its own. The final-text rule kept the fence and threw the words away, so a first
  // run's "introduce yourself" came back as three pills and no prose. Words are never a card
  // either: when the final block has no prose, the last earlier block that has some is the reply,
  // and the final block's own cards ride under it.
  const prose = (t: string): string => t.replace(FENCE, '').trim();
  if (!prose(finalText)) {
    const spoken = [...earlierBlocks].reverse().find((b) => prose(b));
    if (spoken) {
      const fences = finalText.match(FENCE) ?? [];
      finalText = fences.length ? `${prose(spoken)}\n\n${fences.join('\n\n')}` : prose(spoken);
    }
  }
  const keyOf = (fence: string): string => {
    const body = fence.replace(/^```nm[qs]\n?/, '').replace(/```$/, '').trim();
    try {
      const j = JSON.parse(body) as { question?: unknown };
      // a REVISED card asking the same question supersedes the draft — key on the question
      if (typeof j.question === 'string' && j.question.trim()) return `q:${j.question.trim()}`;
    } catch { /* nms arrays / unparseable → whole-body identity */ }
    return `b:${body}`;
  };
  const have = new Set((finalText.match(FENCE) ?? []).map(keyOf));
  const missing: string[] = [];
  for (const block of earlierBlocks) {
    for (const fence of block.match(FENCE) ?? []) {
      const k = keyOf(fence);
      if (!have.has(k)) { have.add(k); missing.push(fence); }
    }
  }
  // The second shape (2026-09-15): the model wrote its answer, then verified with a tool, then
  // closed with the tool's one-line confirmation. The final block had prose, so the rule above
  // kept "Confirmed: no open tasks on the board right now." and dropped the introduction it
  // confirmed. Words the model wrote in a message with no tool call, long enough not to be a
  // narration line, are part of the answer: they lead, in the order they were said, and the final
  // block closes.
  // A model on the CLI lane sometimes narrates a tool call as text, `set_thread_title({...})`, in
  // the block that also opens its answer. The call itself went through the tool; the words stay out.
  const NARRATED_CALL = /^\s*[a-z][a-z0-9_]*\(\{[\s\S]*?\}\)\s*/;
  const said = spokenBlocks
    .map((b) => prose(b).replace(NARRATED_CALL, '').trim())
    .filter((t) => t.length >= SPOKEN_MIN_CHARS && !finalText.includes(t));
  const lead = [...missing, ...said];
  if (!lead.length) return finalText;
  return `${lead.join('\n\n')}\n\n${finalText}`;
}
