// The thread's context sections — and the strip that stands in for them when the panel is shut.
// Extracted from App.tsx (track A3).
import { Fragment } from 'react';
import { type RailSection } from './parts';

/**
 * ── `ThreadRail` IS GONE (2026-08-17, George) ────────────────────────────────────────────────
 * It was the `<aside class="mkrail">` inside the sheet, with a collapse, a hover-peek and its own
 * `nm:mkrail-collapsed`. The 2026-08-16 round moved the task's copy of it into the **Workbench**
 * and left the conversation's behind, so a content thread drew its brand panel three inches from
 * the panel built to hold it — and opening the Workbench put two panels at the same edge.
 *
 * The sections now live in exactly one place: the Workbench's **Details** face, scoped to whatever
 * you are standing in (`shell/workbench-state.ts`). `RailSections` — the body both surfaces always
 * shared — is unchanged and is what gets portalled in.
 *
 * What replaces the in-sheet panel is `RailToks`: one line under the thread head naming what the
 * Details face holds, each tok a door to it. That is the honest answer to this cut's one real
 * cost — with the panel shut the sections are off-screen, so the thread has to say they exist.
 */

/** The rail's contents — portalled into the Workbench's Details slot. */
export function RailSections({ sections, extra }: { sections: RailSection[]; extra?: React.ReactNode }) {
  return (
    <>
      {sections.map((s, i) => (
        <Fragment key={s.key}>
          <div className={`mkrailhead${i === 0 ? ' mkrailhead0' : ' mkrailhead2'}${s.warm ? ' warm' : ''}`}>
            {s.head}
            {s.meta && <span className="mkrailct">{s.meta}</span>}
          </div>
          {s.body}
        </Fragment>
      ))}
      {/* the room's sections, under the thread's — hence the head-0 class riding the first only */}
      {extra}
    </>
  );
}

/**
 * The Details face's stand-in, under the thread head: what the panel holds, said out loud, one
 * click from opening it. Counts only where a count MEANS something — an empty section's `+`
 * invite reads as noise in a strip with no heading beside it to explain what it adds — and a
 * section holding a gate stays warm, which is the one thing that must survive the panel being shut.
 *
 * `extraLabel` covers the room's own sections (brand docs · upcoming · connections), which are
 * markup rather than a `RailSection[]` and so cannot be counted here.
 */
export function RailToks({ sections, extraLabel, label, onOpen }: {
  sections: RailSection[];
  extraLabel?: string | null;
  /** what the panel is called for this subject — the tok row's aria label */
  label: string;
  onOpen: () => void;
}) {
  if (!sections.length && !extraLabel) return null;
  return (
    <div className="thfacts" role="group" aria-label={label}>
      {sections.map((s) => (
        <button key={s.key} type="button" className={`tok${s.warm ? ' warm' : ''}`} onClick={onOpen}
          title={`${s.head} — open the details panel (⌘P)`}>
          {s.head.toLowerCase()}{s.meta ? <span className="tokct">{s.meta}</span> : null}
        </button>
      ))}
      {extraLabel && (
        <button type="button" className="tok" onClick={onOpen} title={`${extraLabel} — open the details panel (⌘P)`}>
          {extraLabel}
        </button>
      )}
    </div>
  );
}
