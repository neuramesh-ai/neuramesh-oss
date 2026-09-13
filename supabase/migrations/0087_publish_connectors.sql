-- Prod-only publication step (the 0075_publish_threads convention). connectors ONLY —
-- connector_secrets is deliberately absent from the publication and every sync rule:
-- sealed tokens must never reach a client replica. Deploy note: needs the PowerSync
-- sync-rules redeploy that adds the connectors stream.
alter publication powersync add table public.connectors;
