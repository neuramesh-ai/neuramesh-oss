-- Publish `reply_reminders` for PowerSync replication (the reply queue, 0146). Prod applies this via
-- migrate.mjs; the dev stack + CI skip *publish* migrations and build the publication wholesale from
-- dev/stack/init/99-publication.sql instead (which also lists reply_reminders). Mirrors 0136.
alter publication powersync add table public.reply_reminders;
