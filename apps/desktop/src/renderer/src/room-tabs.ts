// The room's surface lens (docs/32) and the derivations behind its session list. Every room
// carries its Conversations and its Board, and a set-up marketing HQ appends the two lenses that
// justify a marketing room. Kept out of App.tsx so the tab set, the session list, its date
// grouping and the pinned brief can all be asserted without a renderer.
//
// The sessions shell (mockups/sessions-shell.html) turns a room from a message feed into a folder
// of sessions: historyRows is that list (chats, tasks and the loose room messages that predate
// them), sessionGroups dates it, and roomBriefs keeps the digests — the feed's one regular
// tenant — as the cards pinned above it.
//
// History left the tab strip (v0.69). As a tab it cost you the conversation — opening it
// REPLACED the feed — which is a strange price for "what did we talk about?". It now lives in
// the left nav as a resting jump list and expands into a full-width search overlay: one
// surface at two scales, the same shape the beats tracker uses (docs/25). `history` stays in
// the RoomSurface union only so a persisted `roomView` from an older build resolves to `feed`
// through resolveRoomSurface instead of rendering nothing — and `board` / `routines` stay for
// exactly the same reason now that they are nav destinations rather than room surfaces.

export type RoomSurface = 'feed' | 'board' | 'history' | 'calendar' | 'library' | 'routines';

export interface RoomTab {
  id: RoomSurface;
  label: string;
}

/**
 * Conversations everywhere; a configured marketing HQ adds Calendar · Library.
 *
 * Board and Routines LEFT the tab strip (the channel-scope pass, 2026-08-03). Both are now
 * left-nav destinations that read the nav head's scope: at `All channels` they span the
 * project, and picking a room narrows them to it. Keeping them here as well would be two
 * doors to one surface disagreeing about scope — the docs/32 §1 failure — and it made a
 * one-room reading of the board the only reading you could reach.
 *
 * That leaves most rooms with a single tab, so the strip renders only when there is a choice
 * to make (App.tsx): one tab is a label wearing an underline.
 */
export function roomTabsFor(kind: string | null | undefined, marketingReady: boolean): RoomTab[] {
  const tabs: RoomTab[] = [
    // The sessions shell renames this surface — a room opens to its session list, not a
    // message stream — but the id stays `feed`: it is resolveRoomSurface's fallback target,
    // so a new id would break the fallback that catches every retired surface below.
    { id: 'feed', label: 'Conversations' },
  ];
  if (kind === 'marketing' && marketingReady) {
    tabs.push({ id: 'calendar', label: 'Calendar' }, { id: 'library', label: 'Library' });
  }
  return tabs;
}

/** A room switch lands on its feed, and a surface a room no longer offers falls back there. */
export function resolveRoomSurface(want: RoomSurface, tabs: RoomTab[]): RoomSurface {
  return tabs.some((t) => t.id === want) ? want : 'feed';
}

// The derivations behind the session list LIVE IN @neuramesh/shared now (the mobile-cloud round,
// S1.1 — the phone draws the same list from the same rows). Re-exported so every importer here
// keeps its path; the tests in src/main/room-tabs.test.ts keep asserting through this door.
export {
  liveKinOf, historyRows, sessionGroups, roomBriefs, roomBrief, briefPretty, briefPrettyFull, briefSummary, plainTitle,
} from '@neuramesh/shared';
export type { HistoryThread, HistoryTask, RoomMessage, HistoryRow, SessionBucket, SessionGroup, RoomBrief } from '@neuramesh/shared';
