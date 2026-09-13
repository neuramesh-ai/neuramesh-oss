export const ENGINEERING_COMPOSER_WIDTH_DEFAULT = 420;
export const ENGINEERING_COMPOSER_WIDTH_MIN = 320;
export const ENGINEERING_EDITOR_WIDTH_MIN = 440;
export const ENGINEERING_SPLITTER_WIDTH = 5;
export const ENGINEERING_COMPOSER_WIDTH_KEY = 'nm:engineering:composer-width';

/** Keep direct manipulation honest: neither the conversation nor editor may collapse. */
export function clampEngineeringComposerWidth(width: number, workspaceWidth: number): number {
  const maximum = Math.max(
    ENGINEERING_COMPOSER_WIDTH_MIN,
    workspaceWidth - ENGINEERING_EDITOR_WIDTH_MIN - ENGINEERING_SPLITTER_WIDTH,
  );
  return Math.round(Math.min(maximum, Math.max(ENGINEERING_COMPOSER_WIDTH_MIN, width)));
}

export function loadEngineeringComposerWidth(): number {
  if (typeof localStorage === 'undefined') return ENGINEERING_COMPOSER_WIDTH_DEFAULT;
  const stored = Number(localStorage.getItem(ENGINEERING_COMPOSER_WIDTH_KEY));
  return Number.isFinite(stored) ? stored : ENGINEERING_COMPOSER_WIDTH_DEFAULT;
}

/** Move the compact Engineering workbench between its conversation and code panes. */
export function scrollEngineeringPane(selector: '.engconversation' | '.engeditor') {
  const workspace = document.querySelector<HTMLElement>('.engworkspace');
  const pane = workspace?.querySelector<HTMLElement>(selector);
  if (!workspace || !pane) return;
  // Chromium's smooth scrolling is cancelled by mandatory horizontal snap on this flex track,
  // leaving the pane at its old position. An exact snap is both reliable and reduced-motion safe.
  workspace.scrollTo({ left: pane.offsetLeft, behavior: 'auto' });
}
