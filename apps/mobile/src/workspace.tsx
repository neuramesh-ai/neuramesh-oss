// The active workspace, and the ability to change it (0113).
//
// Membership is a SET: `workspace_members` is PK (workspace_id, user_id) and the sync rules
// stream every workspace you belong to into the one replica. This used to be
// `select workspace_id from workspace_members limit 1` — not merely arbitrary but
// NON-DETERMINISTIC, so a second membership could move the whole app between launches.
//
// Switching here is INSTANT, unlike the desktop's relaunch. The phone has no agent host, no
// machine registration and no per-workspace credentials to re-resolve — the workspace is a hook
// argument, so changing it just re-runs the queries. Both workspaces are already in the replica,
// so nothing is re-downloaded either.
import { type WorkspaceMembership, pickActiveWorkspace } from '@neuramesh/client-core';
import { useQuery } from '@powersync/react-native';
import * as SecureStore from 'expo-secure-store';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from './auth';

const ACTIVE_KEY = 'nm.workspace';

interface WorkspaceCtxValue {
  /** the workspace every screen scopes to — null only before the first sync lands */
  active: string | null;
  /** every membership, with names. Names come from the API: `workspaces` is deliberately
   *  outside the PowerSync publication, so the replica has ids and no names. */
  workspaces: WorkspaceMembership[];
  setActive: (id: string) => void;
  /** true while the names are still being fetched — the switcher shows ids-only meanwhile */
  loading: boolean;
}

const Ctx = createContext<WorkspaceCtxValue>({ active: null, workspaces: [], setActive: () => {}, loading: true });

export function useWorkspace(): WorkspaceCtxValue {
  return useContext(Ctx);
}

/** The active workspace id. Kept as its own hook so the existing call sites are unchanged. */
export function useActiveWorkspace(): string | null {
  return useContext(Ctx).active;
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  // ids come from the REPLICA (offline-first, and the authority on what you belong to)
  const { data: memberRows } = useQuery<{ id: string }>('select distinct workspace_id as id from workspace_members');
  const [named, setNamed] = useState<WorkspaceMembership[]>([]);
  const [stored, setStored] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    SecureStore.getItemAsync(ACTIVE_KEY)
      .then((v) => setStored(v))
      .catch(() => { /* no stored choice — fall back to the first membership */ })
      .finally(() => setHydrated(true));
  }, []);

  // names, on demand — and again whenever the replica shows a membership the names do not cover:
  // the workspace the wizard just minted (S6), or one you were just added to. A failure is not
  // fatal: the ids still drive every query, so the app works and only the labels degrade.
  const unnamed = (memberRows ?? []).map((r) => r.id).filter((id) => id && !named.some((w) => w.id === id)).join(',');
  useEffect(() => {
    let cancelled = false;
    api.workspaces()
      .then((r) => { if (!cancelled) setNamed(r.workspaces ?? []); })
      .catch(() => { /* offline: fall through to the replica's ids */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unnamed]);

  // The replica is the authority on MEMBERSHIP; the API only supplies names. Reconciling this
  // way means a workspace you were just removed from disappears on the next sync rather than
  // lingering because a cached name still mentions it.
  const workspaces = useMemo<WorkspaceMembership[]>(() => {
    const ids = (memberRows ?? []).map((r) => r.id).filter(Boolean);
    if (!ids.length) return [];
    return ids.map((id) => named.find((w) => w.id === id) ?? { id, name: 'Workspace', slug: '' });
  }, [memberRows, named]);

  // Don't resolve before the stored choice has loaded: picking the first workspace and then
  // correcting it a tick later would flash the wrong workspace's board on every cold start.
  const active = hydrated ? (pickActiveWorkspace(workspaces, stored)?.id ?? null) : null;

  const setActive = useCallback((id: string) => {
    setStored(id);
    void SecureStore.setItemAsync(ACTIVE_KEY, id);
  }, []);

  const value = useMemo(() => ({ active, workspaces, setActive, loading }), [active, workspaces, setActive, loading]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
