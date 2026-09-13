// Chat mode (docs/34) — the pure half. Everything here is a decision the daemon has to make
// on a chat wake, extracted so it can be tested without a model, a database or Electron:
//
//   - which agent answers when nobody was @mentioned      (pickResponder)
//   - where this conversation's files live                (chatWorkspaceDir)
//   - which of those files are DELIVERABLES               (isDeliverableFile / pickDeliverables)
//   - what the agent is told it is                        (chatSystemPrompt)
//
// The impure half — the Agent SDK turn, the sandbox, the artifact posts — lives in agents.ts.
import { styled } from './housestyle';
import { join } from 'node:path';
import { brainRoot, subjectSlug } from './harness/brain';

/** The subset of a hosted agent these decisions need. */
export interface ChatAgent {
  id: string;
  name: string;
  role: string;
  /** a hired agent's stored specialty (agents.brief) — what it brings to an answer */
  brief?: string | null;
  runtime: string;
}

/** A thread message, oldest→newest or newest→oldest; only authorship matters here. */
export interface ChatTurnRow {
  author_kind: string;
  author_id: string;
}

/**
 * Who answers a chat message that named nobody.
 *
 * **The last agent who spoke here**, then the room's orchestrator. Continuity is what every
 * chat app does and it is the whole reason "keep talking to patch" works without re-@mentioning
 * them every line — in tasks mode the orchestrator owns the room, but in a conversation the
 * person you were just talking to is the person you are still talking to.
 *
 * `rows` may be in either order; `newestFirst` says which. An explicit @mention is resolved by
 * the caller before this is reached — this is only the fallback.
 */
export function pickResponder(
  rows: ChatTurnRow[],
  candidates: ChatAgent[],
  opts: { newestFirst?: boolean } = {},
): ChatAgent | null {
  const ordered = opts.newestFirst ? rows : [...rows].reverse();
  for (const r of ordered) {
    if (r.author_kind !== 'agent') continue;
    const hit = candidates.find((a) => a.id === r.author_id);
    if (hit) return hit; // the most recent agent that is STILL in this room
  }
  return candidates.find((a) => a.role === 'orchestrator') ?? null;
}

/**
 * The conversation's own scratch workspace — one directory per thread, persistent across turns.
 *
 * Persistence is the feature: "make it shorter" has to edit the file the last turn wrote, not
 * write a second one beside it. Named off the thread id (not the title, which the orchestrator
 * renames) so the directory can never drift from the conversation it belongs to.
 *
 * It IS the thread's brain workspace (docs/harness/01 §3.2). It used to be a sibling directory,
 * `chats/nm-…`, which meant one conversation had two homes: ledgers, notes and result envelopes
 * under `subjects/thread-…/`, and the files it actually produced somewhere else entirely. §8
 * specified the merge and the migration never carried it — so an agent asked "what have we got
 * here" could reach half of the answer at most. `adoptLegacyChatWorkspace` moves an old directory
 * in on first use.
 */
export function chatWorkspaceDir(home: string, threadId: string): string {
  return join(brainRoot({ ...process.env, HOME: home }), 'subjects', subjectSlug({ kind: 'thread', id: threadId }), 'workspace');
}

/**
 * Where that workspace lived before the merge.
 *
 * Kept as a named function rather than inlined at the adoption site: it is the only remaining
 * spelling of the legacy layout, and the brain's own rule is that a path spelled in several places
 * is a path that gets moved in one of them.
 */
export function legacyChatWorkspaceDir(home: string, threadId: string): string {
  return join(brainRoot({ ...process.env, HOME: home }), 'chats', `nm-${threadId.replace(/-/g, '').slice(0, 12)}`);
}

/** Images we can inline as artifacts; everything else binary stays on the machine. */
const IMAGE_EXT = /\.(png|jpe?g|gif|webp)$/i;

/**
 * Is this workspace file something the human asked for?
 *
 * A chat agent runs real commands, so its directory fills with things that are NOT the
 * deliverable — dotfiles, dependency trees, its own scratch notes. The rule mirrors the one
 * scratch tasks already live by, so a file that would ship from a board task ships from a chat.
 */
export function isDeliverableFile(relPath: string): boolean {
  const parts = relPath.split('/');
  if (parts.some((p) => p.startsWith('.'))) return false; // dotfiles AND anything under .nm-evidence/
  if (parts.includes('node_modules')) return false;
  if (parts.includes('__pycache__')) return false;
  return true;
}

export interface ChatFile {
  /** path relative to the workspace root */
  name: string;
  /** epoch ms of the last write */
  mtimeMs: number;
  sizeBytes: number;
}

/**
 * Which files this turn produced, newest first, capped.
 *
 * `since` is the turn's start, so a five-turn conversation never re-delivers the file it
 * delivered three turns ago — only what actually changed just now. The cap is the same 6 the
 * mockup promised; anything past it is RETURNED as `dropped` rather than silently vanishing,
 * because a silent truncation reads as "that was everything" when it wasn't (the #1015 lesson).
 */
export function pickDeliverables(
  files: ChatFile[],
  since: number,
  opts: { cap?: number; maxBytes?: number } = {},
): { take: ChatFile[]; dropped: string[] } {
  const cap = opts.cap ?? 6;
  const maxBytes = opts.maxBytes ?? 300_000;
  const dropped: string[] = [];
  const fresh = files
    .filter((f) => isDeliverableFile(f.name))
    .filter((f) => f.mtimeMs >= since)
    .filter((f) => {
      // an image rides as a data URI and a text file rides inline; both have a ceiling, and a
      // file over it is named rather than dropped in silence
      if (f.sizeBytes <= maxBytes) return true;
      dropped.push(`${f.name} (too large to attach)`);
      return false;
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  dropped.push(...fresh.slice(cap).map((f) => f.name));
  return { take: fresh.slice(0, cap), dropped };
}

export function isImageFile(name: string): boolean {
  return IMAGE_EXT.test(name);
}

/** The message body that renders a produced file as an inline card (docs/30's doc-drop shape). */
export function fileDropBody(label: string, file: string, content: string): string {
  return `📄 **${label}** — saved to the library as \`${file}\`.\n\n${content}`;
}

/**
 * What a chat agent is told it is.
 *
 * Deliberately NOT the board's chat prompt: that one exists to keep a teammate from promising
 * work outside an offer ("work moves through the board, go see the orchestrator"), which is
 * correct on a board and useless in a conversation. Here the agent IS the deliverable.
 *
 * The two hard rules are the ones a model would otherwise get wrong by being helpful:
 * no board actions (it has no tools for them, and saying so stops it from PROMISING them),
 * and no nmq cards (those write decision rows into the human's needs-you queue — a chat that
 * wants to know which of three options must simply ask, like any chat).
 */
export function chatSystemPrompt(agent: ChatAgent, channelSlug: string, opts: { canUseTools: boolean; workspaceDir?: string }): string {
  const who =
    agent.role === 'orchestrator'
      ? `You are ${agent.name}. In the board's rooms you are the orchestrator for #${channelSlug}, but right now you are simply talking with the human — one to one.`
      : `You are ${agent.name}, the ${agent.role} in #${channelSlug} of a NeuraMesh workspace. Right now you are talking with the human directly, not working a board task.`;

  const tools = opts.canUseTools
    ? `You have real tools and you are expected to USE them rather than caveat:
- **Search and read the web** when the answer depends on anything current, specific, or checkable — do it now, in this turn, instead of hedging or offering to look later. Say which sources you actually read.
- **Write files.** Your working directory (${opts.workspaceDir ?? 'your chat workspace'}) belongs to this conversation and persists between turns. When the human asks for a document, a report, a spreadsheet, a script — produce the real file there, named plainly (competitor-teardown.md, not output.md). It renders in the thread automatically and the human can open it, so do NOT paste the whole file back into your reply; say what it is and what's in it.
- **Edit the file you already wrote** when they ask for changes. Look before you write: a second near-identical file is a bug, not a revision.
- **Run commands** in that directory when it genuinely helps — counting rows, converting a file, checking that a script works. Some commands ask the human for approval first; that is normal, so make the request legible by saying what you are about to do and why.
- **recall** the workspace's memory when the question touches decisions, people, or past work here.
- **Draw a whiteboard** when a diagram says it better — an architecture map, a flow, a state machine. create_whiteboard(mermaid) puts an EDITABLE board's card right in this conversation (flowchart/sequence/class stay editable shapes); the human opens it, drags things around, and can share it back. read_whiteboard/update_whiteboard let you work with a board they point you at — edit someone's board only when asked.
- **Draft social posts** with draft_posts whenever they ask for posts, captions or a thread. Each one renders as a platform-native card they approve, schedule, or send back for changes — so hand them over that way and never as a posts.json file or pasted markdown, which give them nothing to act on. \`body\` is only the wire text (no character counts, no "(draft only)" notes, no image brief inside it — that would publish verbatim); art direction goes in \`imageBrief\`. When they ask to change one, revise_posts rewrites it IN PLACE by its card letter — a second card beside the old one is the wrong answer to "change this".`
    : `You have no file or command tools on this runtime, so answer from what you know and be plain about the limit rather than describing work you cannot do. For anything that genuinely needs searching and reading around, start_deep_work is available and posts its report back into this thread by itself.`;

  // The board clause forks by seat (the prose-consent round, 2026-08-10 — docs/34 §14 amended):
  // the orchestrator carries the backlog trio in conversations for the human's EXPLICIT word;
  // every other seat keeps the flat prohibition. The old escape hatch ("turn Tasks on in the
  // composer") died with the toggle in §14 and is not resurrected here.
  const board = agent.role === 'orchestrator'
    ? `This is a CONVERSATION, and it is the whole job. Nothing here becomes board work uninvited — you never file, offer, plan or route work on your own initiative in this thread, and you never say you filed anything unless you really did. The ONE exception is the human's explicit word: when they tell you to create the task ("create the task", "put it on the board", "add it to the backlog"), do it in THIS turn — add_backlog_item with this conversation distilled into the title and description, then promote_backlog_item in the same turn unless they asked you to only park it — and name the result as #N in your reply so it links. Their instruction IS the consent: never answer it with another proposal card, and never re-send a card they already declined — a declined proposal only comes back when they change their mind in words, and then you create, not re-ask.`
    : `This is a CONVERSATION, and it is the whole job. Nothing here becomes board work: you cannot create, offer, plan, design or route a task, park a backlog item, hire anyone, or start a project — those tools are not available to you in this thread, so never say you have filed, created, queued or handed off anything. If the human wants something built by the team, tell them to say so to the orchestrator — here in this room, or with the ＋ New task launcher.`;

  return styled(`${who}${agent.brief ? ` Your specialty: ${agent.brief} — bring that lens.` : ''}

${board}

${tools}

How to talk: like a sharp colleague, not a chat assistant. Answer the question that was asked, lead with the answer, and let the length follow the question — one line for one line, and real depth when the question has depth. Markdown where it aids scanning. No preamble, no restating the request, no "great question", no offering three options when you have a view. Say plainly when you don't know or when the evidence is thin; a clear "the evidence is thin here" is worth more than a confident guess.

Ask questions as plain questions, in the flow of the reply. Do NOT emit nmq question cards — those file an item in the human's queue, which is exactly wrong for a conversation.

You may end a substantive reply with ONE fenced code block with language nms containing a JSON array of 2–4 short follow-ups the human would plausibly send next — their words, first person, ≤ 6 words each. Skip it for a short answer or a trivial ack.`);
}
