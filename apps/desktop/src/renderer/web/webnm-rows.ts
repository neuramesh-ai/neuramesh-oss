// the browser's ROSTER lane — the L1 watch the setup tracker reads, ported from sync.ts's
// loadRoster (apps/desktop/src/main/sync.ts:694) and its change listener.
//
// why this exists at all: the tracker derives every card from `machines`, `workspace_members`
// and the credential list. on the desktop those arrive over IPC; in the browser they did not
// arrive at all, so all three signals read NULL and `onboardingKnowable` kept the whole surface
// silent — on the one client the mockup actually draws it for. the round's ruling is that the
// browser IS the product and the desktop is optional, so a tracker that only ever appears on the
// optional client is not the feature.
//
// nothing here is new truth. the replica already syncs both tables (webnm-onboard's runner wait
// queries `machines` directly), and /v1/credentials is the same read the desktop issues. this is
// the wiring that was missing, not a second source.
import type { PowerSyncDatabase } from '@powersync/web';
import type { NMBridge } from '../src/bridge/nm';
import type { AgentRow, MachineRow, MemberRow } from '../src/bridge/rows-crew';
import { authHeaders, type WebNmConfig } from './webnm';

/** the three tables loadRoster reads. a change to any of them re-runs the query, the same
 *  contract the desktop's watchers give the renderer. */
const ROSTER_TABLES = ['machines', 'agents', 'workspace_members', 'agent_channels', 'runs'];

interface Roster { machines: MachineRow[]; agents: AgentRow[]; members: MemberRow[] }

/** loadRoster's queries, minus the columns the browser has no consumer for. `kind` (0126) is the
 *  column the two machine cards read and nothing else can — a machine row without one is local,
 *  mirroring the schema's NOT NULL DEFAULT. */
async function readRoster(db: PowerSyncDatabase, ws: string): Promise<Roster> {
  const [machines, agents, members] = await Promise.all([
    db.getAll<MachineRow>('select id, name, platform, daemon_version, last_seen_at, owner_user_id, runtimes, kind from machines where workspace_id = ? order by name', [ws]),
    db.getAll<AgentRow>(
      `select a.id, a.name, a.role, a.model, a.runtime, a.model_source, a.emoji, a.card, a.kind, a.status, a.machine_id, a.retired_at, a.description, a.brief,
        (select group_concat(c.slug, ', ') from agent_channels ac join channels c on c.id = ac.channel_id where ac.agent_id = a.id) as channels,
        (select group_concat(ac.channel_id, ',') from agent_channels ac where ac.agent_id = a.id) as channel_ids,
        (select m.name from runs r join machines m on m.id = r.machine_id
          where r.agent_id = a.id and r.state = 'running' order by r.started_at desc limit 1) as hosted_on
       from agents a where a.workspace_id = ? order by a.name`,
      [ws],
    ),
    db.getAll<MemberRow>('select user_id, role, display_name, compute from workspace_members where workspace_id = ? order by display_name', [ws]),
  ]);
  return { machines, agents, members };
}

export function rowOverrides(cfg: WebNmConfig, db: PowerSyncDatabase): Partial<NMBridge> {
  return {
    watchRoster: (cb: (p: Roster) => void): (() => void) => {
      let live = true;
      // a failed read must not become an EMPTY roster: "no cloud machine" is a claim, and the
      // tracker treats a missing lane and an empty one differently on purpose. so a throw leaves
      // the last good value standing rather than publishing a lie.
      const push = () => {
        if (!live) return;
        void readRoster(db, cfg.workspaceId()).then((r) => { if (live) cb(r); }).catch(() => {});
      };
      push();
      const stop = db.onChangeWithCallback({ onChange: () => push() }, { tables: ROSTER_TABLES });
      return () => { live = false; stop(); };
    },

    // ported from sync/ipc/agents.ts:103 — the same route, issued from the page. the server
    // membership-checks it (credentials-authz.ts), so the browser gets no more than the desktop.
    credentials: async () => {
      const res = await fetch(`${cfg.apiUrl}/v1/credentials?workspace=${encodeURIComponent(cfg.workspaceId())}`, {
        headers: await authHeaders(cfg),
      });
      if (!res.ok) throw new Error(`/v1/credentials failed ${res.status}`);
      return res.json();
    },

    // the caller's own push devices, platforms only. a failed read answers null rather than an
    // empty list — "we could not look" is not "you have no phone", and the tracker's mobile item
    // renders those two differently on purpose.
    devices: async () => {
      const res = await fetch(`${cfg.apiUrl}/v1/devices`, { headers: await authHeaders(cfg) });
      if (!res.ok) return null;
      return res.json();
    },
  };
}
