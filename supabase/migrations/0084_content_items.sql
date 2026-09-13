-- Content items (marketing-channel plan §4.7): the calendar's atoms. A chip is a content
-- item, never a task: platform + body + status draft → scheduled → published | failed.
-- AGENTS DRAFT, HUMANS PUBLISH — content.approve is HUMAN_ONLY (the approve_design guard);
-- publishing itself is the server's cron once connectors land, writing external_url as the
-- receipt (who drafted, who approved, where it went — the audit trail IS the calendar).
create table if not exists content_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  channel_id uuid not null references channels(id) on delete cascade,
  schedule_id uuid references schedules(id) on delete set null,
  task_id uuid references tasks(id) on delete set null,
  platform text not null default 'x' check (platform in ('x', 'instagram', 'linkedin', 'email')),
  body text not null,
  media jsonb,                                     -- artifact refs, phase 2
  status text not null default 'draft' check (status in ('draft', 'scheduled', 'published', 'failed')),
  scheduled_at timestamptz,
  published_at timestamptz,
  external_url text,
  approved_by text,
  approved_at timestamptz,
  created_by_kind text not null default 'agent',
  created_by text not null default '',
  last_error text,
  created_at timestamptz not null default now()
);
create index if not exists content_channel_idx on content_items(channel_id, created_at desc);
create index if not exists content_due_idx on content_items(status, scheduled_at);
