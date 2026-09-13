-- The server's dead-grant verdict gets its own word (failure-alerts round, docs/design/
-- failure-alerts-2026-08). markConnectorReauth used to write the same 'revoked' a human's
-- connector.disconnect writes; the two are distinguished server-side by ciphertext presence,
-- which never syncs — so no client could tell "the grant died under us" (offer Reconnect,
-- loudly) from "I turned this off" (stay quiet). The attention bar keys on this value.
alter table connectors drop constraint if exists connectors_status_check;
alter table connectors add constraint connectors_status_check
  check (status in ('pending', 'connected', 'revoked', 'reauth_required'));

-- Backfill the rows the old value made ambiguous, keyed on the fact that survives: a human
-- disconnect deletes the secret row, the server verdict keeps it.
update connectors c
   set status = 'reauth_required'
 where status = 'revoked'
   and exists (select 1 from connector_secrets s where s.connector_id = c.id);
