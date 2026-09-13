-- The media.write gap, backfilled where it already bit (failure-alerts round, live finding
-- 2026-08-19). An X connector granted before image posting exists CAN refresh — so it reads
-- 'connected' — but every image post 403s at upload. The poster now raises the dead-grant
-- verdict at runtime (XReauthRequired on the upload 403), which flips the row on the NEXT
-- attempt; this flips the rows whose workspaces already hold the proof, so the attention
-- bar's Reconnect button is there the moment they open the app — no wasted failing attempt.
-- Evidence-keyed on purpose: a text-only workspace whose grant works is NOT broken and must
-- not be nagged, so only connectors whose own project has a failed post naming the missing
-- grant are flipped.
update connectors k
   set status = 'reauth_required'
 where k.provider = 'x'
   and k.status = 'connected'
   and exists (
     select 1
       from content_items ci
       join channels c on c.id = ci.channel_id
      where ci.status = 'failed'
        and ci.last_error like '%media.write%'
        and ci.workspace_id = k.workspace_id
        and (k.project_id is null or c.project_id = k.project_id)
   );
