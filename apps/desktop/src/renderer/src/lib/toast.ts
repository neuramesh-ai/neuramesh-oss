// Toast + the module-level deep-link openers — extracted from App.tsx (track A1).
// SINGLETONS: exactly one copy of each `let` may exist in the app; a second copy (from a
// duplicate extraction or a re-export cycle) silently eats toasts and deep-links.
import { useEffect, useRef, useState } from 'react';

// Transient toast (handoff flash(msg, kind)) — module-level trigger so any component fires it;
// App mounts the single listener via useToast.
//
// A toast may carry ONE undo (the settle round, 2026-09-09): settle has no standing reverse
// control anywhere, so the seconds after the act are the only place to take it back. The undo is
// a label and a thunk, never a second toast kind — anything more and it stops being a flash.
export interface ToastUndo { label: string; run: () => void }
export interface Toast { msg: string; undo?: ToastUndo }
export let _toastFn: ((t: Toast) => void) | null = null;
export function flashToast(msg: string, undo?: ToastUndo) { _toastFn?.({ msg, undo }); }

// Open Workspace settings focused on a provider — the AuthCard's "Use an API key instead" action.
// Module-level so the card (rendered deep inside <Md>) fires it without threading a callback
// through every Md caller; App registers the listener.
export let _openProviderSettings: ((provider: string) => void) | null = null;
export function openProviderSettings(provider: string) { _openProviderSettings?.(provider); }
// The same opener with NO provider to focus. WorkspaceSettings picks its tab as
// `focusPolicy ? 'policy' : focusProvider ? 'providers' : 'members'`, so an empty provider
// lands on Members — where Invite teammate lives. One registered opener, two doors: a second
// `let` for the same panel would be a second thing to register, unregister and keep in sync.
export function openWorkspaceMembers() { _openProviderSettings?.(''); }
// Same pattern for the permission card's "Change in workspace policy" link → opens Workspace settings on the Policy tab.
export let _openPolicySettings: (() => void) | null = null;
export function openPolicySettings() { _openPolicySettings?.(); }
// The Upgrade to Pro sheet (shell/UpgradeSheet.tsx) is ONE surface with three doors — the
// server's PLAN_LIMIT, Settings › Connections, and the rail's foot (U3b) — so the door is a
// module-level opener like the two above, and App registers the one listener.
export let _openUpgrade: (() => void) | null = null;
export function openUpgrade() { _openUpgrade?.(); }
/** Settings › Connections, opened on its tab — the foot's menu row (U3b) and the hosted gate use it */
export let _openConnectionsSettings: (() => void) | null = null;
export function openConnectionsSettings() { _openConnectionsSettings?.(); }
/** The Move to Cloud sheet (shell/MoveToCloudSheet.tsx): the This Mac card and the rail's foot (U3b) share the one door */
export let _openMoveToCloud: (() => void) | null = null;
export function openMoveToCloud() { _openMoveToCloud?.(); }
/** an undo needs longer than a read: 2.6s is enough to see "Settled", not to decide against it */
const TOAST_MS = 2600;
const TOAST_UNDO_MS = 5200;
export function useToast(): { toast: Toast | null; dismiss: () => void } {
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    _toastFn = (t: Toast) => {
      setToast(t);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setToast(null), t.undo ? TOAST_UNDO_MS : TOAST_MS);
    };
    return () => { _toastFn = null; window.clearTimeout(timer.current); };
  }, []);
  // taking the undo closes the toast with it — the offer is spent, and a stale "Undo" you can
  // press twice would fire a second unsettle at a thread that is already back
  return { toast, dismiss: () => { window.clearTimeout(timer.current); setToast(null); } };
}

// App() registers/unregisters the workspace-settings openers through these, since the
// underlying lets are module-private now.
export function setProviderSettingsOpener(fn: ((provider: string) => void) | null) { _openProviderSettings = fn; }
export function setPolicySettingsOpener(fn: (() => void) | null) { _openPolicySettings = fn; }
export function setUpgradeOpener(fn: (() => void) | null) { _openUpgrade = fn; }
export function setConnectionsSettingsOpener(fn: (() => void) | null) { _openConnectionsSettings = fn; }
export function setMoveToCloudOpener(fn: (() => void) | null) { _openMoveToCloud = fn; }
