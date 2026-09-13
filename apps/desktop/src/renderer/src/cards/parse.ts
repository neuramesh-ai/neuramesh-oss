// The card fence formats + their small derivations — extracted from App.tsx (track A3b).
// Pure: the regexes Md scans for, the card payload types, and the labels the cards read.
import type { MessageRow } from '../bridge/rows-rooms';
import type { AgentRow } from '../bridge/rows-crew';
import type { FailoverCardData, ScheduleCardData, TaskProposalCardData, VerdictCardData } from '@neuramesh/shared';
import { parseCard } from '@neuramesh/shared';

// agents emit question cards as fenced ```nmq blocks (JSON: question, options,
// allowOther) — NeuraMesh renders them as clickable choices whose answer posts
// back to the same channel/thread. Anywhere else they degrade to a code block.
export interface NmQuestion {
  question: string;
  options?: Array<{ label: string; description?: string; icon?: 'iris' | 'claude-design'; provider?: 'iris' | 'claude-design' }>;
  allowOther?: boolean;
  kind?: string; // 'permission' cards (a policy gate asking to run something) get a "change policy" affordance
  capability?: string;
  risk?: string;
  // permission-card display fields (v0.33): `question` stays the answer/supersede key; the UI
  // prefers the command-free `title`, the agent's own `summary`, and the full `command` block.
  title?: string;
  summary?: string;
  command?: string;
  reason?: string;
  failover?: FailoverCardData; // capacity-failover cards (docs/22) carry a rich payload; ordinary cards omit it
  schedule?: ScheduleCardData; // marketing schedule-confirm cards carry the proposed slots; ordinary cards omit it
  verdict?: VerdictCardData; // task-verdict cards: the human's click fires task.approve/task.accept
  proposal?: TaskProposalCardData; // task-proposal cards: the human's click fires task.create
}

// Answers post back as `**question** → answer` lines — that convention is the answered-state
// store, layered under the synced decisions rows. The derivation lives in answers.ts and is
// PER CARD since the re-ask fix (2026-08-10): an answer only collapses cards ABOVE it, and a
// synced row collapses only the card in the message it names — one "Not now" used to answer
// every future re-ask of the same question, rendering fresh cards born-checked.

// Agents emit ```nmauth blocks when a preferred subscription login is down and the failover
// policy won't silently bill a key. Rendered as an actionable card: reconnect the CLI login
// (in-app, then re-detect) or switch the provider to API-key mode (opens Workspace settings).
// The shape, the labels and the login commands live in @neuramesh/shared (cards.ts) so the desktop
// renderer, the push fan-out and the phone read ONE definition. They were duplicated here until the
// phone grew its own card and the duplication became a drift risk (2026-09-08).
export { AUTH_CMD, AUTH_LABEL, type NmAuth } from '@neuramesh/shared';

export const NMAUTH_BLOCK = /```nmauth\s*\n([\s\S]*?)```/g;

// The marketing bootstrap closes with a ```nmsched block — the ARMABLE plan (round 9):
// each recommendation renders as a row with + Arm. Arming stays the human's click
// (schedule.create — a Free workspace's 402 auto-routes to the upgrade card via the
// api() nm:plan-limit seam, which IS the deep-funnel moment).
export interface NmSchedRec { title: string; cadence: 'daily' | 'weekdays' | 'weekly'; weekday?: number; atTime: string; prompt: string }

export interface NmSched { channel: string; recs: NmSchedRec[] }

export const NMSCHED_BLOCK = /```nmsched\s*\n([\s\S]*?)```/g;

// The bootstrap's nmplays sibling (marketing-os round): the first playbooks as Run-shaped
// rows. Run › SENDS the pre-drafted ask into the thread (the suggestion-pill semantic —
// rex triages it; the plan gate stays the consent), never a command.
export interface NmPlaysRec { id: string; why: string }
export interface NmPlays { channel: string; plays: NmPlaysRec[] }
export const NMPLAYS_BLOCK = /```nmplays\s*\n([\s\S]*?)```/g;

export const WD_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// AUTH_LABEL / AUTH_CMD are re-exported above from @neuramesh/shared. The command is shown copyable
// so the terminal-preferring human can run it themselves; the button remains the one-click path.

// Capacity-failover card (docs/22): an nmq card carrying a `failover` payload. Renders the composed
// recommendation (a per-role fall-forward, or a whole-pack provider switch), the live-login strip, the
// workspace scope, and the revert toggle. Confirming posts the plain `**q** → label` answer line the
// daemon watcher executes — so it degrades to an ordinary choice card if this renderer is ever absent.
export function foResetLabel(iso?: string | null): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const mins = Math.round((t - Date.now()) / 60000);
  if (mins <= 0) return 'now';
  if (mins < 60) return `in ${mins}m`;
  const h = Math.floor(mins / 60), m = mins % 60;
  return m ? `in ${h}h ${m}m` : `in ${h}h`;
}

// fenced ```nmq blocks are transport, not prose: extract them all, render the
// surrounding markdown, and mount ONE QuestionFlow for the whole message
export const NMQ_BLOCK = /```nmq\s*\n([\s\S]*?)```/g;

// A compact inline task reference: `#1004` as a link — click opens the thread,
// hover shows the vitals the old in-chat card carried (state · title · agent ·
// branch · PR). Replaces the per-message digest cards that walled the channel
// when the orchestrator referenced the same task repeatedly.
export interface TaskRefInfo { id: string; number: number; title: string; state: string; assignee: string | null; branch: string | null; pr: number | null }

// The freshness rule (derived, never stored — the answersFrom trick): the target is the
// orchestrator's newest message, and only while no HUMAN message follows it in the scope —
// your reply retires the row, agent chatter after it does not. A message that carries a
// decision/auth card keeps the card as its one affordance (no pills beside buttons).
export function suggestionTarget(rows: MessageRow[], agents: AgentRow[]): string | null {
  for (let i = rows.length - 1; i >= 0; i--) {
    const m = rows[i]!;
    if (m.author_kind === 'human') return null;
    if (m.author_kind !== 'agent') continue;
    if (agents.find((a) => a.id === m.author_id)?.role !== 'orchestrator') continue;
    return parseCard(m.body) ? null : m.id;
  }
  return null;
}

// Hex colors render with a small swatch beside the code (round 5 follow-up: "show the
// actual brand colors in the doc") — applied to inline code and to plain text inside
// table cells / list items, the places brand docs put their palettes. 3- and 6-digit
// only, so 4-digit task refs (#1042) never match.
export const HEX_COLOR = /#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g;

export const isHexColor = (s: string) => /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.test(s.trim());

// filenames worth linkifying — deliverable-ish extensions only, so a bare word with a dot
// (v0.54.2, api.neuramesh.app) is never mistaken for a file
export const FILE_NAME_RE = /\b[\w][\w.-]*\.(?:md|markdown|csv|tsv|json|ya?ml|html?|txt|png|jpe?g|gif|svg|webp|diff|patch|ts|tsx|js|jsx|py|sql|sh|css)\b/g;
