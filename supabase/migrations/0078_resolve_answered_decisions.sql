-- Home's needs-you list (and Mission Control) trust the synced decision `status`, but a
-- decision was only flipped to `answered` by the explicit decision.answer command. When a
-- card was answered but that flip never landed — the client's documented transient-failure
-- fallback still posts the `**question** → answer` reply and leaves the row open, plus mobile
-- and older clients — the THREAD collapsed the card (its string-match floor over the reply)
-- while Home kept nagging with the same, already-answered card.
--
-- pgstore/store now auto-resolve such a card in the postMessage transaction. This one-time
-- backfill clears the rows already stranded in that state: an OPEN decision whose answer
-- reply already exists in history (a human `**<question>** → …` line in the same channel +
-- task scope). strpos (not LIKE) so a `%`/`_` in a question is a literal, not a wildcard.
-- No false positives: that exact line is only ever produced by answering the card.
update decisions d
set status = 'answered', answered_at = now()
where d.status = 'open'
  and exists (
    select 1 from messages m
    where m.workspace_id = d.workspace_id
      and m.channel_id = d.channel_id
      and m.task_id is not distinct from d.task_id
      and m.author_kind = 'human'
      and strpos(m.body, '**' || d.question || '** → ') > 0
  );
