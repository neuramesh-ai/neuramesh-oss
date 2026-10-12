import type { ComposerPerson, HeadStatus } from './parts';
import type { TaskRefInfo } from '../cards/parse';
import type { AgentRow, MachineRow, MemberRow } from '../bridge/rows-crew';
import type { DecisionAllRow } from '../bridge/rows-board';
import type { ThreadRow } from '../bridge/rows-rooms';
import type { SkillPackRow, SkillRow } from '../bridge/rows-content';
import type { PanelArrival } from '../shell/arrivals';
import type { DraftsDoor } from './DraftsPane';

export type ConvoThreadProps = {
  threadId: string;
  /** what this conversation is doing, and the act its stamp offers (shell/rowstatus.ts) */
  marks?: HeadStatus | null; onSettle?: (threadId: string) => void;
  /** the side panel's Overview slot: this thread's sections portal in there and nowhere else
   *  (the side-panel round, 2026-10-03; see ThreadRail's note) */
  railSlot?: HTMLElement | null;
  /** the Overview tab is in view, so the toks under the head stand down */
  detailsShown?: boolean;
  /** show the Overview tab (the toks' door) */
  onDetails?: () => void;
  /** what this conversation makes while you look at it, for the side panel to open (shell/arrivals.ts) */
  onArrive?: (list: PanelArrival[]) => void;
  /** the side panel's Drafts tab: the cards portal in there, and its count and its door (the side-panel round) */
  drafts?: DraftsDoor;
  /** where the back crumb goes — the room's list, or Home when the session was opened there */
  back: string;
  thread: ThreadRow | null; // null during the optimistic window before the server-born row syncs down
  channelId: string;
  channelSlug: string;
  channelKind?: string | null; // 'marketing' opens the brand-docs rail (round 6)
  channelMarketing?: string | null; // the room profile json for the rail's connections
  agents: AgentRow[];
  machines: MachineRow[];
  members: MemberRow[];
  selfEmail?: string | null;
  people: ComposerPerson[];
  skills: SkillRow[];
  packs: SkillPackRow[];
  plan: string; /** a free hosted workspace (shell/hostedrule.ts): the gate card docks where the composer stood */ hostedGate?: boolean;
  decisions: DecisionAllRow[]; // the channel's non-task nmq-card state — answers land + collapse here too
  onUpgrade: (reason: string) => void;
  onClose: () => void;
  onActivity?: (a: AgentRow) => void;
  /** the cap gate's two doors: open the shared upgrade surface with the cap as its reason, and
   *  open Compute. Both are App-level surfaces, so the thread only forwards the intent. */
  onUpgradeReason: (reason: string) => void;
  onSeeUsage: () => void;
  taskRef?: (n: number) => TaskRefInfo | null;
  onOpenTask?: (id: string) => void;
  /** docs/36 §6 — a brand doc is a FILE: it opens as a tab and stays there while you keep typing */
  onOpenDoc?: (d: { label: string; file: string; doc: string }) => void;
  /** the ‹article:id› card's Open — the reading tab (article round) */
  onOpenArticle?: (a: import('./ArticleCard').ArticleOpen) => void;
  /** docs/10 §15 — the brain chip's inputs. A plain conversation is the PUREST case of "who am I
   *  actually talking to", and it was the one thread that could not answer it. */
  brainProject?: { id: string; name: string; pack: string | null } | null;
  /** the thread's project, for the header place-crumb (project › #room) */
  crumbProject?: { name: string; logo_url?: string | null } | null;
  onSetProjectPack?: (packId: string) => Promise<void>;
  onBrainConnect?: () => void;
  onOpenWhiteboard?: (b: { id: string; title: string }) => void;
  onApproveDoc?: (file: string) => void | Promise<void>;
};
