// The icon sheet: stroke icons on currentColor, theme-aware — extracted from App.tsx (track A1).
import type * as React from 'react';
import { providerForModel } from '@neuramesh/shared';

// crisp line icons (currentColor → theme-aware) — replace the emoji in the skills UI
export const Svg = (p: { children: React.ReactNode; s?: number }) => (
  <svg width={p.s ?? 15} height={p.s ?? 15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{p.children}</svg>
);
export const IconSkill = ({ s }: { s?: number }) => <Svg s={s}><path d="M21.42 10.92a1 1 0 0 0-.02-1.84L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.83l8.57 3.91a2 2 0 0 0 1.66 0z" /><path d="M22 10v6" /><path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5" /></Svg>;
export const IconPack = ({ s }: { s?: number }) => <Svg s={s}><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><path d="M3.3 7 12 12l8.7-5" /><path d="M12 22V12" /></Svg>;
export const IconTrash = ({ s }: { s?: number }) => <Svg s={s}><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M10 11v6" /><path d="M14 11v6" /></Svg>;
export const IconChevron = ({ s }: { s?: number }) => <Svg s={s}><path d="M6 9l6 6 6-6" /></Svg>;

export const IconSearch = ({ s }: { s?: number }) => <Svg s={s}><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.3-4.3" /></Svg>;
export const IconClose = ({ s }: { s?: number }) => <Svg s={s}><path d="M18 6 6 18" /><path d="M6 6l12 12" /></Svg>;
export const IconPause = ({ s }: { s?: number }) => <Svg s={s}><path d="M9 5v14" /><path d="M15 5v14" /></Svg>;
// resume: the pause glyph's opposite, drawn at the same optical weight (stroked, not filled —
// a solid triangle reads heavier than the two bars it alternates with)
export const IconPlay = ({ s }: { s?: number }) => <Svg s={s}><path d="M7 4.5v15l12-7.5z" /></Svg>;
export const IconPaperclip = ({ s }: { s?: number }) => <Svg s={s}><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></Svg>;
export const IconFile = ({ s }: { s?: number }) => <Svg s={s}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></Svg>;
// send — an arrow, not the ↵ glyph: ↵ names the KEY, which only helps if you already knew the
// shortcut, and it rendered at a different optical weight in every font fallback.
export const IconSend = ({ s }: { s?: number }) => <Svg s={s}><path d="M12 19V5" /><path d="m5 12 7-7 7 7" /></Svg>;
export const IconImage = ({ s }: { s?: number }) => <Svg s={s}><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="9" cy="9" r="1.6" /><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" /></Svg>;
// message hover-action glyphs (copy · pin · resend)
export const IconResend = ({ s }: { s?: number }) => <Svg s={s}><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" /><path d="M3 21v-5h5" /></Svg>;
// repo-connect + code-workspace glyphs (folder · git branch)
export const IconFolder = ({ s }: { s?: number }) => <Svg s={s}><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" /></Svg>;
export const IconProject = ({ s }: { s?: number }) => <Svg s={s}><rect x="3" y="3" width="18" height="18" rx="4" /><path d="M8 9h8" /><path d="M8 13h5" /></Svg>;
export const IconBranch = ({ s }: { s?: number }) => <Svg s={s}><circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="6" r="3" /><path d="M6 9v6" /><path d="M18 9a9 9 0 0 1-9 9" /></Svg>;
export const IconCompose = ({ s }: { s?: number }) => <Svg s={s}><path d="M12 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-6" /><path d="M18.4 3.6a2 2 0 0 1 2.8 2.8L13 14.6l-3.8.9.9-3.8z" /></Svg>;
export const IconCircleGlyph = ({ s }: { s?: number }) => <Svg s={s}><circle cx="12" cy="12" r="6.5" /></Svg>;
export const IconCheckCircle = ({ s }: { s?: number }) => <Svg s={s}><circle cx="12" cy="12" r="8" /><path d="m8.5 12.3 2.4 2.4 4.6-5" /></Svg>;
export const IconPen = ({ s }: { s?: number }) => <Svg s={s}><path d="M17 3.6a2.2 2.2 0 0 1 3.1 3.1L8.5 18.3 4 19.5l1.2-4.5z" /></Svg>;
export const IconFolderOpen = ({ s }: { s?: number }) => <Svg s={s}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v1" /><path d="M3 19v-8h16.4a1 1 0 0 1 .96 1.28l-1.7 6a1 1 0 0 1-.96.72H5a2 2 0 0 1-2-2z" /></Svg>;
export const IconTheme = ({ s }: { s?: number }) => <Svg s={s}><circle cx="12" cy="12" r="9" /><path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor" stroke="none" /></Svg>;
// icon-rail glyphs (the 8 app views) — stroke icons, currentColor, theme-aware
export const IconInbox = ({ s }: { s?: number }) => <Svg s={s}><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /></Svg>;
export const IconCheck = ({ s }: { s?: number }) => <Svg s={s}><path d="M20 6 9 17l-5-5" /></Svg>;

/* ── Provider marks (docs/29 §4d) ──────────────────────────────────────────────────────────────
   Which INFERENCE PROVIDER a leg's model runs on, at the seat. Simplified geometry rather than
   traced logos: at 13px a faithful trace is mud, and the job here is to be recognisable at a glance
   in a dense row, not to reproduce a wordmark. Monochrome like everything else on the card — they
   inherit `currentColor`, so they read as part of the seat rather than as three brand colours
   fighting the row. */
export const IconAnthropic = ({ s }: { s?: number }) => (
  <svg width={s ?? 11} height={s ?? 11} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M6.6 4h3.5l5.2 16h-3.6l-1-3.3H6.9l-1 3.3H2.3zm.9 9.9h3.1L9 8.4z" />
    <path d="M15.9 4h3.4L24 20h-3.5z" opacity=".55" />
  </svg>
);
export const IconOpenAI = ({ s }: { s?: number }) => (
  <svg width={s ?? 11} height={s ?? 11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3 20 7.5v9L12 21 4 16.5v-9z" />
    <path d="M12 12v9M12 12l8-4.5M12 12 4 7.5" opacity=".55" />
  </svg>
);
export const IconGemini = ({ s }: { s?: number }) => (
  <svg width={s ?? 11} height={s ?? 11} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 2c.6 4.9 4.5 8.8 9.4 9.4v1.2C16.5 13.2 12.6 17.1 12 22h-1.2C10.2 17.1 6.3 13.2 1.4 12.6v-1.2C6.3 10.8 10.2 6.9 10.8 2z" />
  </svg>
);
/** The mark for a model id, or null when the family is unknown (never guess a vendor). */
export function ProviderMark({ model, s }: { model: string; s?: number }) {
  let p: string;
  try { p = providerForModel(model); } catch { return null; }
  if (p === 'anthropic') return <IconAnthropic s={s} />;
  if (p === 'openai') return <IconOpenAI s={s} />;
  return <IconGemini s={s} />;
}
export const IconMedal = ({ s }: { s?: number }) => <Svg s={s}><circle cx="12" cy="8" r="6" /><path d="M15.48 12.89 17 22l-5-3-5 3 1.52-9.11" /></Svg>;
export const IconTrend = ({ s }: { s?: number }) => <Svg s={s}><path d="m22 7-8.5 8.5-5-5L2 17" /><path d="M16 7h6v6" /></Svg>;
export const IconThreads = ({ s }: { s?: number }) => <Svg s={s}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></Svg>;
// threads-mode chip (list rows + a branch node — "threaded vs flat"), distinct from IconThreads (the chat view)
export const IconBrain = ({ s }: { s?: number }) => <Svg s={s}><path d="M12 4.5a3 3 0 0 0-3 3.1c-1.8.4-3.1 1.9-3.1 3.8a3.9 3.9 0 0 0 1.5 3.1 3.4 3.4 0 0 0 3.3 4.4c.4 0 .9-.1 1.3-.2.4.1.9.2 1.3.2a3.4 3.4 0 0 0 3.3-4.4 3.9 3.9 0 0 0 1.5-3.1c0-1.9-1.3-3.4-3.1-3.8a3 3 0 0 0-3-3.1z" /><path d="M12 4.5v15" /></Svg>;
export const IconReply = ({ s }: { s?: number }) => <Svg s={s}><path d="M9 15 4 10l5-5" /><path d="M4 10h9a7 7 0 0 1 7 7v2" /></Svg>;
export const IconBoard = ({ s }: { s?: number }) => <Svg s={s}><rect x="3" y="3" width="7" height="9" rx="1" /><rect x="14" y="3" width="7" height="5" rx="1" /><rect x="3" y="16" width="7" height="5" rx="1" /><rect x="14" y="12" width="7" height="9" rx="1" /></Svg>;
// whiteboards (docs/38): a canvas with a sketched line — distinct from IconBoard's kanban stagger
export const IconWhiteboard = ({ s }: { s?: number }) => <Svg s={s}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="m7 14.5 3.2-4.2 2.6 3 3.9-5.3" /></Svg>;
export const IconCredits = ({ s }: { s?: number }) => <Svg s={s}><circle cx="12" cy="12" r="9" /><path d="M9.5 9.2a2.6 2.6 0 1 0 0 5.6" /><path d="M13 8.5v7" /></Svg>;
export const IconFootprint = ({ s }: { s?: number }) => <Svg s={s}><circle cx="12" cy="12" r="9" /><path d="M12 3a9 9 0 0 1 9 9" /><path d="M12 12V3" /><path d="M12 12h9" /></Svg>;
// the whiteboard tab is the ONLY React.lazy surface in the strip: the Excalidraw bundle is a
// chunk paid on first board open, never at boot (docs/38 — the <2s cold-start budget)
// 2×2 grid — the head's "all projects" glyph (distinct from IconBoard's kanban stagger)
export const IconGrid = ({ s }: { s?: number }) => <Svg s={s}><rect x="3.5" y="3.5" width="7" height="7" rx="1.6" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.6" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.6" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.6" /></Svg>;
// room utilities (conversation-first shell): the history clock + the view-menu burger
export const IconHistory = ({ s }: { s?: number }) => <Svg s={s}><circle cx="12" cy="12" r="8.6" /><path d="M12 7.5V12l3 2" /></Svg>;
export const IconBurger = ({ s }: { s?: number }) => <Svg s={s}><path d="M4 7h16M4 12h16M4 17h16" /></Svg>;
export const IconAgents = ({ s }: { s?: number }) => <Svg s={s}><circle cx="12" cy="5" r="2.4" /><circle cx="5" cy="19" r="2.4" /><circle cx="19" cy="19" r="2.4" /><path d="M12 7.4v3.6M12 11l-5.4 6M12 11l5.4 6" /></Svg>;
// the one warning glyph — the switch sheet's live-agent row and the settings locks
export const IconAlert = ({ s }: { s?: number }) => <Svg s={s}><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4" /><path d="M12 17h.01" /></Svg>;
export const IconLibrary = ({ s }: { s?: number }) => <Svg s={s}><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></Svg>;
export const IconMemory = ({ s }: { s?: number }) => <Svg s={s}><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v6c0 1.66 3.58 3 8 3s8-1.34 8-3V5" /><path d="M4 11v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6" /></Svg>;
export const IconActivity = ({ s }: { s?: number }) => <Svg s={s}><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></Svg>;
export const IconCode = ({ s }: { s?: number }) => <Svg s={s}><path d="M4 17l6-6-6-6" /><path d="M13 19h7" /></Svg>;
export const IconTerm = ({ s }: { s?: number }) => <Svg s={s}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="m7 9 2.5 2.5L7 14" /><path d="M12.5 14H17" /></Svg>;
export const IconGlobe = ({ s }: { s?: number }) => <Svg s={s}><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3a13.5 13.5 0 0 1 0 18 13.5 13.5 0 0 1 0-18z" /></Svg>;
export const IconArrowL = ({ s }: { s?: number }) => <Svg s={s}><path d="M19 12H5" /><path d="m12 19-7-7 7-7" /></Svg>;
export const IconArrowR = ({ s }: { s?: number }) => <Svg s={s}><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></Svg>;
export const IconArrowUp = ({ s }: { s?: number }) => <Svg s={s}><path d="M12 19V5" /><path d="m5 12 7-7 7 7" /></Svg>;
// download — the arrow lands ON a tray, which is what distinguishes it from IconArrowUp flipped
export const IconDownload = ({ s }: { s?: number }) => <Svg s={s}><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M3 21h18" /></Svg>;
export const IconExternal = ({ s }: { s?: number }) => <Svg s={s}><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><path d="M15 3h6v6" /><path d="M10 14 21 3" /></Svg>;
// the design studio's ⤢ / collapse pair — corners pushing out, corners pulling in
export const IconExpand = ({ s }: { s?: number }) => <Svg s={s}><path d="M15 3h6v6" /><path d="M9 21H3v-6" /><path d="M21 3l-7 7" /><path d="M3 21l7-7" /></Svg>;
export const IconCollapse = ({ s }: { s?: number }) => <Svg s={s}><path d="M14 10h6V4" /><path d="M10 14H4v6" /><path d="M20 4l-6 6" /><path d="M4 20l6-6" /></Svg>;
// dock-position glyphs: an app frame with the nav region (filled) on one edge
export const IconDockLeft = ({ s }: { s?: number }) => <Svg s={s}><rect x="3" y="4" width="18" height="16" rx="2" /><rect x="4.5" y="5.5" width="4" height="13" rx="1" fill="currentColor" stroke="none" /></Svg>;
export const IconDockTop = ({ s }: { s?: number }) => <Svg s={s}><rect x="3" y="4" width="18" height="16" rx="2" /><rect x="4.5" y="5.5" width="15" height="4" rx="1" fill="currentColor" stroke="none" /></Svg>;
export const IconDockRight = ({ s }: { s?: number }) => <Svg s={s}><rect x="3" y="4" width="18" height="16" rx="2" /><rect x="15.5" y="5.5" width="4" height="13" rx="1" fill="currentColor" stroke="none" /></Svg>;
// the Workbench's own glyph (rail-ink round 3, 2026-09-04): a sheet with a card floating inside it
// at the right edge — what the panel IS now. The dock-right glyph it used to wear means the side
// panel, so the two switches stopped sharing a picture.
export const IconWorkbench = ({ s }: { s?: number }) => <Svg s={s}><rect x="3" y="4" width="18" height="16" rx="2" /><rect x="11.5" y="8" width="6.5" height="8" rx="1.2" fill="currentColor" stroke="none" /></Svg>;
// chrome icons (replacing the boring emoji set — gear/person/sparkle/logout/home/cloud/machine/lock/store)
export const IconSettings = ({ s }: { s?: number }) => <Svg s={s}><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></Svg>;
export const IconArchive = ({ s }: { s?: number }) => <Svg s={s}><rect x="3" y="3.5" width="18" height="5" rx="1.5" /><path d="M5 8.5V19a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5" /><path d="M10 12.5h4" /></Svg>;
export const IconUser = ({ s }: { s?: number }) => <Svg s={s}><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></Svg>;
// IconSparkle was DELETED (George, 2026-09-05: "never use sparkle icon for me in our designs") — the
// generic AI-magic mark says nothing about a control; draw the thing itself, or IconAuto for "auto".
export const IconSignOut = ({ s }: { s?: number }) => <Svg s={s}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5" /><path d="M21 12H9" /></Svg>;
export const IconHome = ({ s }: { s?: number }) => <Svg s={s}><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><path d="M9 22V12h6v10" /></Svg>;
export const IconRepeat = ({ s }: { s?: number }) => <Svg s={s}><path d="M17 2.5l4 4-4 4" /><path d="M3 11.5v-2a3 3 0 0 1 3-3h15" /><path d="M7 21.5l-4-4 4-4" /><path d="M21 12.5v2a3 3 0 0 1-3 3H3" /></Svg>;
/** the routine marker (2026-08-22): a session a scheduled automation opened — clock face, hands at ten past */
export const IconRoutineClock = ({ s }: { s?: number }) => <Svg s={s}><circle cx="12" cy="12" r="9" /><path d="M12 7.5V12l3.2 2" /></Svg>;
export const IconCalendar = ({ s }: { s?: number }) => <Svg s={s}><rect x="3" y="4.5" width="18" height="17" rx="2.5" /><path d="M8 2.5v4M16 2.5v4M3 9.5h18" /></Svg>;
export const IconCmd = ({ s }: { s?: number }) => <Svg s={s}><path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3" /></Svg>;
/** Auto — a FORK: one path that splits toward two places, the ladder picking which. Never the
 *  sparkle, and not a letter either (George, 2026-09-05: "we need an actual icon"). */
export const IconAuto = ({ s }: { s?: number }) => <Svg s={s}><path d="M12 21v-7" /><path d="M12 14c0-3.5-5-3.5-5-7.5" /><path d="M12 14c0-3.5 5-3.5 5-7.5" /><path d="M4.5 9 7 6.5 9.5 9" /><path d="M14.5 9 17 6.5 19.5 9" /></Svg>;
export const IconCloud = ({ s }: { s?: number }) => <Svg s={s}><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9z" /></Svg>;
/** a CLOUD machine: the chassis with a small cloud badged at its top-right — one mark, not a machine
 *  beside a cloud (George, 2026-09-05: the pill's machine next to the sync cloud read as two facts) */
export const IconCloudMachine = ({ s }: { s?: number }) => <Svg s={s}><rect x="2" y="7" width="13.5" height="9.8" rx="2" /><path d="M5.5 20.5h6.5" /><path d="M8.75 16.8v3.7" /><path d="M17.2 8.4h4.5a2.25 2.25 0 0 0 .3-4.5 3.2 3.2 0 0 0-6.1 1.1 1.9 1.9 0 0 0 1.3 3.4z" /></Svg>;
/** a server someone runs themselves — Settings › Connections' Manual setup and the custom card */
export const IconServer = ({ s }: { s?: number }) => <Svg s={s}><rect x="3" y="4" width="18" height="6" rx="1.5" /><rect x="3" y="14" width="18" height="6" rx="1.5" /><path d="M7 7h.01M7 17h.01" /></Svg>;
export const IconMachine = ({ s }: { s?: number }) => <Svg s={s}><rect x="2" y="4" width="20" height="12" rx="2" /><path d="M2 20h20" /><path d="M9 20v-4h6v4" /></Svg>;
export const IconLock = ({ s }: { s?: number }) => <Svg s={s}><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></Svg>;
export const IconStore = ({ s }: { s?: number }) => <Svg s={s}><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" /><path d="M3 6h18" /><path d="M16 10a4 4 0 0 1-8 0" /></Svg>;

// The dedicated Projects home (mockups round 1 Variant A + prototype v3.2): large cards
// over the switcher-era rollup — identity, board pulse, rooms · open · agents, last
// activity — with the plan cap surfaced at the exact moment it applies (the + card) and
// every management action reusing existing surfaces. The head opens this page; the old
// dropdown retired with it, so this page IS the switcher.
export const IconKebab = ({ s }: { s?: number }) => <svg width={s ?? 15} height={s ?? 15} viewBox="0 0 24 24" fill="currentColor" aria-hidden><circle cx="12" cy="5.4" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="12" cy="18.6" r="1.7" /></svg>;

/* ── Connector marks (the composer-foot round, 2026-09-11; docs/design/composer-foot-2026-09) ───────
   Which CONNECTOR a mark stands for, in the composer foot and the Connections rows. The provider
   marks' rule, restated: simplified geometry rather than traced logos, one stroke weight, and
   `currentColor` so a mark reads as part of the row — dim until it is connected, body ink after —
   never a row of brand colours fighting the composer. Text glyphs (𝕏, in, ◫, ♪) drew at different
   weights, which is why these are SVGs (George, 2026-09-05, on the machine chip's ⌂/☁). */
export const IconX = ({ s }: { s?: number }) => <Svg s={s}><path d="M5 4l14 16" /><path d="M19 4l-4.9 5.6" /><path d="M9.9 14.4 5 20" /></Svg>;
export const IconLinkedIn = ({ s }: { s?: number }) => <Svg s={s}><rect x="3.5" y="3.5" width="17" height="17" rx="3" /><path d="M7.6 10.8V16.2" /><circle cx="7.6" cy="7.6" r="1" fill="currentColor" stroke="none" /><path d="M11.4 16.2v-5.4" /><path d="M11.4 13.2a2.6 2.6 0 0 1 5.2 0v3" /></Svg>;
export const IconInstagram = ({ s }: { s?: number }) => <Svg s={s}><rect x="3.5" y="3.5" width="17" height="17" rx="4.5" /><circle cx="12" cy="12" r="3.6" /><circle cx="16.8" cy="7.2" r=".9" fill="currentColor" stroke="none" /></Svg>;
export const IconTikTok = ({ s }: { s?: number }) => <Svg s={s}><path d="M13.5 4v10.2a3.3 3.3 0 1 1-3.3-3.3" /><path d="M13.5 4c.5 2.5 2.2 4.1 4.8 4.4" /></Svg>;
export const IconPostHog = ({ s }: { s?: number }) => <Svg s={s}><path d="M4 18.5h16" /><path d="M6 14.5l4-4.5 3 3 5-6.5" /></Svg>;
export const IconMeta = ({ s }: { s?: number }) => <Svg s={s}><path d="M12 12c-1.6-3.3-3.1-5.5-5-5.5S3.5 9 3.5 12s1.6 5.5 3.5 5.5 3.4-2.2 5-5.5 3.1-5.5 5-5.5 3.5 2.5 3.5 5.5-1.6 5.5-3.5 5.5-3.4-2.2-5-5.5z" /></Svg>;
export const IconTikTokAds = ({ s }: { s?: number }) => <Svg s={s}><rect x="3.5" y="3.5" width="17" height="17" rx="3" /><path d="M13.2 7.5v6.3a2.3 2.3 0 1 1-2.3-2.3" /><path d="M13.2 7.5c.3 1.6 1.4 2.6 3 2.8" /></Svg>;
/** the horizontal three dots — "and the rest", the overflow door (IconKebab is the vertical menu mark) */
export const IconEllipsis = ({ s }: { s?: number }) => <svg width={s ?? 15} height={s ?? 15} viewBox="0 0 24 24" fill="currentColor" aria-hidden><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></svg>;

// ── The playbook glyphs (the Marketing OS desk round, 2026-09-17): literal marks, one per playbook, the
// rail's "the glyph says the kind" rule applied to the catalog. Keyed in views/mkosbits.tsx PLAYBOOK_GLYPH.
export const IconGauge = ({ s }: { s?: number }) => <Svg s={s}><path d="M12 14.5 16.2 9.3" /><path d="M4.5 16.5a8.5 8.5 0 1 1 15 0" /></Svg>;
export const IconCrosshair = ({ s }: { s?: number }) => <Svg s={s}><circle cx="12" cy="12" r="7.5" /><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4" /></Svg>;
export const IconCompass = ({ s }: { s?: number }) => <Svg s={s}><circle cx="12" cy="12" r="9" /><path d="m15.5 8.5-2 5-5 2 2-5z" /></Svg>;
export const IconRadar = ({ s }: { s?: number }) => <Svg s={s}><circle cx="12" cy="13" r="1.4" fill="currentColor" stroke="none" /><path d="M8.5 16.5a5 5 0 1 1 7 0" /><path d="M5.6 19.4a9 9 0 1 1 12.8 0" /></Svg>;
export const IconFlask = ({ s }: { s?: number }) => <Svg s={s}><path d="M9 3h6" /><path d="M10 3v6L4.5 19a1.5 1.5 0 0 0 1.3 2.2h12.4a1.5 1.5 0 0 0 1.3-2.2L14 9V3" /><path d="M7 15h10" /></Svg>;
export const IconAnchor = ({ s }: { s?: number }) => <Svg s={s}><circle cx="12" cy="5" r="2" /><path d="M12 7v14" /><path d="M5 13a7 7 0 0 0 14 0" /></Svg>;
export const IconMail = ({ s }: { s?: number }) => <Svg s={s}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></Svg>;
export const IconRocket = ({ s }: { s?: number }) => <Svg s={s}><path d="M5 15c-1.5 1.5-2 5-2 5s3.5-.5 5-2" /><path d="M14 4c3-1 6-1 6-1s0 3-1 6c-2 4-6 7-8 8l-4-4c1-2 4-6 7-9z" /><circle cx="15" cy="9" r="1.5" /></Svg>;
export const IconSpeaker = ({ s }: { s?: number }) => <Svg s={s}><path d="M3 11v2a2 2 0 0 0 2 2h1l4 4V5L6 9H5a2 2 0 0 0-2 2z" /><path d="M15 9a3 3 0 0 1 0 6" /><path d="M18 6a7 7 0 0 1 0 12" /></Svg>;
export const IconPhone = ({ s }: { s?: number }) => <Svg s={s}><rect x="6" y="2.5" width="12" height="19" rx="2.5" /><path d="M11 18h2" /></Svg>;
