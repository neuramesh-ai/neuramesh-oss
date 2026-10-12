/** Device-local preferences. A pane-open override lasts for one open interval only. */
export type OverviewPreference = 'auto' | 'hidden' | 'shown';
export type OverviewState = { owner: string; paneOpen: boolean; expanded: boolean; preference: OverviewPreference; override: boolean };
export const overviewStorageKey = 'nm.thread-overview.v1';
export function overviewState(owner: string, paneOpen: boolean, expanded: boolean, preference: OverviewPreference = 'auto'): OverviewState {
  return { owner, paneOpen, expanded, preference, override: false };
}
export function reconcileOverview(state: OverviewState, owner: string, paneOpen: boolean, expanded: boolean, preference: OverviewPreference): OverviewState {
  if (owner !== state.owner) return overviewState(owner, paneOpen, expanded, preference);
  if (paneOpen === state.paneOpen && expanded === state.expanded) return state;
  return { ...state, paneOpen, expanded, override: paneOpen !== state.paneOpen || expanded ? false : state.override };
}
export function overviewVisible(state: OverviewState, wide: boolean, hasContent: boolean): boolean {
  if (state.expanded) return false;
  if (state.paneOpen) return state.override;
  return state.preference === 'shown' || (state.preference === 'auto' && wide && hasContent);
}
export function toggleOverview(state: OverviewState, visible: boolean): OverviewState {
  return state.paneOpen ? { ...state, override: !visible } : { ...state, preference: visible ? 'hidden' : 'shown' };
}
export function readOverviewPreferences(raw: string | null): [string, OverviewPreference][] {
  try {
    const entries: unknown = JSON.parse(raw ?? '[]');
    if (!Array.isArray(entries)) return [];
    return entries.filter((entry): entry is [string, OverviewPreference] => Array.isArray(entry) && entry.length === 2 && typeof entry[0] === 'string' && ['auto', 'hidden', 'shown'].includes(entry[1])).slice(-100);
  } catch { return []; }
}
export function saveOverviewPreference(raw: string | null, owner: string, preference: OverviewPreference): string {
  return JSON.stringify([...readOverviewPreferences(raw).filter(([key]) => key !== owner), [owner, preference]].slice(-100));
}
