import { useCallback, useEffect, useState } from 'react';
import type { EngineeringSession } from './domain';
import type { EngineeringWorkspaceTab } from './EngineeringEditor';
import { loadEngineeringSessions } from './session-storage';

/** Bridges browser-owned Engineering sessions into the workspace shell's global thread rail. */
export function useEngineeringNavigation(workspaceId: string | undefined, engineeringOpen: boolean) {
  const [sessions, setSessions] = useState<EngineeringSession[]>([]);
  const [requestedId, setRequestedId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [homeRequest, setHomeRequest] = useState(0);
  const [workspaceTab, setWorkspaceTab] = useState<EngineeringWorkspaceTab>('changes');
  useEffect(() => {
    setSessions(workspaceId ? loadEngineeringSessions(workspaceId) : []);
    setRequestedId(null);
    setActiveId(null);
    setHomeRequest(0);
    setWorkspaceTab('changes');
  }, [workspaceId]);
  useEffect(() => {
    if (engineeringOpen) return;
    setRequestedId(null);
    setActiveId(null);
  }, [engineeringOpen]);
  const syncActive = useCallback((id: string | null) => {
    setActiveId(id);
    // Keep the shell's request cursor aligned with the session the destination actually opened.
    // Otherwise an older rail click remains live and can win again when a new local session is
    // appended, snapping the conversation back to the wrong runner/worktree.
    setRequestedId(id);
  }, []);
  const activeSession = sessions.find((session) => session.id === activeId) ?? null;
  const home = useCallback(() => {
    setRequestedId(null);
    setActiveId(null);
    setWorkspaceTab('changes');
    setHomeRequest((request) => request + 1);
  }, []);
  return { sessions, setSessions, requestedId, activeId, activeSession, homeRequest, home, workspaceTab, setWorkspaceTab, open: setRequestedId, syncActive };
}
