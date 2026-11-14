-- R10 lane A (2026-11-09): the signup credits are a person's, once (NM-024), and an address the
-- in-app sign-up only asserted claims nothing until it is proven (NM-010).
--
-- signup_grant_at: set when the person's first workspace is granted its signup credits
-- (workspace-birth.ts grantSignupOnce claims it with `... where signup_grant_at is null returning`).
-- workspace.delete cascades a workspace's credit_grants, so the ledger alone forgot the grant and a
-- delete-then-sign-in-again funded a fresh "first" workspace every time.
alter table nm_users add column if not exists signup_grant_at timestamptz;

-- email_self_asserted: an account made by /auth/clerk/signup (Clerk marks a Backend-API address
-- verified, so its "verified" proves nothing) until the person opens the link mailed to the
-- address (email-proof.ts). While true the address answers no invitation and earns no credits.
alter table nm_users add column if not exists email_self_asserted boolean not null default false;

-- everyone who already owns a workspace that got signup credits has had theirs
update nm_users u set signup_grant_at = granted.at
  from (select m.user_id, min(g.created_at) as at
          from credit_grants g
          join workspace_members m on m.workspace_id = g.workspace_id and m.role = 'owner'
         where g.kind = 'signup'
         group by m.user_id) granted
 where granted.user_id = u.id and u.signup_grant_at is null;
