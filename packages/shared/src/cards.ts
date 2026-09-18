// Decision cards embedded in agent messages. An agent asks the human by posting a
// message whose body carries a fenced block: ```nmq (a question / plan-approval /
// add-agent / project-confirm card) or ```nmauth (a reconnect card). Answering is
// just posting a reply. This module is the single source of truth for detecting
// them and building their notification copy — shared by the desktop notifier, the
// server-side push fan-out, and the mobile thread UI so the three never drift.

export type CardKind = 'nmq' | 'nmauth';

export interface ParsedCard {
  kind: CardKind;
}

// Detect an nmq/nmauth card in a message body. nmauth wins when both markers are
// present — the reconnect is the blocking, must-act-now one.
export function parseCard(body: string): ParsedCard | null {
  if (/```nmauth/.test(body)) return { kind: 'nmauth' };
  if (/```nmq/.test(body)) return { kind: 'nmq' };
  return null;
}

// A readable one-liner for a notification/summary body: drop fenced blocks +
// markdown emphasis, take the first non-empty line, cap the length.
export function preview(body: string, max = 140): string {
  const line =
    body
      .replace(/```[\s\S]*?```/g, '')
      .replace(/[*_`#>]/g, '')
      .split('\n')
      .map((s) => s.trim())
      .find(Boolean) ?? '';
  return line.slice(0, max);
}

// The notification title for a card. `where` is the human-facing location — a task
// ("#1234") or a channel ("#growth"). Copy lives here so every surface matches.
export function cardTitle(kind: CardKind, where: string): string {
  return kind === 'nmauth' ? `Action needed · ${where}` : `A question for you · ${where}`;
}

export interface CardNotification {
  kind: CardKind;
  title: string;
  body: string;
}

// Build the full notification for a card-bearing message (title + readable body),
// or null when the body carries no card. Used by the push fan-out and the desktop
// notifier. `where` is the task/channel label the title points at.
export function cardNotification(body: string, where: string): CardNotification | null {
  const card = parseCard(body);
  if (!card) return null;
  const q = card.kind === 'nmq' ? parseQuestions(body)[0] : undefined;
  const title = q?.kind === 'permission' ? `Approval needed · ${where}` : cardTitle(card.kind, where);
  const line = q?.kind === 'permission' ? preview(q.question) : preview(body);
  return { kind: card.kind, title, body: line || 'Open NeuraMesh to respond' };
}

import type { FailoverCardData } from './failover';

// Schedule-confirmation cards (marketing scheduling): the orchestrator proposes a schedule change
// on a content task's posts, and the custom renderer draws it with per-post slots + one Confirm
// that APPLIES it via content.approve / content.unschedule — each fired as the HUMAN (the click IS
// the approval, so "nothing publishes without your approve" stays structural). Optional + ignored
// by the server's {question,options,allowOther} extraction, exactly like `failover`.
export interface ScheduleCardData {
  action: 'schedule' | 'reschedule' | 'unschedule';
  items: Array<{
    item: string; // content_item id — the client applies content.approve/unschedule to it
    letter: string; // a, b, c… the human-facing label from the draft cards
    platform: string;
    slot?: string | null; // ISO — the proposed publish time (schedule/reschedule); omitted for unschedule
    preview: string; // a short slice of the post body so the human recognizes it
  }>;
}

/**
 * Task-verdict cards (2026-08-05). The orchestrator ASKS for a verdict; the human's click
 * APPLIES it — `task.approve` / `task.accept` fired from their own client, exactly the way the
 * schedule card fires `content.approve`. That distinction is the whole design: approve is
 * `by: ['reviewer','human']` and accept is human-only, so an orchestrator can never hold either.
 * Before this the card was prose wearing a gate's clothes — clicking Accept posted a sentence
 * and nothing moved (live #1043, which sat in_review waiting on a button that did nothing).
 *
 * It replaces the fixed Approve · Request changes · Review Artifacts row that used to dock above
 * every thread's composer. A thread can hold many artifacts, and a single task-level bar could
 * neither name which one it meant nor appear only when a verdict was actually wanted.
 *
 * The headline is COMPOSED from `title` + the live state, never written by the orchestrator.
 * First version let rex author it, and on live #1043 it wrote "Accept #1043 — …?" over a button
 * that fired `task.approve` — the human clicked, read the word Accept, and reasonably believed
 * the task was closed. It wasn't: approve moves in_review → done, and the accept was still
 * waiting in the needs-you queue. A card that can name one transition and perform another is a
 * lie the UI tells, so the name is derived from the thing it will actually do.
 *
 * `in_review` and `done` are TWO gates, and one card walks both: after an approve lands, the
 * card re-reads the live state and offers the accept, instead of collapsing and leaving the
 * second gate reachable only from Home.
 */
export interface VerdictCardData {
  task: string;   // task id — the client applies the transition to it
  number: number; // #1043, for the card's own label
  title: string;  // the task's title, so the card can COMPOSE its own headline (see below)
  state: string;  // the state the card was raised in; the client refuses to apply a stale verdict
  /** artifacts this verdict is ABOUT — named so a multi-artifact thread can be specific.
   *  Display-only: the transition is the task's. Empty = the task as a whole. */
  artifacts?: Array<{ name: string; kind?: string }>;
  /** what accepting means here, in the orchestrator's own words (one line, shown under the button) */
  note?: string;
}

/**
 * Task proposals (2026-08-06). The orchestrator ASKS for a board task; the human's click CREATES
 * it — `task.create` fired from their own client, the same shape as the schedule and verdict cards.
 *
 * This is the enforced half of "don't file tasks by default". The prompt half is the contract's
 * triage (defaults/agents/orchestrator.yaml), and a prompt is one bad turn away from a board full
 * of junk — so `create_task` is simply not in the orchestrator's registry any more. A registry
 * without it cannot create one. Backlog and subtasks stay open: parking an idea is the cheap
 * ALTERNATIVE to a task, and a subtask rides a parent the human already accepted.
 */
// ── The unit card marker (thread-owned work, 2026-08-17) ─────────────────────
// `‹task:UUID›` in a message body — posted by the server when a create names its owning
// conversation — renders as the live unit card in BOTH thread renderers. The card is a lens on
// the synced task row, never a copy (the id is the only payload).
const TASK_UNIT_RE = /‹task:([0-9a-fA-F-]{36})›/;

export interface TaskUnitRef {
  id: string;
  /** the body with the marker removed — renders as prose beside the card */
  prose: string;
}

export function parseTaskUnitRef(body: string | null | undefined): TaskUnitRef | null {
  if (!body) return null;
  const m = TASK_UNIT_RE.exec(body);
  if (!m) return null;
  const prose = body.replace(TASK_UNIT_RE, '').replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
  return { id: m[1]!.toLowerCase(), prose };
}

/** RETIRED as a creation path 2026-08-17 (plan-first direct create — the plan gate is the one
 *  consent). The type + renderer survive so historical proposal cards keep rendering. */
export interface TaskProposalCardData {
  channel: string;          // channel id — the client creates the task here
  title: string;            // the proposed task title (server caps at 72)
  body?: string;            // the request as stated, which becomes the thread's intake record
  /** why this needs the board rather than an answer in the thread — the contract names three
   *  admissible reasons, and the card shows the one being claimed */
  because?: string;
  kind?: string;            // the work type to stamp at creation (docs/16)
  /** Plan-first (2026-08-17): the implementation plan proposed WITH the task — declared journey
   *  legs + proposed subtasks + the approach prose. The human's ✓ creates the unit BORN in
   *  plan_review carrying it; they then approve (or bounce) the plan in the unit's own thread. */
  plan?: { legs: string[]; subtasks?: string[]; approach: string };
  /** the conversation that will OWN the unit (tasks.origin_thread_id + the ‹task:id› card) */
  origin?: string;
}

// An agent question: rendered as tappable choices whose answer posts back to the
// thread. A message may carry several (one JSON object per fenced ```nmq block).
export interface NmQuestion {
  question: string;
  options?: Array<{ label: string; description?: string; icon?: 'iris' | 'claude-design'; provider?: 'iris' | 'claude-design' }>;
  allowOther?: boolean;
  // Permission-request variant (agent policy engine, Phase 1): the daemon raises these when
  // a tool call resolves to `ask`. `kind` lets the UI style it and the push fan-out gate it;
  // `risk` drives whether it pushes immediately (high) or surfaces in-app only (low).
  kind?: 'permission' | 'design-provider';
  risk?: 'high' | 'low';
  // Permission-card detail (v0.33): display-only fields — `question` stays the unchanged
  // answer/supersede KEY (it must keep uniquely identifying the ask), while `title` is the
  // command-free headline, `summary` the agent's own one-liner for the gated call (a Claude
  // runtime's Bash `description`, never invented after the fact), `command` the full
  // untruncated command for a code block, and `reason` the policy rationale caption.
  title?: string;
  summary?: string;
  command?: string;
  reason?: string;
  // Capacity-failover cards (docs/22) ride an extra `failover` payload the custom renderer reads to
  // draw the rich card (roster preview · live-login strip · revert). Optional + ignored by the
  // server's {question,options,allowOther} extraction, so ordinary cards are unaffected.
  failover?: FailoverCardData;
  // Marketing schedule-confirmation payload (mirrors `failover`): the custom renderer applies the
  // proposed slots on the human's Confirm. Ignored by the server extraction like every extra field.
  schedule?: ScheduleCardData;
  // Task-verdict payload (mirrors `schedule`): the custom renderer fires task.approve/task.accept
  // as the HUMAN on their click. Ignored by the server extraction like every extra field.
  verdict?: VerdictCardData;
  // Task-proposal payload: the renderer fires task.create as the HUMAN on their click.
  proposal?: TaskProposalCardData;
}

// `[ \t]*\n`, never `\s*\n`: \s also matches the newline, so the two fought over it and every fence
// opener backtracked polynomially on a body of blank lines (CodeQL js/polynomial-redos, the public
// PR #7, 2026-09-18). Same capture on real fences: trailing blanks after the word, then the line end.
const NMQ_BLOCK = /```nmq[ \t]*\n([\s\S]*?)```/g;

/**
 * Options, however the author wrote them. The type says `{label}`, but these blocks are authored
 * by MODELS as often as by the daemon, and a model reaching for `["Ship both", "Revise"]` — or
 * `{text}` / `{value}` — is not malformed, it's ordinary. Reading only `.label` rendered those as
 * BLANK numbered pills: a card you cannot answer, and no error anywhere to explain it.
 *
 * So: capture loosely, resolve structurally. Anything without usable text is dropped rather than
 * drawn empty — an option the human can't read is worse than one option fewer.
 */
function normalizeOptions(raw: unknown): NonNullable<NmQuestion['options']> | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: NonNullable<NmQuestion['options']> = [];
  for (const o of raw) {
    if (typeof o === 'string') {
      const label = o.trim();
      if (label) out.push({ label });
      continue;
    }
    if (!o || typeof o !== 'object') continue;
    const rec = o as Record<string, unknown>;
    const label = [rec['label'], rec['text'], rec['value'], rec['title'], rec['option'], rec['name']]
      .find((v): v is string => typeof v === 'string' && !!v.trim());
    if (!label) continue;
    const desc = typeof rec['description'] === 'string' && rec['description'].trim() ? rec['description'].trim() : undefined;
    const icon = rec['icon'] === 'iris' || rec['icon'] === 'claude-design' ? rec['icon'] : undefined;
    const provider = rec['provider'] === 'iris' || rec['provider'] === 'claude-design' ? rec['provider'] : undefined;
    out.push({
      label: label.trim(),
      ...(desc ? { description: desc } : {}),
      ...(icon ? { icon } : {}),
      ...(provider ? { provider } : {}),
    });
  }
  return out.length ? out : undefined;
}

/**
 * One nmq block → a question, or null.
 *
 * JSON is the contract, but the same reasoning that made options loose applies to the block
 * itself: these are authored by MODELS, and the YAML-shaped near-miss ("question: …" over a "- "
 * list) is an ordinary slip, not a corruption. Refusing it is not a tidy no-op — the block leaks
 * into the human's thread as raw transport AND no decision row is ever written, so the question
 * the agent stopped to ask is silently dropped on both surfaces at once.
 *
 * Capture loosely, resolve structurally — then the human gets their card either way.
 */
export function parseQuestionBlock(src: string): NmQuestion | null {
  try {
    const q = JSON.parse(src) as NmQuestion;
    if (q && typeof q.question === 'string' && q.question.trim()) {
      const options = normalizeOptions((q as unknown as Record<string, unknown>)['options']);
      return { ...q, ...(options ? { options } : { options: undefined }) };
    }
  } catch {
    /* fall through to the near-miss shape */
  }
  const lines = src.split('\n');
  const qi = lines.findIndex((l) => /^\s*question\s*:/i.test(l));
  if (qi === -1) return null;
  const question = (lines[qi] ?? '').replace(/^\s*question\s*:\s*/i, '').trim().replace(/^["']|["']$/g, '');
  if (!question) return null;
  const oi = lines.findIndex((l, i) => i > qi && /^\s*options\s*:/i.test(l));
  const raw: string[] = [];
  if (oi !== -1) {
    for (const line of lines.slice(oi + 1)) {
      const m = /^\s*-\s+(.*\S)\s*$/.exec(line);
      if (m) { raw.push((m[1] ?? '').replace(/^["']|["']$/g, '')); continue; }
      if (line.trim() && !/^\s/.test(line)) break; // a new top-level key ends the list
    }
  }
  const options = normalizeOptions(raw);
  const allowOther = /^\s*allow_?other\s*:\s*(?:true|yes)\s*$/im.test(src);
  return { question, ...(options ? { options } : {}), ...(allowOther ? { allowOther: true } : {}) };
}

// Extract every nmq question a message carries. Unreadable blocks are skipped.
export function parseQuestions(body: string): NmQuestion[] {
  const out: NmQuestion[] = [];
  for (const m of body.matchAll(NMQ_BLOCK)) {
    const q = parseQuestionBlock(m[1] ?? '');
    if (q) out.push(q);
  }
  return out;
}

// A low-risk permission card should NOT push — routine approvals surface in-app to avoid
// notification fatigue (Conseca's fewer-better-questions thesis). High-risk permission cards
// and every ordinary question still push. Returns true when the message's card is a low-risk
// permission (the push fan-out reads this to skip).
export function isLowRiskPermissionCard(body: string): boolean {
  const q = parseQuestions(body)[0];
  return q?.kind === 'permission' && q.risk !== 'high';
}

// The reply body that answers a card: one `**question** → answer` line each. This
// convention IS the answered-state store — a later human message with these lines
// marks the card done, so it survives restarts and renders the same for everyone.
export function formatCardAnswer(pairs: Array<{ question: string; answer: string }>): string {
  return pairs.map((p) => `**${p.question}** → ${p.answer || '(skipped)'}`).join('\n');
}

// ── Suggestion pills (docs/design/rex-suggestion-pills-2026-07) ──────────────────────
// The orchestrator ends a substantive chat/thread reply with a fenced ```nms block holding
// a JSON array of short follow-ups written in the human's voice. Clients render them as
// one-tap pills under his newest reply; a click posts the text as an ordinary human message
// — a pill is a pre-drafted message, never a hidden command. One parser here so desktop and
// mobile can't drift; malformed blocks strip silently so a bad block can never break chat.

export const MAX_SUGGESTIONS = 4;
export const MAX_SUGGESTION_CHARS = 48;

const NMS_BLOCK = /```nms[ \t]*\n([\s\S]*?)```/g;
// a reply that is still streaming can end mid-fence — strip that too, so a partial
// render never flashes the raw block as a code fence
const NMS_PARTIAL = /```nms(?:[ \t]*\n(?:(?!```)[\s\S])*)?$/;

// Extract the suggestions a message carries: strings only, trimmed, non-empty, length-capped,
// deduped case-insensitively, at most MAX_SUGGESTIONS across all blocks.
export function parseSuggestions(body: string): string[] {
  const out: string[] = [];
  for (const m of body.matchAll(NMS_BLOCK)) {
    try {
      const arr: unknown = JSON.parse(m[1] ?? '');
      if (!Array.isArray(arr)) continue;
      for (const s of arr) {
        if (typeof s !== 'string') continue;
        const t = s.trim();
        if (!t || t.length > MAX_SUGGESTION_CHARS) continue;
        if (out.some((x) => x.toLowerCase() === t.toLowerCase())) continue;
        out.push(t);
        if (out.length >= MAX_SUGGESTIONS) return out;
      }
    } catch {
      /* skip a malformed block */
    }
  }
  return out;
}

// Remove every nms block (and a trailing unterminated one) from a body for display.
export function stripSuggestions(body: string): string {
  return body.replace(NMS_BLOCK, '').replace(NMS_PARTIAL, '').trimEnd();
}

const ANSWER_LINE = /^\*\*(.+?)\*\*\s*→\s*(.+)$/;

// Which questions the given human message bodies have already answered.
export function readAnswers(bodies: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const body of bodies) {
    for (const line of body.split('\n')) {
      const hit = ANSWER_LINE.exec(line.trim());
      if (hit) map.set(hit[1] ?? '', hit[2] ?? '');
    }
  }
  return map;
}

// ── the nmauth card (capacity-failover round; the credits option, 2026-09-08) ────────────────
// An agent posts one when its preferred subscription login is not usable here and the failover
// policy will not silently bill a key. The payload is one JSON object in a fenced ```nmauth block.
// It is parsed HERE, beside parseCard, for this file's stated reason: the desktop renderer and the
// phone must read ONE parser. The phone had none, so the block was stripped and the reader saw
// prose ending in "choose how to proceed:" with nothing to choose (George, 2026-09-07).
export interface NmAuth {
  provider: string; // 'anthropic' | 'openai' | 'gemini'
  reason?: 'expired' | 'unavailable';
  agent?: string;
  taskNumber?: number;
  /** the verbose reason the daemon found (2026-09-17, the Starter fallback door): shown as-is */
  why?: string;
  /** false when the workspace is out of credits — the card then offers no Starter switch */
  starter?: boolean;
  /** the conversation the switch moves, and which seat: the button re-seats THIS thread's role on
   *  the Starter brain (docs/10 §15.1, thread > pin). Absent on a bare channel post, where the
   *  button falls back to the workspace-wide Starter pack it always switched. */
  scope?: { threadId: string; role: string };
  /** true when the seat ALREADY moved to the Starter brain by itself (a routine's conversation): the
   *  card records the switch and asks nothing — no decision row, no button, the reconnect only */
  switched?: boolean;
}

const NMAUTH_ONE = /```nmauth[ \t]*\n([\s\S]*?)```/;

/** the fenced block the daemon posts — one serializer, so what the door writes is what parseAuthCard reads */
export function authCardBlock(card: NmAuth): string {
  return `\`\`\`nmauth\n${JSON.stringify(card)}\n\`\`\``;
}

/** the needs-you row an auth card mints (docs/12): what the person reads in the queue, the bell, the
 *  thread pill. A question in form only — the answer is a reconnect or a switch, not a word. */
export function authDecisionQuestion(card: NmAuth): string {
  const who = card.agent ? `@${card.agent}` : 'An agent';
  const label = AUTH_LABEL[card.provider] ?? card.provider;
  const why = card.why ?? (card.reason === 'expired' ? `The ${label} login on this machine expired.` : `This machine has no ${label} login.`);
  return `${who} cannot run here. ${why} Sign in again, or switch this conversation to the NeuraMesh brain, on credits.`.slice(0, 400);
}

export const AUTH_LABEL: Record<string, string> = { anthropic: 'Claude', openai: 'OpenAI / Codex', gemini: 'Gemini' };

/** the login command the card offers to run — shown so a terminal-preferring human can do it by hand */
export const AUTH_CMD: Record<string, string> = { anthropic: 'claude auth login', openai: 'codex login', gemini: 'agy' };

/** The one nmauth block in a body, or null. Unparseable JSON is NOT a card: the prose still reads
 *  on its own, which is the degradation authBlockedCard was written for. */
export function parseAuthCard(body: string): NmAuth | null {
  const hit = NMAUTH_ONE.exec(body);
  if (!hit?.[1]) return null;
  try {
    const o = JSON.parse(hit[1]) as Record<string, unknown>;
    const provider = typeof o['provider'] === 'string' ? o['provider'] : '';
    if (!provider) return null;
    const reason = o['reason'];
    const scope = o['scope'] as { threadId?: unknown; role?: unknown } | undefined;
    return {
      provider,
      ...(reason === 'expired' || reason === 'unavailable' ? { reason } : {}),
      ...(typeof o['agent'] === 'string' ? { agent: o['agent'] } : {}),
      ...(typeof o['taskNumber'] === 'number' ? { taskNumber: o['taskNumber'] } : {}),
      // the fallback door's fields (2026-09-17): the reason, whether Starter can take it, the seat
      ...(typeof o['why'] === 'string' ? { why: o['why'] } : {}),
      ...(typeof o['starter'] === 'boolean' ? { starter: o['starter'] } : {}),
      ...(scope && typeof scope.threadId === 'string' && typeof scope.role === 'string' ? { scope: { threadId: scope.threadId, role: scope.role } } : {}),
      ...(o['switched'] === true ? { switched: true } : {}),
    };
  } catch {
    return null;
  }
}
