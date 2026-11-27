// Replica table: email_drafts (0199, docs/design/inbox-sales-2026-11/plan.md I8 to I11) — part of the shared client
// schema (../schema.ts). One email of a draft card in a session: agents draft, the person changes it by talk or on
// the card, and only the person sends it from their own Gmail. The Gmail message id stays on the server.
import { column, Table } from '../table';

export const email_drafts = new Table({
  workspace_id: column.text,
  channel_id: column.text,
  thread_id: column.text,
  card_id: column.text,
  letter: column.text,
  version: column.integer,
  to_name: column.text,
  to_email: column.text,
  subject: column.text,
  body: column.text,
  reason: column.text,
  status: column.text,
  author_kind: column.text,
  author_id: column.text,
  edited_by_kind: column.text,
  edited_by: column.text,
  sent_by: column.text,
  sent_from: column.text,
  sent_at: column.text,
  deal_id: column.text,
  created_at: column.text,
  updated_at: column.text,
});

// Replica table: mail_grants (0203, plan I12). One read of a person's mail or calendar that an agent asked for: the
// ask, the person's Allow once and what the read gave. No mail and no token: the search is what the card shows.
export const mail_grants = new Table({
  workspace_id: column.text,
  channel_id: column.text,
  thread_id: column.text,
  agent_id: column.text,
  search: column.text,
  reason: column.text,
  status: column.text,
  allowed_by: column.text,
  allowed_at: column.text,
  expires_at: column.text,
  used_at: column.text,
  read_threads: column.integer,
  read_days: column.integer,
  created_at: column.text,
  updated_at: column.text,
});
