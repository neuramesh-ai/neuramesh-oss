-- Recall's vector legs are ACL-scoped (workspace/channel/validity filters), and HNSW
-- applies filters AFTER the graph walk: with the default ef_search=40, a selective
-- filter can starve the LIMIT (filtered recall collapses toward zero — the pgvector
-- pre/post-filter trap). iterative_scan=relaxed_order (pgvector 0.8+) keeps scanning
-- until the LIMIT is satisfied, bounded by hnsw.max_scan_tuples (default 20k).
-- Database-level so every pool/pooler backend inherits it at session start; takes
-- effect for connections opened after this applies (a deploy/restart cycles them).
-- Privilege-tolerant (2026-07-30): Supabase's pooler role may not hold ALTER DATABASE SET
-- rights for this GUC (prod applied via a path that did; the dev cloud's pooler does not).
-- The parameter is a recall-QUALITY knob, not a correctness dependency — nothing at runtime
-- requires it to exist — so a role that cannot set it gets a NOTICE instead of a failed,
-- rolled-back migration that blocks everything behind it. Set it once from the dashboard
-- (an owner role) to get the starvation guard on such environments.
do $$
begin
  execute format('alter database %I set hnsw.iterative_scan = relaxed_order', current_database());
exception when insufficient_privilege then
  raise notice 'hnsw.iterative_scan not set (role lacks ALTER DATABASE SET) — recall works; the filtered-scan starvation guard is off until an admin sets it';
end $$;
