-- 0102 — `parked`: a run that is waiting, not working (docs/harness/05 §3.8).
--
-- Park is what lets a turn END CLEANLY while its work continues later: a worker waiting six minutes
-- for CI parks at zero token cost instead of burning a 15-minute wall. The run stays OPEN — it keeps
-- its ring in every client — so `parked` is deliberately NOT a terminal state, and
-- RUN_TERMINAL_STATES in shared/runs.ts does not gain it.
--
-- ALTER TYPE ... ADD VALUE cannot be USED in the same transaction that adds it, which is why the
-- index below is rewritten with a predicate that does not name the new value (see the note there).

alter type run_state add value if not exists 'parked';

-- The "open runs for this surface" index was partial on `state = 'running'`, so a parked run would
-- have fallen out of it — the query behind every live rail row and the run dock would either miss
-- parked work or seq-scan for it.
--
-- The replacement keys on `ended_at is null` instead of enumerating states. Two reasons, and the
-- second is the load-bearing one: it means "open" by DEFINITION (a run gets ended_at when it settles)
-- rather than by a list that must be edited every time a state is added — and it does not reference
-- 'parked', so it is safe in the same migration that adds the enum value.
drop index if exists runs_open;
create index runs_open on runs (workspace_id, state) where ended_at is null;
