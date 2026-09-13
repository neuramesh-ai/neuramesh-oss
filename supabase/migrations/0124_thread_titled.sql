-- 0124 — the titled-once invariant (2026-08-22, founder report: arming a subtask made the
-- orchestrator re-title its parent conversation on the next wake — "call set_thread_title ONCE"
-- was a prompt rule, and prompt rules lose). titled_at stamps the first deliberate title
-- (thread.update with a title, any actor); once set, agents may not rename — only a human.
-- Enforced in the handler; this column is the fact it reads.
alter table threads add column if not exists titled_at timestamptz;
