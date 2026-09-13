-- Account/workspace deletion needs a SANCTIONED purge path: the events log
-- stays append-only in all normal operation, but a transaction-local GUC —
-- set only inside the store's deleteWorkspace — permits the cascade.
create or replace function nm_events_append_only() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and current_setting('nm.allow_event_purge', true) = 'on' then
    return old;
  end if;
  raise exception 'events are append-only';
end;
$$;
