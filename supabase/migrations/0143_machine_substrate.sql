-- THE CLAIM SUBSTRATE (docs/design/agent-sandbox-2026-09/plan.md §5.1, §5.2).
--
-- A cloud machine's pod is made of one of two things. `volume` is what every row before this
-- migration was: a StatefulSet with a PVC in the workspace namespace, the shape a login lives on.
-- `claim` is a SandboxClaim in the shared runners namespace that adopts a pre-warmed spare in
-- about a second and holds nothing at rest. Only a login-less runner is ever a claim, and the
-- first login promotes it (machine.promote) — the default here is `volume` on purpose, so
-- nothing about a machine that exists today changes.
--
-- A claim's pod has no identity when it starts (a claim that sets env would cold-start, KEP-0208),
-- so identity is an exchange: nm-fleet BINDS the adopted pod's name and uid here (pod_name,
-- pod_uid; the bind clears token_hash so no earlier token can speak for the new pod), and the pod
-- REDEEMS the binding with the pool token for its machine token (bootstrapped_at). A re-issue to
-- the same pod rotates the hash; a different pod cannot redeem it, because it does not hold that
-- pod's uid.
alter table machines
  add column substrate text not null default 'volume' check (substrate in ('volume', 'claim')),
  add column pod_name text,
  add column pod_uid text,
  add column bootstrapped_at timestamptz;

comment on column machines.substrate is
  'volume = StatefulSet + PVC in ws-<id> (login-bearing) · claim = SandboxClaim from the warm pool in nm-runners (nothing at rest). A login promotes claim → volume.';
comment on column machines.pod_name is
  'claim only: the adopted pod nm-fleet bound to this row; cleared on stop and on promotion';
comment on column machines.pod_uid is
  'claim only: that pod''s uid — what the bootstrap call must present; unguessable, so a sibling pod cannot redeem it';
comment on column machines.bootstrapped_at is
  'claim only: when the pod last redeemed its binding for a machine token; NULL between a bind and its redemption';

create index machines_bound_pod on machines (pod_name, pod_uid) where pod_name is not null;
