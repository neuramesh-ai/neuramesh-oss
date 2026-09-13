-- nm_users is published so PowerSync can JOIN it in the workspace parameter query
-- (map the auth provider's JWT sub → our internal uuid). It's NOT in any sync rule,
-- so it never reaches a client — it's only used server-side for the parameter join.
create publication powersync for table public.channels, public.projects, public.messages, public.threads, public.tasks, public.machines, public.agents, public.agent_channels, public.channel_members, public.workspace_members, public.repos, public.project_repos, public.artifacts, public.beats, public.runs, public.decisions, public.policies, public.memory_blocks, public.skills, public.skill_packs, public.schedules, public.content_items, public.connectors, public.whiteboards, public.code_sessions, public.nm_users;
