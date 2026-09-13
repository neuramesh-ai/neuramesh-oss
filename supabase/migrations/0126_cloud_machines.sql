-- cloud machines (docs/design/cloud-first-2026-08/architecture.md §1, §3): the fleet's
-- desired state lives on the existing machines rows. additive columns only — every local
-- (laptop) row keeps kind='local' and is invisible to the fleet operator by construction.
-- machines is in the PowerSync publication via `select *`, so clients see these columns
-- once sync rules redeploy; nothing here changes row visibility.

alter table machines
  add column kind text not null default 'local' check (kind in ('local', 'member', 'runner')),
  add column provider text,
  add column region text,
  add column instance_id text,
  add column lifecycle text check (lifecycle in ('provisioning', 'stopped', 'waking', 'running', 'stopping', 'destroyed', 'error')),
  add column desired_replicas int not null default 0 check (desired_replicas in (0, 1)),
  add column resources jsonb not null default '{}'::jsonb,
  add column last_wake_at timestamptz,
  add column idle_stop_min int not null default 30;

-- the operator's poll: cloud machines per workspace
create index machines_cloud on machines (workspace_id) where kind <> 'local';

-- runners are workspace-shared and personal-credential-free; exactly one per workspace (v1)
create unique index machines_one_runner on machines (workspace_id) where kind = 'runner';
