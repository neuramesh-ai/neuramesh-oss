// SCOPE MEMORY — what each destination is narrowed to, remembered for the session.
//
// docs/33 §8: every workspace-wide destination carries a scope bar so narrowing is "a visible,
// reversible choice rather than an invisible default". This is the other half of that rule —
// a narrowing that silently vanishes the moment you look at something else is as surprising as
// one that silently persists forever.
//
// Before this, the behaviour was split and nobody had decided it: Tasks and Skills remembered
// their filter because App() happened to hold the state, while Whiteboards, Automations and
// Calendar forgot theirs because each declared its own. Same product, two answers, decided by
// where a `useState` line was written.
//
// So the destination owns its scope — it reads and writes by key — and the shell owns the
// remembering. Session only, deliberately: navPos/navSec/treePrefs persist to disk because they
// are how you like the app arranged, whereas a filter is where you happened to be looking.
import { useCallback, useState } from 'react';

export type Scope = {
  projectId: string | null;
  channelId: string | null;
  q: string;
};

/** an unnarrowed destination — the shape a key returns before anyone touches it */
export const NO_SCOPE: Scope = { projectId: null, channelId: null, q: '' };

export function useScopeMemory() {
  const [scopes, setScopes] = useState<Record<string, Scope>>({});

  /** the scope for one destination. Never undefined: an untouched key reads as unnarrowed. */
  const scopeOf = useCallback((key: string): Scope => scopes[key] ?? NO_SCOPE, [scopes]);

  /** patch one destination's scope. A PATCH, not a set: a scope bar changes one field at a
   *  time (project, then room, then query) and each control would otherwise clear the others. */
  const setScope = useCallback((key: string, patch: Partial<Scope>): void => {
    setScopes((s) => ({ ...s, [key]: { ...(s[key] ?? NO_SCOPE), ...patch } }));
  }, []);

  return { scopeOf, setScope };
}

/** what a destination receives: its own scope, and the way to change it. Two props, not six. */
export type ScopeProps = {
  scope: Scope;
  setScope: (patch: Partial<Scope>) => void;
};
