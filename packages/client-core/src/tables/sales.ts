// Replica tables: sales_contacts and sales_deals (0201, docs/design/inbox-sales-2026-11/plan.md S1) — part of the
// shared client schema (../schema.ts). One pipeline for each workspace. The replica gives these rows only to a
// person with Sales access (control-api local-sync-scope.ts), and an agent reads them through GET /v1/sales.
import { column, Table } from '../table';

export const sales_contacts = new Table({
  workspace_id: column.text,
  name: column.text,
  email: column.text,
  company: column.text,
  source: column.text,
  created_by_kind: column.text,
  created_by: column.text,
  created_at: column.text,
  updated_at: column.text,
  // 0210, Sales setup: the role, and the free address check
  title: column.text,
  address_check: column.text,
});

export const sales_deals = new Table({
  workspace_id: column.text,
  contact_id: column.text,
  title: column.text,
  company: column.text,
  stage: column.text,
  value_year: column.integer,
  currency: column.text,
  next_step: column.text,
  next_date: column.text,
  thread_id: column.text,
  moved_by_kind: column.text,
  moved_by: column.text,
  moved_at: column.text,
  closed_at: column.text,
  created_by_kind: column.text,
  created_by: column.text,
  created_at: column.text,
  updated_at: column.text,
  // 0210, Sales setup: why the lead fits, where pike found it, its source, and the run that added it
  fit: column.text,
  source_url: column.text,
  source: column.text,
  setup_run: column.text,
});
