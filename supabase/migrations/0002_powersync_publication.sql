-- Logical-replication publication for PowerSync (read-path sync).
-- Add tables here as they become client-synced; events/artifacts stay server-side.
create publication powersync for table
  public.channels,
  public.projects,
  public.messages,
  public.tasks;
