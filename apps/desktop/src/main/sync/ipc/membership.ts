// MEMBERSHIP IPC — invites, joining and leaving, and switching between workspaces.
//
// Eleven handlers split out of startSync's registration wall. They are one story: who is in
// this workspace, who has been asked, and which one the shell is standing in — including the
// live-run count the switch sheet warns about before it moves.
//
// The two lists are MUTABLE SESSION STATE that these handlers both read and write, so they
// travel as a holder object rather than as values. An imported binding cannot be assigned, and
// a getter pair would let a caller read one and write the other out of step.
//
// REGISTRATION POSITION IS LOAD-BEARING (see whiteboards.ts): called from exactly where these
// lines sat, and does nothing but register.
import { apiAuthHeaders } from '../../apiauth';
import { ipcMain } from 'electron';

/** a connection as the renderer reads it: its kind, where it stands, who is signed in, what it holds */
export interface ConnectionSummary {
  id: string;
  kind: 'local' | 'cloud' | 'custom';
  authMode: 'local' | 'clerk' | 'dev' | 'supabase';
  /** the API host — a custom server's band and foot wear it */
  host: string;
  /** the workspace the connection stands in, and every one the signed-in identity belongs to */
  workspaceId: string;
  workspace: { name: string; slug: string };
  workspaces: Session['wsMemberships'];
  /** the signed-in account on a cloud connection; a local connection has no account */
  account: { email: string } | null;
  /** the replica is open — the rail can read rows from it */
  live: boolean;
}

/** the memberships and invitations this session resolved — one object, shared by reference */
export type Session = {
  wsMemberships: Array<{ id: string; name: string; slug: string; role?: string; memberCount?: number; plan?: string }>;
  pendingInvites: Array<{ inviteId: string; workspaceId: string; workspaceName: string; role: string; inviterEmail: string | null; inviterName: string | null; createdAt: string; expiresAt: string }>;
};

export function registerMembershipIpc(deps: {
  ws: () => string;
  db: () => { getAll: <T>(sql: string, args?: unknown[]) => Promise<T[]> };
  api: (path: string, body?: unknown) => Promise<Record<string, unknown>>;
  /** a GETTER — the foreground connection's session (connections.ts) */
  session: () => Session;
  needsOnboarding: () => boolean;
  /** a GETTER — API_URL is a reassigned `let` in sync.ts (see whiteboards.ts) */
  apiUrl: () => string;
  actorId: () => string;
  refreshPendingInvites: () => Promise<unknown>;
  switchWorkspace: (workspace: string | null) => { ok: true; switching: true };
  /** every connection this launch holds, as the rail and the foot's menu read them (connections.ts) */
  connectionSummaries: () => ConnectionSummary[];
  /** bring another connection to the foreground, standing in one of its workspaces (sync.ts) */
  setForeground: (connectionId: string, workspaceId?: string) => { ok: true; switching: true };
}): void {
  const { ws, db, api, session, needsOnboarding, apiUrl, actorId, refreshPendingInvites, switchWorkspace, connectionSummaries, setForeground } = deps;

  // routed through api() so a seat-cap rejection (PLAN_LIMIT) surfaces the upgrade flow, not a raw error.
  // No password: the invitee's identity is resolved when they sign in (docs/27 §1d).
  ipcMain.handle('nm:invite', async (_e, { email }: { email: string }) =>
    api('/v1/commands', { type: 'workspace.invite', workspace: ws(), email }));

  ipcMain.handle('nm:invites', async () => {
    const res = await fetch(`${apiUrl()}/v1/invites?workspace=${ws()}`, {
      headers: await apiAuthHeaders(apiUrl(), { kind: 'human', id: actorId() }),
    });
    if (!res.ok) return [];
    return ((await res.json()) as { invites?: unknown[] }).invites ?? [];
  });

  ipcMain.handle('nm:revoke-invite', async (_e, { invite }: { invite: string }) =>
    api('/v1/commands', { type: 'workspace.revoke_invite', workspace: ws(), invite }));

  // ── multi-workspace (0113) ────────────────────────────────────────────────────────────────
  // The switcher's list. Served from the cached memberships so it renders offline; a refresh
  // runs alongside so a workspace joined on another device appears without a restart.
  ipcMain.handle('nm:workspaces', async () => {
    void (async () => {
      try {
        const { workspaces } = (await api('/v1/workspaces')) as { workspaces: Session['wsMemberships'] };
        session().wsMemberships = workspaces;
      } catch { /* keep the cached list — offline must still render the switcher */ }
    })();
    return { active: ws(), workspaces: session().wsMemberships };
  });

  ipcMain.handle('nm:my-invites', async () => {
    await refreshPendingInvites();
    return { invites: session().pendingInvites, needsOnboarding: needsOnboarding() };
  });

  ipcMain.handle('nm:accept-invite', async (_e, { invite }: { invite: string }) => {
    const r = (await api('/v1/commands', { type: 'workspace.accept_invite', invite })) as { workspaceId: string; workspaceName: string };
    // The membership is real now — refresh the list so the switcher can offer it immediately,
    // and drop the answered invitation so the card can't linger.
    try {
      const { workspaces } = (await api('/v1/workspaces')) as { workspaces: Session['wsMemberships'] };
      session().wsMemberships = workspaces;
    } catch { /* the switcher refreshes on next open */ }
    session().pendingInvites = session().pendingInvites.filter((i) => i.inviteId !== invite);
    console.log(`invite_accepted workspace=${r.workspaceId.slice(0, 8)}`);
    return r;
  });

  ipcMain.handle('nm:decline-invite', async (_e, { invite }: { invite: string }) => {
    await api('/v1/commands', { type: 'workspace.decline_invite', invite });
    session().pendingInvites = session().pendingInvites.filter((i) => i.inviteId !== invite);
    return { ok: true };
  });

  ipcMain.handle('nm:leave-workspace', async (_e, { workspace }: { workspace: string }) => {
    await api('/v1/commands', { type: 'workspace.leave', workspace });
    const { workspaces } = (await api('/v1/workspaces')) as { workspaces: Session['wsMemberships'] };
    session().wsMemberships = workspaces;
    // Left the one you were standing in: there is nowhere to be, so relaunch onto whatever
    // remains (or onboarding). Same contract as the switch below.
    if (workspace === ws()) return switchWorkspace(workspaces[0]?.id ?? null);
    return { ok: true, switching: false };
  });

  ipcMain.handle('nm:remove-member', async (_e, { member }: { member: string }) =>
    api('/v1/commands', { type: 'workspace.remove_member', workspace: ws(), member }));

  ipcMain.handle('nm:switch-workspace', async (_e, { workspace }: { workspace: string }) => {
    if (!session().wsMemberships.some((w) => w.id === workspace)) throw new Error('you are not a member of that workspace');
    return switchWorkspace(workspace);
  });

  // ── the connections (U3b: the rail's LOCAL and CLOUD bands, the foot's menu) ─────────────
  // The list the shell draws bands and kickers from. One shot on mount; main pushes
  // `nm:connections` whenever the registry changes, so the renderer never polls.
  ipcMain.handle('nm:connections', () => connectionSummaries());
  // Opening a row on another connection: the pointer flips in place (no relaunch), the
  // renderer hears `nm:foreground` and remounts. `workspaceId` must be one of that
  // connection's memberships — the registry refuses anything else.
  ipcMain.handle('nm:set-foreground', async (_e, { connectionId, workspaceId }: { connectionId: string; workspaceId?: string | null }) =>
    setForeground(connectionId, workspaceId ?? undefined));

  // How many agents are mid-flight on THIS machine right now — what the switch sheet warns
  // about, derived from the live rows rather than written into the copy. Zero live runs must
  // produce no warning at all, not a zeroed one.
  ipcMain.handle('nm:live-runs', async () => {
    const rows = await db().getAll<{ title: string; agent_name: string | null; number: number | null }>(
      `select r.title, a.name as agent_name, t.number
         from runs r left join agents a on a.id = r.agent_id left join tasks t on t.id = r.task_id
        where r.workspace_id = ? and r.state = 'running' order by r.started_at asc limit 8`,
      [ws()],
    );
    return { runs: rows };
  });
}
