-- Gemini 4 Neon and Hydrogen take an xhigh thinking level, and Finance runs a model at the level the
-- person picks. Widen the check to the shared THINKING_LEVELS. Additive: every stored row stays valid.
alter table workspace_finance_model_jobs drop constraint workspace_finance_model_jobs_thinking_check;
alter table workspace_finance_model_jobs add constraint workspace_finance_model_jobs_thinking_check
  check (thinking in ('low','medium','high','xhigh'));
