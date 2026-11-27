-- The Postiz connector (docs/design/postiz-connector-2026-11, P1): a project's Postiz account, with the
-- person's Postiz API key sealed in connector_secrets as the social tokens are. `handle` is the Postiz
-- organization name. The row is a marketing row (0181), as every non-GitHub connector is.
alter table connectors drop constraint if exists connectors_provider_check;
alter table connectors add constraint connectors_provider_check
  check (provider in ('x', 'linkedin', 'instagram', 'tiktok', 'github', 'postiz'));
