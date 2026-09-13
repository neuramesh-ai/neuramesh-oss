-- ONE setup task per channel (0116's other half — see its header for the file split).
--
-- Enforced where enforcement works (0060's partial-unique precedent): the release backfill,
-- channel re-creation and two desktops racing all converge on one row. Closed rows keep the
-- slot on purpose — cancel is the opt-out, not a request to be asked again.
create unique index if not exists tasks_one_setup_per_channel
  on tasks (channel_id) where kind = 'setup';
