# Cloud sync under Clerk — one-time dashboard setup

The code + dev-stack config for Clerk cloud sync are shipped (`scripts/cloud-app.sh`),
and the cloud DB publication (step 3) is already applied. **Two one-time edits remain — both
in your PowerSync Cloud dashboard** (steps 1 & 2 below; only the dashboard can make them).
After those, `bash scripts/cloud-app.sh` signs you in with Clerk and syncs against
Supabase + PowerSync Cloud.

## How the secure path works (no client holds a signing key)

1. You sign in through Clerk (Google / GitHub / email) in your browser.
2. control-api verifies the Clerk session against Clerk's JWKS → maps your Clerk id →
   our internal uuid (`nm_users`) → hands back your Clerk **session id**.
3. Each sync cycle, control-api re-mints a short-lived **PowerSync token** from that
   session (Clerk's `powersync` JWT template; `aud` = your instance URL, `sub` = your
   Clerk id). The session lasts days, so no browser re-prompt.
4. Cloud PowerSync validates that token against **Clerk's JWKS**, and the workspace
   sync rule maps the Clerk `sub` → our uuid via an `nm_users` join.

The Clerk side (the `powersync` JWT template) is already created on your Clerk instance.
You only need the three cloud edits below.

---

## 1. PowerSync Cloud → Client Auth

Add Clerk as a trusted token issuer (keep any existing entry; this is additive):

- **JWKS URI:** `https://secure-hedgehog-28.clerk.accounts.dev/.well-known/jwks.json`
- **Audience:** your instance URL — `https://<your-instance>.powersync.journeyapps.com`
  (confirm it matches `POWERSYNC_URL` in `.env`; the Clerk template stamps this exact
  string as `aud`, so they must be identical).

## 2. PowerSync Cloud → Sync Rules

Your hosted sync rules live in the dashboard (the repo's `sync-config.yaml` is dev-only).
In the **`workspace`** stream, change the `my_workspaces` parameter query to join
`nm_users` (so the Clerk `sub` resolves to our uuid). Replace:

```yaml
my_workspaces: select workspace_id from workspace_members where user_id = auth.user_id()
```

with:

```yaml
my_workspaces: select wm.workspace_id from workspace_members wm join nm_users u on u.id = wm.user_id where u.clerk_user_id = auth.user_id()
```

Nothing else in the stream changes — the `select * from <table> where workspace_id in
(select workspace_id from my_workspaces)` data queries are untouched. Deploy the rules.

> This join keeps **dev mode working too**: migration 0032 backfilled each existing
> user's `clerk_user_id` to their uuid-as-text, so a dev/Supabase `sub` (a uuid) still
> resolves. The dev e2e gate stays green on this exact rule.

## 3. Cloud DB → publish `nm_users` ✅ DONE

The join in step 2 reads `nm_users`, so PowerSync must replicate it (it is **never
synced to a client** — used only server-side for the parameter join). **Already applied**
2026-06-18 via `supabase/migrations/0033_publish_nm_users.sql` (session pooler) —
`nm_users` is now in the cloud `powersync` publication. Nothing to do here. To re-verify:

```sql
select tablename from pg_publication_tables where pubname = 'powersync' and tablename = 'nm_users';
-- expect one row: nm_users
```

(Migration `0032` — `nm_users` table + FK repoints + backfill — was applied earlier.)

---

## Launch + verify

```bash
bash scripts/cloud-app.sh
```

Expect in the logs:

- `auth_mode=clerk signed_in=true`
- `auth_token mode=clerk (clerk-signed, mapped via nm_users)`
- `sync_status connected=true synced=true`

and the app on its synced workspace as the Clerk-authed owner. If sync stays at
`connected=false`, it's almost always step 1 (audience mismatch) or step 3 (publication)
— PowerSync's instance logs name the failing claim.
