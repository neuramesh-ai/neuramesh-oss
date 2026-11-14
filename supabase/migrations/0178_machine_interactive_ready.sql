-- NULL preserves the legacy heartbeat contract. New daemons opt into explicit
-- readiness at boot and publish true only after their relay has registered them.
alter table machines add column if not exists interactive_ready boolean;
