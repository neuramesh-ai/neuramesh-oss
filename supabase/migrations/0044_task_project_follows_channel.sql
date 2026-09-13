-- A task's project is its channel's project (1:N — projects own channels). When a channel was moved
-- between projects, channels.project_id updated but the tasks already in it did NOT follow, leaving
-- tasks.project_id stale. That misfiles those tasks on the wrong project's board and breaks project
-- deletion (the event-purge keyed on tasks.project_id misses them). Backfill so every task matches
-- its channel's project. The control-api's channel.assign now keeps them in sync going forward.
update tasks t set project_id = c.project_id
  from channels c
  where c.id = t.channel_id and t.project_id is distinct from c.project_id;
