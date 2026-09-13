-- Team shapes beyond the core loop: developer (execution, like worker),
-- designer and sales (channel collaborators). FSM semantics keyed to
-- worker/reviewer/orchestrator are unchanged; new roles claim like workers.
alter type agent_role add value if not exists 'developer';
alter type agent_role add value if not exists 'designer';
alter type agent_role add value if not exists 'sales';
