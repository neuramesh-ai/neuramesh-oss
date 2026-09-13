-- Replies (docs/31): a thread can hang off a message that already exists in the room feed.
--
-- Slack's shape, and the one people expect: you reply to a message, the message STAYS in the
-- channel and grows a "3 replies" footer, and the replies live in the thread. So the root is
-- REFERENCED here, never moved — setting the root message's own thread_id would pull it out of
-- the feed, which is the opposite of what the affordance promises.
--
-- threads syncs as `select *`, so this column rides the existing rule with no PowerSync work.
alter table threads add column if not exists root_message_id uuid references messages (id) on delete set null;

-- The feed shows a thread's ROOT but hides its replies (they belong to the thread). Threads that
-- already exist were born from the Home composer, where the first message IS the starter — so
-- backfill each thread's earliest message as its root. Without this, every existing thread's
-- opening message would disappear from the feed the moment the new filter ships.
update threads t
   set root_message_id = m.id
  from (
    select distinct on (thread_id) thread_id, id
      from messages
     where thread_id is not null
     order by thread_id, created_at asc, id asc
  ) m
 where m.thread_id = t.id
   and t.root_message_id is null;

-- the feed joins on this every render
create index if not exists threads_root_message on threads (root_message_id);
